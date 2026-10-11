import { spawn } from 'node:child_process'
import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  statfs,
  writeFile
} from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import type {
  SdkMigrationEntry,
  SdkMigrationJournalFile,
  SdkMigrationProgress,
  SdkMigrationView,
  SdkSnapshot
} from '@shared/types'
import { detectSdk } from './sdk'
import { rewriteConfigPathPrefixes } from './avd'

/**
 * SDK 迁移引擎（plan 2026-10-11-sdk-source-switching §3/§4）：同卷 rename 原子移动、
 * 跨卷 copy-then-delete（文件数+字节数校验）。journal（userData/sdk-migration.json）
 * 逐顶层条目记账——任意崩溃点可重入：已移条目跳过、半拷贝 .migrating 重拷、
 * source 在归位前始终完整。活动根（sdk.json）在迁移完成前不翻，期间 SDK 域只读
 * （拦截在编排层，本模块不感知）。
 */

/** 显式取消（取消=回滚，回滚由编排层接着跑） */
export class MigrationCancelledError extends Error {
  constructor() {
    super('migration cancelled')
    this.name = 'MigrationCancelledError'
  }
}

export interface MigrationDeps {
  listDir: (path: string) => Promise<string[]>
  /** stat：目录性、字节数与卷号（st_dev——同卷 rename / 跨卷 copy 的判据） */
  statEntry: (path: string) => Promise<{ isDir: boolean; size: number; dev: number }>
  mkdirP: (path: string) => Promise<void>
  renameEntry: (from: string, to: string) => Promise<void>
  rmTree: (path: string) => Promise<void>
  copyFileTo: (from: string, to: string) => Promise<void>
  /** 目标卷可用字节；null = 未知（跳过空间预检） */
  freeSpaceOf: (path: string) => Promise<number | null>
  /** 卷文件系统名（diskutil 解析；null = 未知不拦）。FAT/exFAT 无执行位，JRE 不可运行 */
  fsTypeOf: (path: string) => Promise<string | null>
  pathExists: (path: string) => Promise<boolean>
  readFile: (path: string) => Promise<string>
  writeFile: (path: string, data: string) => Promise<void>
  /** detectSdk 接缝（默认真实探测；单测按内存形状注入） */
  detectSnapshot: (root: string) => Promise<SdkSnapshot>
  /** journal 落盘目录（userData） */
  journalDir: () => string
}

const DISKUTIL_TIMEOUT_MS = 5_000

const defaultDeps = (userDataDir: () => string): MigrationDeps => ({
  listDir: (path) => readdir(path),
  statEntry: async (path) => {
    const info = await stat(path)
    return { isDir: info.isDirectory(), size: info.size, dev: Number(info.dev) }
  },
  mkdirP: (path) => mkdir(path, { recursive: true }).then(() => undefined),
  renameEntry: (from, to) => rename(from, to),
  rmTree: (path) => rm(path, { recursive: true, force: true }),
  copyFileTo: (from, to) => copyFile(from, to),
  freeSpaceOf: async (path) => {
    try {
      const info = await statfs(path)
      return Number(info.bavail) * Number(info.bsize)
    } catch {
      return null
    }
  },
  fsTypeOf: (path) =>
    new Promise((resolveTo) => {
      const child = spawn('diskutil', ['info', path], { stdio: ['ignore', 'pipe', 'ignore'] })
      const out: Buffer[] = []
      const timer = setTimeout(() => child.kill('SIGKILL'), DISKUTIL_TIMEOUT_MS)
      child.stdout?.on('data', (chunk: Buffer) => out.push(chunk))
      const finish = (): void => {
        clearTimeout(timer)
        const match = Buffer.concat(out)
          .toString('utf8')
          .match(/File System Personality:\s*(.+)/)
        resolveTo(match ? match[1].trim() : null)
      }
      child.on('error', () => {
        clearTimeout(timer)
        resolveTo(null)
      })
      child.on('close', finish)
    }),
  pathExists: async (path) => {
    try {
      await stat(path)
      return true
    } catch {
      return false
    }
  },
  readFile: (path) => readFile(path, 'utf8'),
  writeFile: (path, data) => writeFile(path, data, 'utf8'),
  detectSnapshot: (root) => detectSdk(root),
  journalDir: userDataDir
})

