import { app } from 'electron'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

// 真机用户序偏好存储（plan 2026-11-09-device-list-drag-reorder）：external.ts 的
// track 帧每次重建列表，用户序要在这份小偏好上稳定合并才不被冲掉。存的是 UI
// 偏好（serial 有序数组）而非设备记录——external.ts:37「纯内存」边界的显式扩展。
// 骨架照 theme/store.ts：boot 读入、损坏按缺省起步不覆写、tmp+rename 原子写、
// 落盘串行队列。内存先行：会话立即生效，磁盘尽力（失败告警不回滚）。

const STORE_VERSION = 1
/** 断线条目记忆上限：对齐 external.ts EPOCHS_CAP 先例——保留离场 serial，超限丢尾部 */
export const EXTERNAL_ORDER_CAP = 64

interface ExternalOrderFile {
  version: number
  order: string[]
}

let order: string[] = []
let writeQueue: Promise<void> = Promise.resolve()

const storePath = (): string => join(app.getPath('userData'), 'external-order.json')

/** boot 装配处调用（先于 registerExternalIpc）：load 即重新初始化——先清零再读盘 */
export const loadExternalOrder = async (): Promise<void> => {
  order = []
  let raw: string
  try {
    raw = await readFile(storePath(), 'utf8')
  } catch {
    return
  }
  try {
    const parsed = JSON.parse(raw) as Partial<ExternalOrderFile>
    if (parsed.version !== STORE_VERSION || !Array.isArray(parsed.order)) return
    order = parsed.order
      .filter((id): id is string => typeof id === 'string' && id.length > 0)
      .slice(0, EXTERNAL_ORDER_CAP)
  } catch {
    // 损坏文件按缺省起步；原文件留在原地，不被静默改写（照 theme store 先例）
  }
}

export const orderNow = (): string[] => order

let loadTask: Promise<void> | null = null

/** 装配处调用（registerExternalIpc 首连前）：memoized 读盘——首帧合并就有用户序，
 *  开机已插设备不按 adb 帧序落定；读盘失败按空序起步，不阻断跟踪 */
export const ensureOrderLoaded = (): Promise<void> => {
  loadTask ??= loadExternalOrder()
  return loadTask
}

/** 用户序提交：内存即时生效并截断上限；磁盘尽力串行落盘，失败仅告警不回滚 */
export const commitOrder = (next: string[]): Promise<void> => {
  order = next.slice(0, EXTERNAL_ORDER_CAP)
  const task = writeQueue.then(async () => {
    try {
      await writeOrderFile([...order])
    } catch (error) {
      console.warn('[external-order] persist failed:', String(error))
    }
  })
  writeQueue = task
  return task
}

async function writeOrderFile(payload: string[]): Promise<void> {
  const path = storePath()
  const tmp = `${path}.tmp`
  await writeFile(
    tmp,
    `${JSON.stringify({ version: STORE_VERSION, order: payload }, null, 2)}\n`,
    'utf8'
  )
  await rename(tmp, path)
}

/** 稳定合并（applyList 单写入口用）：已知条目按记忆索引序排前，未知条目按载荷序
 *  追加尾部——track 帧到达时用户序保持，新设备落尾。缺席条目不影响合并。 */
export const applyOrder = <T extends { id: string }>(list: T[], order: string[]): T[] => {
  if (order.length === 0) return list
  const rank = new Map(order.map((id, index) => [id, index]))
  const known: T[] = []
  const unknown: T[] = []
  for (const item of list) {
    ;(rank.has(item.id) ? known : unknown).push(item)
  }
  known.sort((a, b) => rank.get(a.id)! - rank.get(b.id)!)
  return [...known, ...unknown]
}
