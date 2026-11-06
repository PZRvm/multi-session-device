import { randomUUID } from 'node:crypto'
import { readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AvdDirs } from './avd'

/**
 * 休眠清单域（plan 2026-11-06-emulator-hibernation 设计 B；ADR-007）：
 * 单设备 AVD 目录内的版本化 msd-hibernation.json 是休眠事实的唯一持久载体，
 * 只由主进程读写；原子写（tmp+rename）；不迁移 devices.json。
 */

export const HIBERNATION_MANIFEST_FILE = 'msd-hibernation.json'
export const HIBERNATION_SNAPSHOT_PREFIX = 'msd-hib-'

/** 清单阶段：saving（在途）→ saved（快照已落盘）→ hibernated（进程已退出并复核） */
export type HibernationStage = 'saving' | 'saved' | 'hibernated'

export interface HibernationManifest {
  schemaVersion: 1
  deviceId: string
  /** 本应用独占前缀的唯一快照名；不复用 Quick Boot 的 default_boot */
  snapshotName: string
  /** 快照写盘完成时间（epoch ms）；saving 阶段为 0 */
  savedAt: number
  /** 保存时的 guest 内核 boot_id（/proc/sys/kernel/random/boot_id）——恢复必须一致 */
  guestBootId: string
  stage: HibernationStage
  emulatorVersion: string | null
  imagePackageName: string
  imageRevision: number | null
  /** 保存时生效的 -gpu 后端（argv 值） */
  gpuBackend: string
  /** 稳定硬件配置指纹（见 hardwareFingerprintOf；端口/日志等易变项不参与） */
  hardwareFingerprint: string
}

export type HibernationRecord =
  | { kind: 'none' }
  | { kind: 'ok'; manifest: HibernationManifest }
  | { kind: 'corrupt'; reason: string }

export const hibernationManifestPath = (deviceId: string, dirs: AvdDirs): string =>
  join(dirs.avdHome, `${deviceId}.avd`, HIBERNATION_MANIFEST_FILE)

export const hibernationSnapshotDir = (
  deviceId: string,
  snapshotName: string,
  dirs: AvdDirs
): string => join(dirs.avdHome, `${deviceId}.avd`, 'snapshots', snapshotName)

/** 每次休眠生成唯一快照名：运行中实例下复用同名保存实测返回 OK 但零字节（PoC run3） */
export const newHibernationSnapshotName = (): string =>
  `${HIBERNATION_SNAPSHOT_PREFIX}${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`

/** 指纹参与键：镜像身份 + 稳定硬件白名单。端口、运行日志、皮肤导入时间戳不参与。 */
export interface HardwareFingerprintInput {
  imagePackageName: string
  imageRevision: number | null
  emulatorVersion: string | null
  gpuBackend: string
  cpuCores: string | null
  ramMiB: string | null
  vmHeapMiB: string | null
  cameraFront: string | null
  cameraBack: string | null
  lcdWidth: string | null
  lcdHeight: string | null
  lcdDensity: string | null
}

export const hardwareFingerprintOf = (input: HardwareFingerprintInput): string =>
  [
    input.imagePackageName,
    input.imageRevision ?? '-',
    input.emulatorVersion ?? '-',
    input.gpuBackend,
    input.cpuCores ?? '-',
    input.ramMiB ?? '-',
    input.vmHeapMiB ?? '-',
    input.cameraFront ?? '-',
    input.cameraBack ?? '-',
    input.lcdWidth ?? '-',
    input.lcdHeight ?? '-',
    input.lcdDensity ?? '-'
  ].join('|')

const isHibernationManifest = (value: unknown): value is HibernationManifest => {
  if (typeof value !== 'object' || value === null) return false
  const manifest = value as Record<string, unknown>
  return (
    manifest.schemaVersion === 1 &&
    typeof manifest.deviceId === 'string' &&
    manifest.deviceId.length > 0 &&
    typeof manifest.snapshotName === 'string' &&
    manifest.snapshotName.startsWith(HIBERNATION_SNAPSHOT_PREFIX) &&
    typeof manifest.savedAt === 'number' &&
    typeof manifest.guestBootId === 'string' &&
    manifest.guestBootId.length > 0 &&
    (manifest.stage === 'saving' ||
      manifest.stage === 'saved' ||
      manifest.stage === 'hibernated') &&
    (manifest.emulatorVersion === null || typeof manifest.emulatorVersion === 'string') &&
    typeof manifest.imagePackageName === 'string' &&
    (manifest.imageRevision === null || typeof manifest.imageRevision === 'number') &&
    typeof manifest.gpuBackend === 'string' &&
    typeof manifest.hardwareFingerprint === 'string'
  )
}

export interface HibernationFsDeps {
  readFile?: (path: string) => Promise<string>
  writeFile?: (path: string, data: string) => Promise<void>
  rename?: (from: string, to: string) => Promise<void>
}