/** 空间预检口径：跨卷复制需 源体量 × 1.05 + 200MB（plan §3 预检） */
export const requiredFreeBytes = (totalBytes: number): number =>
  Math.ceil(totalBytes * 1.05) + 200 * 1024 * 1024

// ---- journal 读写（tmp+rename 原子替换；损坏 = 无 journal，编排层按中断横幅处置）----

export const migrationJournalPath = (deps: MigrationDeps): string =>
  join(deps.journalDir(), 'sdk-migration.json')

export async function loadMigrationJournal(
  deps: MigrationDeps
): Promise<SdkMigrationJournalFile | null> {
  let raw: string
  try {
    raw = await deps.readFile(migrationJournalPath(deps))
  } catch {
    return null
  }
  try {
    const parsed = JSON.parse(raw) as SdkMigrationJournalFile
    if (parsed.version !== 1 || typeof parsed.fromRoot !== 'string') return null
    return parsed
  } catch {
    return null
  }
}

async function saveMigrationJournal(
  journal: SdkMigrationJournalFile,
  deps: MigrationDeps
): Promise<void> {
  const path = migrationJournalPath(deps)
  const tmp = `${path}.tmp`
  await deps.writeFile(tmp, `${JSON.stringify(journal, null, 2)}\n`)
  await deps.renameEntry(tmp, path)
  journalPresent = true
}

async function clearMigrationJournal(deps: MigrationDeps): Promise<void> {
  await deps.rmTree(migrationJournalPath(deps))
  journalPresent = false
}

/** 编排层收尾用：迁移成功翻 source 后丢弃 journal（幂等） */
export const discardMigrationJournal = clearMigrationJournal

/**
 * journal 在场的内存镜像：journal 只由本进程写（start/迁移各步/收尾），save/clear
 * 同步翻标志——设备启动/包操作守卫读它零异步（真实 fs 读会扰动调用方的时序，
 * devices 创建事务的用例对节拍敏感）。boot 由 primeMigrationJournalFlag 按盘面
 * 校准一次（崩溃残留 journal 的恢复场景）。
 */
let journalPresent = false

/** 同步守卫口径：迁移在途（journal 在场，含 done 待清瞬时窗） */
export function isMigrationActive(): boolean {
  return journalPresent
}

/** boot 时按盘面校准内存标志（崩溃残留 journal → true）；restoreSdkSource 调用 */
export async function primeMigrationJournalFlag(deps: MigrationDeps): Promise<void> {
  journalPresent = (await loadMigrationJournal(deps)) !== null
}

/** 测试用：重置内存标志 */
export function resetMigrationFlagForTest(): void {
  journalPresent = false
}

/** journal 文件在场（含 done 待清的瞬时窗口）——异步盘面真值（评估入口用） */
export async function hasPendingMigration(deps: MigrationDeps): Promise<boolean> {
  return (await loadMigrationJournal(deps)) !== null
}

// ---- 目录扫描与目标根判定 ----

/** 顶层条目扫描：清掉 .tmp-* 半成品（bootstrap 残留）后逐条 walk 统计字节/文件数 */
async function scanEntries(root: string, deps: MigrationDeps): Promise<SdkMigrationEntry[]> {
  let names: string[]
  try {
    names = await deps.listDir(root)
  } catch {
    return []
  }
  for (const stale of names.filter((name) => name.startsWith('.tmp-'))) {
    await deps.rmTree(join(root, stale))
  }
  const live = names.filter((name) => !name.startsWith('.tmp-'))
  const entries: SdkMigrationEntry[] = []
  for (const name of live) {
    const { files, bytes } = await walkCount(join(root, name), deps)
    entries.push({ name, bytes, files, done: false })
  }
  return entries
}

