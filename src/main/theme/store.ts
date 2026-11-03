import { app } from 'electron'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isThemeMode, isThemeSystemId } from '@shared/themeSystems'
import type { ThemeSelection } from '@shared/types'

const STORE_VERSION = 1

const DEFAULT_SELECTION: ThemeSelection = { systemId: 'amber', mode: 'system' }

interface ThemeStoreFile extends ThemeSelection {
  version: number
}

// 内存态：boot 读入后主进程不再碰磁盘读。fresh = 本次启动 theme.json 不存在——
// renderer 据此判定是否做 legacy localStorage 一次性收编（收编写入后 fresh 即翻 false）
let state: ThemeSelection = { ...DEFAULT_SELECTION }
let fresh = true

function storePath(): string {
  return join(app.getPath('userData'), 'theme.json')
}

/** boot 时调用一次（建窗前）：读盘恢复主题态；无文件 = 首启，fresh 保持 true */
export async function loadThemeState(): Promise<void> {
  let raw: string
  try {
    raw = await readFile(storePath(), 'utf8')
  } catch {
    return
  }
  fresh = false
  let parsed: ThemeStoreFile
  try {
    parsed = JSON.parse(raw) as ThemeStoreFile
  } catch {
    // 损坏文件按缺省起步；原文件留在原地，不被静默改写（下次合法写入才覆写）
    state = { ...DEFAULT_SELECTION }
    return
  }
  state = {
    systemId: isThemeSystemId(parsed.systemId) ? parsed.systemId : DEFAULT_SELECTION.systemId,
    mode: isThemeMode(parsed.mode) ? parsed.mode : DEFAULT_SELECTION.mode
  }
}

/** 同步初值（theme:get-sync 的应答源）：全内存，无磁盘 IO */
export function getThemeState(): ThemeSelection & { fresh: boolean } {
  return { ...state, fresh }
}

/** 内存先行（本次会话即生效）；落盘由 persistThemeState 单独负责 */
export function updateThemeState(partial: Partial<ThemeSelection>): ThemeSelection {
  state = { ...state, ...partial }
  fresh = false
  return state
}

/** 主题落盘唯一写入口：tmp + rename 原子替换（照 devices store 先例）；失败由调用方处置。
 *  落盘串行队列（issue 2026-10-06-theme-persist-concurrent-tmp-clash）：并发 persist 共享
 *  同一 tmp 路径，交错会互相覆盖——排队执行且单次失败不断队列；载荷在调用时快照 */
let writeQueue: Promise<void> = Promise.resolve()

export function persistThemeState(): Promise<void> {
  const payload: ThemeStoreFile = { version: STORE_VERSION, ...state }
  const task = writeQueue.then(() => writeThemeFile(payload))
  writeQueue = task.catch(() => undefined)
  return task
}

async function writeThemeFile(payload: ThemeStoreFile): Promise<void> {
  const path = storePath()
  const tmp = `${path}.tmp`
  await writeFile(tmp, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  await rename(tmp, path)
}
