import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { DeviceMeta } from '@shared/types'

/**
 * config.ini × devices.json 跨文件事务（plan 2026-10-08-device-config-edit 设计 3）：
 * 单文件 tmp+rename 不构成原子提交——副作用前把 old/new 内容持久记录到独立目录
 * （不混入 AVD 扫描根），失败回滚原 config；重启后在文件扫描与设备启动之前按
 * 内容恢复：元数据已是 new 则补写 config，仍是 old 则回滚 config，第三种内容
 * （外部修改）不覆盖、冻结目标。
 */

export interface ConfigTransactionJournal {
  version: 1
  deviceId: string
  createdAt: number
  /** 原 config.ini 全文（写入前复验基准） */
  oldConfig: string
  newConfig: string
  oldMeta: DeviceMeta
  newMeta: DeviceMeta
}

export const transactionsDir = (userData: string): string => join(userData, 'config-transactions')

export const journalPathOf = (dir: string, deviceId: string): string =>
  join(dir, `${deviceId}.json`)

/** 原子写事务记录（tmp + rename）；目录不存在则建 */
export const writeJournal = async (
  dir: string,
  journal: ConfigTransactionJournal
): Promise<void> => {
  await mkdir(dir, { recursive: true })
  const path = journalPathOf(dir, journal.deviceId)
  const tmp = `${path}.tmp`
  await writeFile(tmp, `${JSON.stringify(journal, null, 2)}\n`, 'utf8')
  await rename(tmp, path)
}

export const removeJournal = async (dir: string, deviceId: string): Promise<void> => {
  await rm(journalPathOf(dir, deviceId), { force: true })
}

/** 键序无关的结构比较（journal 来自内存、store 读回自落盘 JSON，键序可能不同） */
const deepEqual = (a: unknown, b: unknown): boolean => {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  const keysOf = (value: object): string[] =>
    Object.keys(value)
      .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
      .sort()
  const keysA = keysOf(a)
  const keysB = keysOf(b)
  if (keysA.length !== keysB.length || keysA.some((key, index) => key !== keysB[index])) {
    return false
  }
  return keysA.every((key) =>
    deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])
  )
}

export interface TransactionRecoveryInput {
  dir: string
  /** 读当前可信元数据（调用方保证非 error 态才发起恢复） */
  readMetas: () => Promise<DeviceMeta[]>
  /** 目标 config.ini 现内容；null = 文件不存在 */
  configRawOf: (deviceId: string) => Promise<string | null>
  writeConfigRaw: (deviceId: string, content: string, expectedCurrent?: string) => Promise<void>
  removeDeviceJournal: (deviceId: string) => Promise<void>
}

export interface FrozenTarget {
  deviceId: string
  message: string
}

export interface RecoveryResult {
  /** 元数据已提交、config 已补齐完成的设备 */
  completed: string[]
  /** 元数据未提交、config 已回滚的设备 */
  rolledBack: string[]
  /** 无法安全恢复、冻结配置写入的设备（记录保留） */
  frozen: FrozenTarget[]
}

const isJournal = (value: unknown): value is ConfigTransactionJournal => {
  if (typeof value !== 'object' || value === null) return false
  const journal = value as Record<string, unknown>
  return (
    journal.version === 1 &&
    typeof journal.deviceId === 'string' &&
    typeof journal.oldConfig === 'string' &&
    typeof journal.newConfig === 'string' &&
    typeof journal.oldMeta === 'object' &&
    journal.oldMeta !== null &&
    typeof journal.newMeta === 'object' &&
    journal.newMeta !== null
  )
}

/**
 * 首载恢复：逐条读取事务记录并按内容裁决。任何分支都不改写元数据——
 * completed/rolledBack 只补齐或回滚 config 后清理记录；无法确认时冻结
 * 目标（记录保留，反馈路径）。目录不存在 = 无未完成事务，静默通过。
 */
export const recoverPendingTransactions = async (
  input: TransactionRecoveryInput
): Promise<RecoveryResult> => {
  const result: RecoveryResult = { completed: [], rolledBack: [], frozen: [] }
  let files: string[]
  try {
    files = (await readdir(input.dir)).filter((file) => file.endsWith('.json')).sort()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return result
    throw new Error('无法读取配置事务目录，已停止初始化以保留恢复记录')
  }
  for (const file of files) {
    const path = join(input.dir, file)
    let journal: ConfigTransactionJournal
    try {
      const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown
      if (!isJournal(parsed)) throw new Error('记录形状不合法')
      journal = parsed
    } catch {
      result.frozen.push({
        deviceId: file.replace(/\.json$/, ''),
        message: `配置保存事务记录无法解析（${path}），已保留文件；请人工核对后删除该记录`
      })
      continue
    }
    const { deviceId } = journal
    try {
      if (
        file !== `${deviceId}.json` ||
        journal.oldMeta.id !== deviceId ||
        journal.newMeta.id !== deviceId
      ) {
        throw new Error('事务记录的设备身份不一致')
      }
      const target = (await input.readMetas()).find((meta) => meta.id === deviceId)
      if (target === undefined) {
        await input.removeDeviceJournal(deviceId)
        continue
      }
      const isNew = deepEqual(target, journal.newMeta)
      if (!isNew && !deepEqual(target, journal.oldMeta)) {
        throw new Error('设备元数据与事务记录不一致（外部修改）')
      }
      const current = await input.configRawOf(deviceId)
      if (current !== journal.oldConfig && current !== journal.newConfig) {
        throw new Error('config.ini 与事务记录不一致（外部修改或文件缺失），未覆盖配置')
      }
      const expected = isNew ? journal.newConfig : journal.oldConfig
      if (current !== expected) await input.writeConfigRaw(deviceId, expected, current)
      await input.removeDeviceJournal(deviceId)
      ;(isNew ? result.completed : result.rolledBack).push(deviceId)
    } catch (error) {
      result.frozen.push({
        deviceId: file.replace(/\.json$/, ''),
        message: `恢复上次保存未完成（${error instanceof Error ? error.message : String(error)}），已冻结本设备的配置修改；事务记录保留在 ${path}`
      })
    }
  }
  return result
}