async function walkCount(
  path: string,
  deps: MigrationDeps
): Promise<{ files: number; bytes: number }> {
  const info = await deps.statEntry(path)
  if (!info.isDir) return { files: 1, bytes: info.size }
  let files = 0
  let bytes = 0
  for (const child of await deps.listDir(path)) {
    const result = await walkCount(join(path, child), deps)
    files += result.files
    bytes += result.bytes
  }
  return { files, bytes }
}

/** 目录体量（字节；供确认卡与保留根清单） */
export const treeSize = (path: string, deps: MigrationDeps): Promise<number> =>
  walkCount(path, deps).then((result) => result.bytes)

/** config.ini 镜像引用仍指向该根的设备数（清除/二选一警告口径；只读不改写） */
export async function countAvdConfigsBoundTo(
  root: string,
  avdHome: string,
  deps: MigrationDeps
): Promise<number> {
  const prefix = root.endsWith(sep) ? root : `${root}${sep}`
  const avdDirs = (await deps.listDir(avdHome).catch(() => [] as string[])).filter((name) =>
    name.endsWith('.avd')
  )
  let bound = 0
  for (const dirName of avdDirs) {
    let content: string
    try {
      content = await deps.readFile(join(avdHome, dirName, 'config.ini'))
    } catch {
      continue
    }
    if (
      content
        .split('\n')
        .some(
          (line) =>
            /^([A-Za-z0-9._-]+)=(.*)$/.test(line) &&
            line.slice(line.indexOf('=') + 1).startsWith(prefix)
        )
    ) {
      bound += 1
    }
  }
  return bound
}

export type TargetRootClass = 'empty' | 'sdk' | 'junk'

/** 目标根三分支判定（plan §2 矩阵）：可识别 = platform-tools/emulator/cmdline-tools 任一在场 */
export async function classifyRoot(root: string, deps: MigrationDeps): Promise<TargetRootClass> {
  let names: string[]
  try {
    names = await deps.listDir(root)
  } catch {
    return 'empty'
  }
  if (names.length === 0) return 'empty'
  const recognizable =
    (await deps.pathExists(join(root, 'platform-tools', 'adb'))) ||
    (await deps.pathExists(join(root, 'emulator', 'emulator'))) ||
    (await deps.pathExists(join(root, 'cmdline-tools', 'latest', 'bin', 'sdkmanager')))
  return recognizable ? 'sdk' : 'junk'
}

// ---- 计划与预检 ----

export interface MigrationPlanInput {
  fromRoot: string
  toRoot: string
  targetSource: 'managed' | 'custom'
  /** 二选一的迁移替换分支：目标已有可识别 SDK 时先删（journal 记 targetCleared） */
  replaceTarget: boolean
  /** 当前运行会话数（编排层从 RunnerRegistry 取；>0 拒绝） */
  runningCount: number
}

export interface MigrationPlan {
  fromRoot: string
  toRoot: string
  targetSource: 'managed' | 'custom'
  replaceTarget: boolean
  entries: SdkMigrationEntry[]
  totalBytes: number
  sameVolume: boolean
  /** 迁移前组件在场基线（收尾复核：不降低） */
  beforeComponents: {
    jre: boolean
    cmdlineTools: boolean
    platformTools: boolean
    emulator: boolean
    licensed: boolean
  }
}

export type PlanFailureCode =
  | 'running-sessions'
  | 'empty-source'
  | 'target-junk'
  | 'target-sdk-no-replace'
  | 'fs-unsupported'
  | 'space'
  | 'journal-pending'
  | 'same-root'

export type PlanResult =
  { ok: true; plan: MigrationPlan } | { ok: false; code: PlanFailureCode; detail?: string }

/**
 * 预检 + 扫描（不落 journal、不动任何文件）：矩阵机械约束在此收口，
 * 产品分支（二选一）由编排层先行决策后以 replaceTarget 传入。
 */