/** 读清单：缺失 = none；半写/未知 schema/形状非法 = corrupt（不静默重置，调用侧解释） */
export const readHibernationManifest = async (
  deviceId: string,
  dirs: AvdDirs,
  deps: HibernationFsDeps = {}
): Promise<HibernationRecord> => {
  const read = deps.readFile ?? ((path: string) => readFile(path, 'utf8'))
  let raw: string
  try {
    raw = await read(hibernationManifestPath(deviceId, dirs))
  } catch {
    return { kind: 'none' }
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isHibernationManifest(parsed)) return { kind: 'corrupt', reason: 'invalid shape' }
    if (parsed.deviceId !== deviceId) return { kind: 'corrupt', reason: 'device id mismatch' }
    return { kind: 'ok', manifest: parsed }
  } catch (error) {
    return { kind: 'corrupt', reason: error instanceof Error ? error.message : String(error) }
  }
}

/** 原子写清单：tmp + rename（同目录同卷，保证原子性） */
export const writeHibernationManifest = async (
  deviceId: string,
  manifest: HibernationManifest,
  dirs: AvdDirs,
  deps: HibernationFsDeps = {}
): Promise<void> => {
  const write = deps.writeFile ?? ((path, data) => writeFile(path, data, 'utf8'))
  const move = deps.rename ?? rename
  const target = hibernationManifestPath(deviceId, dirs)
  const tmp = `${target}.tmp`
  await write(tmp, `${JSON.stringify(manifest, null, 2)}\n`)
  await move(tmp, target)
}

export const removeHibernationManifest = async (deviceId: string, dirs: AvdDirs): Promise<void> => {
  await rm(hibernationManifestPath(deviceId, dirs), { force: true }).catch(() => undefined)
}

/** 快照目录存在且非空（恢复前的廉价前置；真实性由加载 + boot_id 复核证明） */
export const hibernationSnapshotExists = async (
  deviceId: string,
  snapshotName: string,
  dirs: AvdDirs
): Promise<boolean> => {
  try {
    const entries = await readdir(hibernationSnapshotDir(deviceId, snapshotName, dirs))
    return entries.length > 0
  } catch {
    return false
  }
}

export interface SnapshotStabilityDeps {
  dirKiB?: (path: string) => Promise<number>
  sleep?: (ms: number) => Promise<void>
}

/**
 * 等待快照写盘完成（PoC 定论）：console OK 只是受理，写盘异步——首字节出现
 * （firstByteBudgetMs）+ 目录大小稳定（stableBudgetMs，两个 ≥intervalMs 的采样相等）。
 * 返回稳定后的 KiB；任一预算耗尽抛错（保存失败，不得同名重试）。
 */
export const waitHibernationSnapshotStable = async (
  snapshotDir: string,
  opts: { firstByteBudgetMs: number; stableBudgetMs: number; intervalMs: number },
  deps: SnapshotStabilityDeps = {}
): Promise<number> => {
  const dirKiB =
    deps.dirKiB ??
    (async (path: string): Promise<number> => {
      const entries = await readdir(path).catch(() => [] as string[])
      let total = 0
      for (const entry of entries) {
        const info = await stat(join(path, entry)).catch(() => null)
        if (info?.isFile()) total += info.size
      }
      return Math.ceil(total / 1024)
    })
  const sleep = deps.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)))
  const firstDeadline = Date.now() + opts.firstByteBudgetMs
  let size = 0
  while (Date.now() < firstDeadline) {
    size = await dirKiB(snapshotDir).catch(() => 0)
    if (size > 0) break
    await sleep(opts.intervalMs)
  }
  if (size <= 0) throw new Error('hibernation snapshot write did not start (zero bytes)')
  const stableDeadline = Date.now() + opts.stableBudgetMs
  let previous = size
  while (Date.now() < stableDeadline) {
    await sleep(Math.max(opts.intervalMs, 1000))
    const next = await dirKiB(snapshotDir).catch(() => 0)
    if (next > 0 && next === previous) return next
    previous = next
  }
  throw new Error('hibernation snapshot write did not stabilize')
}

/** 清理旧的休眠快照（进程退出后才能安全调用）：保留 keepName，删除其余 msd-hib-*。
 *  失败不抛——记日志后由下次休眠重试（磁盘占用问题不阻塞状态机）。 */
export const cleanupOldHibernationSnapshots = async (
  deviceId: string,
  keepName: string | null,
  dirs: AvdDirs,
  onWarning?: (message: string) => void,
  deps: { readdir?: typeof readdir; rm?: typeof rm } = {}
): Promise<void> => {
  const listDir = deps.readdir ?? readdir
  const remove = deps.rm ?? rm
  const snapshotsRoot = join(dirs.avdHome, `${deviceId}.avd`, 'snapshots')
  try {
    const entries = await listDir(snapshotsRoot)
    for (const entry of entries) {
      if (!entry.startsWith(HIBERNATION_SNAPSHOT_PREFIX) || entry === keepName) continue
      await remove(join(snapshotsRoot, entry), { recursive: true, force: true })
    }
  } catch (error) {
    onWarning?.(
      `[hibernate] 旧休眠快照清理失败（${deviceId}）：${error instanceof Error ? error.message : String(error)}`
    )
  }
}