export async function planMigration(
  input: MigrationPlanInput,
  deps: MigrationDeps
): Promise<PlanResult> {
  if (input.runningCount > 0) return { ok: false, code: 'running-sessions' }
  const fromRoot = resolve(input.fromRoot)
  const toRoot = resolve(input.toRoot)
  if (fromRoot === toRoot) return { ok: false, code: 'same-root' }
  if (toRoot.startsWith(fromRoot + sep) || fromRoot.startsWith(toRoot + sep)) {
    return { ok: false, code: 'same-root', detail: 'nested' }
  }
  if ((await loadMigrationJournal(deps)) !== null) return { ok: false, code: 'journal-pending' }

  const before = await deps.detectSnapshot(fromRoot)
  const hasAny =
    before.jre.present ||
    before.cmdlineTools.present ||
    before.platformTools.present ||
    before.emulator.present
  if (!hasAny) return { ok: false, code: 'empty-source' }

  const targetClass = await classifyRoot(toRoot, deps)
  if (targetClass === 'junk') return { ok: false, code: 'target-junk' }
  if (targetClass === 'sdk' && !input.replaceTarget)
    return { ok: false, code: 'target-sdk-no-replace' }

  const fsType = await deps.fsTypeOf(toRoot)
  if (fsType !== null && /fat/i.test(fsType)) {
    return { ok: false, code: 'fs-unsupported', detail: fsType }
  }

  const entries = await scanEntries(fromRoot, deps)
  const totalBytes = entries.reduce((sum, entry) => sum + entry.bytes, 0)

  const fromDev = await deviceOf(fromRoot, deps)
  const toDev = await deviceOf(toRoot, deps)
  // 卷号未知（任一 stat 失败）按跨卷保守处理：rename EXDEV 冒泡再回退 copy
  const sameVolume = fromDev !== null && toDev !== null && fromDev === toDev
  if (!sameVolume) {
    const free = await deps.freeSpaceOf(toRoot)
    if (free !== null && free < requiredFreeBytes(totalBytes)) {
      return {
        ok: false,
        code: 'space',
        detail: `${Math.round(free / 1024 / 1024)}MB free / ${Math.round(requiredFreeBytes(totalBytes) / 1024 / 1024)}MB needed`
      }
    }
  }

  return {
    ok: true,
    plan: {
      fromRoot,
      toRoot,
      targetSource: input.targetSource,
      replaceTarget: targetClass === 'sdk',
      entries,
      totalBytes,
      sameVolume,
      beforeComponents: {
        jre: before.jre.present,
        cmdlineTools: before.cmdlineTools.present,
        platformTools: before.platformTools.present,
        emulator: before.emulator.present,
        licensed: before.licensed
      }
    }
  }
}

async function deviceOf(path: string, deps: MigrationDeps): Promise<number | null> {
  try {
    return (await deps.statEntry(path)).dev
  } catch {
    return null
  }
}

// ---- 执行 ----

export interface MigrationRunOptions {
  /** relink 用的 AVD 根（avd-home 恒独立，只改 config 引用不动数据） */
  avdHome: string
  signal?: AbortSignal
  onProgress?: (progress: SdkMigrationProgress) => void
}

const STAGING = '.migrating'

/** 迁移开始：落 journal → （替换分支先清目标）→ 逐条目移动 → relink → 复核 → 收尾 */
export async function startMigration(
  plan: MigrationPlan,
  options: MigrationRunOptions,
  deps: MigrationDeps
): Promise<'done'> {
  const journal: SdkMigrationJournalFile = {
    version: 1,
    fromRoot: plan.fromRoot,
    toRoot: plan.toRoot,
    targetSource: plan.targetSource,
    targetCleared: false,
    entries: plan.entries,
    phase: 'scan',
    movedBytes: 0,
    totalBytes: plan.totalBytes
  }
  await saveMigrationJournal(journal, deps)
  return runJournal(journal, plan, options, deps)
}

/** 崩溃/取消后续跑：journal 里的已完成条目跳过，其余按原计划走完 */
export async function resumeMigration(
  options: MigrationRunOptions,
  deps: MigrationDeps
): Promise<'done'> {
  const journal = await loadMigrationJournal(deps)
  if (journal === null) throw new Error('migration journal missing')
  if (journal.phase === 'done') {
    // source 已翻或正要翻：只清 journal（幂等收尾）
    await clearMigrationJournal(deps)
    return 'done'
  }
  const before = await deps.detectSnapshot(journal.fromRoot)
  const plan: MigrationPlan = {
    fromRoot: journal.fromRoot,
    toRoot: journal.toRoot,
    targetSource: journal.targetSource,
    replaceTarget: journal.targetCleared,
    entries: journal.entries,
    totalBytes: journal.totalBytes,
    sameVolume: false, // resume 不再省 rename：按跨卷路径重试，EXDEV 冒泡回退 copy
    beforeComponents: {
      jre: before.jre.present,
      cmdlineTools: before.cmdlineTools.present,
      platformTools: before.platformTools.present,
      emulator: before.emulator.present,
      licensed: before.licensed
    }
  }
  return runJournal(journal, plan, options, deps)
}

/** 回滚：已移条目送回源根（对称 copy/verify/delete）→ relink 反向 → 清 journal 与空目标根 */
export async function rollbackMigration(
  options: MigrationRunOptions,
  deps: MigrationDeps
): Promise<'done'> {
  const journal = await loadMigrationJournal(deps)
  if (journal === null) throw new Error('migration journal missing')
  for (const entry of [...journal.entries].reverse().filter((entry) => entry.done)) {
    await moveEntry(
      { fromRoot: journal.toRoot, toRoot: journal.fromRoot, name: entry.name },
      options,
      deps
    )
  }
  await deps.rmTree(join(journal.toRoot, STAGING)).catch(() => undefined)
  await relinkAvdConfigs(
    { avdHome: options.avdHome, fromRoot: journal.toRoot, toRoot: journal.fromRoot },
    deps
  )
  await clearMigrationJournal(deps)
  // 目标根只删空目录（rmdir 语义近似：仅当无子项）
  const leftover = await deps.listDir(journal.toRoot).catch(() => [] as string[])
  if (leftover.length === 0) await deps.rmTree(journal.toRoot).catch(() => undefined)
  options.onProgress?.({
    phase: 'cancelled',
    percent: 0,
    movedBytes: 0,
    totalBytes: journal.totalBytes,
    currentEntry: null
  })
  return 'done'
}

async function runJournal(
  journal: SdkMigrationJournalFile,
  plan: MigrationPlan,
  options: MigrationRunOptions,
  deps: MigrationDeps
): Promise<'done'> {
  const report = (progress: SdkMigrationProgress): void => options.onProgress?.(progress)
  const checkCancelled = (): void => {
    if (options.signal?.aborted) throw new MigrationCancelledError()
  }

  try {
    await deps.mkdirP(journal.toRoot)

    // 替换前置：目标已有可识别 SDK 时先删（崩溃恢复不重复删）
    if (plan.replaceTarget && !journal.targetCleared) {
      report({
        phase: 'cleanup',
        percent: 0,
        movedBytes: 0,
        totalBytes: journal.totalBytes,
        currentEntry: null
      })
      for (const child of await deps.listDir(journal.toRoot)) {
        await deps.rmTree(join(journal.toRoot, child))
      }
      journal.targetCleared = true
      await saveMigrationJournal(journal, deps)
    }

    journal.phase = 'moving'
    await saveMigrationJournal(journal, deps)
    for (let i = 0; i < journal.entries.length; i += 1) {
      const entry = journal.entries[i]
      if (entry.done) continue
      checkCancelled()
      report({
        phase: 'moving',
        percent: percentOf(journal.movedBytes, journal.totalBytes),
        movedBytes: journal.movedBytes,
        totalBytes: journal.totalBytes,
        currentEntry: entry.name
      })
      const sameVolume =
        plan.sameVolume &&
        (await deviceOf(plan.fromRoot, deps)) === (await deviceOf(plan.toRoot, deps))
      await moveEntry(
        { fromRoot: journal.fromRoot, toRoot: journal.toRoot, name: entry.name, sameVolume },
        options,
        deps,
        (copiedBytes) => {
          report({
            phase: 'moving',
            percent: percentOf(journal.movedBytes + copiedBytes, journal.totalBytes),
            movedBytes: journal.movedBytes + copiedBytes,
            totalBytes: journal.totalBytes,
            currentEntry: entry.name
          })
        }
      )
      entry.done = true
      journal.movedBytes += entry.bytes
      await saveMigrationJournal(journal, deps)
    }

    // relink：AVD config.ini 的旧根前缀改写到新根（同相对路径在目标在场才改）
    report({
      phase: 'relink',
      percent: 99,
      movedBytes: journal.movedBytes,
      totalBytes: journal.totalBytes,
      currentEntry: null
    })
    journal.phase = 'relink'
    await saveMigrationJournal(journal, deps)
    await relinkAvdConfigs(
      { avdHome: options.avdHome, fromRoot: journal.fromRoot, toRoot: journal.toRoot },
      deps
    )

    // 复核：组件在场性不低于迁移前
    const after = await deps.detectSnapshot(journal.toRoot)
    const regressed =
      (plan.beforeComponents.jre && !after.jre.present) ||
      (plan.beforeComponents.cmdlineTools && !after.cmdlineTools.present) ||
      (plan.beforeComponents.platformTools && !after.platformTools.present) ||
      (plan.beforeComponents.emulator && !after.emulator.present) ||
      (plan.beforeComponents.licensed && !after.licensed)
    if (regressed) {
      throw new Error('sdk components regressed after migration')
    }

    journal.phase = 'done'
    await saveMigrationJournal(journal, deps)
    await deps.rmTree(join(journal.toRoot, STAGING)).catch(() => undefined)
    // 源根只删空目录（计划内条目已全部移走；迁移期间外部新落的内容不误删）
    const sourceLeftover = await deps.listDir(journal.fromRoot).catch(() => [] as string[])
    if (sourceLeftover.length === 0) await deps.rmTree(journal.fromRoot).catch(() => undefined)
    report({
      phase: 'done',
      percent: 100,
      movedBytes: journal.totalBytes,
      totalBytes: journal.totalBytes,
      currentEntry: null
    })
    return 'done'
  } catch (error) {
    journal.phase = 'failed'
    journal.error = error instanceof Error ? error.message : String(error)
    await saveMigrationJournal(journal, deps).catch(() => undefined)
    report({
      phase: error instanceof MigrationCancelledError ? 'cancelled' : 'failed',
      percent: percentOf(journal.movedBytes, journal.totalBytes),
      movedBytes: journal.movedBytes,
      totalBytes: journal.totalBytes,
      currentEntry: null,
      error: journal.error
    })
    throw error
  }
}

const percentOf = (bytes: number, total: number): number =>
  total <= 0 ? 100 : Math.min(100, Math.floor((bytes / total) * 100))

interface MoveEntryInput {
  fromRoot: string
  toRoot: string
  name: string
  sameVolume?: boolean
}

/**
 * 单条目移动：同卷 rename；跨卷 copy → 校验（文件数+字节数）→ 归位 → 删源。
 * copy-then-delete 保证崩溃点可重入——staging 半成品删除重拷，源在归位前完整。
 */
async function moveEntry(
  input: MoveEntryInput,
  options: MigrationRunOptions,
  deps: MigrationDeps,
  onCopiedBytes?: (bytes: number) => void
): Promise<void> {
  const from = join(input.fromRoot, input.name)
  const to = join(input.toRoot, input.name)
  const sameVolume = input.sameVolume ?? false
  if (!sameVolume) {
    const staging = join(input.toRoot, STAGING, input.name)
    await deps.rmTree(staging)
    await deps.mkdirP(join(input.toRoot, STAGING))
    await copyTree(from, staging, deps, options, (bytes) => {
      onCopiedBytes?.(bytes)
    })
    const verified = await walkCount(staging, deps)
    const expected = await walkCount(from, deps)
    if (verified.files !== expected.files || verified.bytes !== expected.bytes) {
      throw new Error(
        `migration verify failed: ${input.name} (${verified.files}/${expected.files} files, ${verified.bytes}/${expected.bytes} bytes)`
      )
    }
    await deps.mkdirP(input.toRoot)
    await deps.renameEntry(staging, to)
    await deps.rmTree(from)
    onCopiedBytes?.(expected.bytes)
    return
  }
  await deps.renameEntry(from, to)
}

async function copyTree(
  from: string,
  to: string,
  deps: MigrationDeps,
  options: MigrationRunOptions,
  onBytes: (bytes: number) => void
): Promise<void> {
  const info = await deps.statEntry(from)
  if (!info.isDir) {
    await deps.mkdirP(to.slice(0, to.lastIndexOf(sep)))
    await deps.copyFileTo(from, to)
    onBytes(info.size)
    return
  }
  await deps.mkdirP(to)
  let bytes = 0
  for (const child of await deps.listDir(from)) {
    if (options.signal?.aborted) throw new MigrationCancelledError()
    const before = bytes
    await copyTree(join(from, child), join(to, child), deps, options, (childBytes) => {
      bytes = before + childBytes
      onBytes(bytes)
    })
  }
  onBytes(bytes)
}

// ---- AVD 引用改写（设备不断链；§4）----

export interface RelinkResult {
  /** 改写过的 config.ini 个数 */
  configs: number
  rewrites: { avd: string; key: string; from: string; to: string }[]
}

/**
 * avd-home 各 *.avd/config.ini：值以 fromRoot 为前缀的路径键改写到 toRoot——
 * 同相对路径在 toRoot 在场才改（否则保留原引用，设备绑定在保留根上随其存亡）。
 * 原子写（tmp+rename）；rewriteConfigPathPrefixes 的纯函数在 avd.ts 单测。
 */
export async function relinkAvdConfigs(
  input: { avdHome: string; fromRoot: string; toRoot: string },
  deps: MigrationDeps
): Promise<RelinkResult> {
  const avdDirs = (await deps.listDir(input.avdHome).catch(() => [] as string[])).filter((name) =>
    name.endsWith('.avd')
  )
  const result: RelinkResult = { configs: 0, rewrites: [] }
  for (const dirName of avdDirs) {
    const configPath = join(input.avdHome, dirName, 'config.ini')
    let content: string
    try {
      content = await deps.readFile(configPath)
    } catch {
      continue
    }
    const rewritten = await rewriteConfigPathPrefixes(
      content,
      input.fromRoot,
      input.toRoot,
      (relative) => deps.pathExists(join(input.toRoot, relative))
    )
    if (rewritten.rewritten.length === 0) continue
    const tmp = `${configPath}.tmp`
    await deps.writeFile(tmp, rewritten.content)
    await deps.renameEntry(tmp, configPath)
    result.configs += 1
    result.rewrites.push(...rewritten.rewritten.map((item) => ({ avd: dirName, ...item })))
  }
  return result
}

export { defaultDeps as createMigrationDeps }

/** journal → renderer 可见视图（sdk:source-get 附带；崩溃恢复横幅数据源） */
export function toSdkMigrationView(journal: SdkMigrationJournalFile): SdkMigrationView {
  return {
    fromRoot: journal.fromRoot,
    toRoot: journal.toRoot,
    targetSource: journal.targetSource,
    phase: journal.phase,
    doneEntries: journal.entries.filter((entry) => entry.done).length,
    totalEntries: journal.entries.length,
    movedBytes: journal.movedBytes,
    totalBytes: journal.totalBytes
  }
}
