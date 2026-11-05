import { adbRecovery } from './adbRecovery'
import { BrowserWindow, app } from 'electron'
import { join, resolve } from 'node:path'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import type { SdkSourceMode, SdkSourceSnapshot, SdkSourceSwitchEvaluation } from '@shared/types'
import { runAdb } from './adb'
import { liveEmulatorProcessPresent } from './emulatorProcessProbe'
import { msg } from '../locale'
import {
  getSdkSourceState,
  getSdkSourceSnapshot,
  isSharedReadOnly,
  managedSdkRoot,
  persistSdkSourceState,
  resolveSdkRoot,
  setSdkSourceState
} from './sdkSource'
import { sdkPaths } from './sdk'
import { getStudioDetection, isStudioSdk, runStudioDetection } from './studioDetect'
import {
  MigrationCancelledError,
  classifyRoot,
  readMigrationJournalState,
  rollbackCorruptMigration,
  countAvdConfigsBoundTo,
  createMigrationDeps,
  discardMigrationJournal,
  loadMigrationJournal,
  planMigration,
  relinkAvdConfigs,
  resumeMigration,
  rollbackMigration,
  startMigration,
  treeSize,
  type MigrationDeps,
  type MigrationPlan
} from './sdkMigration'
import { runningDeviceCount } from '../devices'

/**
 * SDK 来源切换编排（plan 2026-10-11-sdk-source-switching §2 矩阵 + §8 IPC）：
 * 矩阵判定（direct / needs-migration / needs-choice / rejected）、迁移启停与收尾
 * （成功才翻 sdk.json 并丢弃 journal）、直接使用（翻 source + relink + 删落选根）、
 * 共享模式保留根清除。迁移执行期间 SDK 域只读——设备启动/包操作守卫读 journal
 * 在场（hasPendingMigration），与这里的 activeRun 互为印证。
 */

export interface SwitchDeps {
  /** 残留模拟器进程探测接缝（默认 emulatorProcessProbe；单测注入 true 触发守卫） */
  emulatorProcessAlive?: () => Promise<boolean>
  migration: MigrationDeps
  runningCount: () => number
  avdHome: () => string
  broadcast: (channel: string, payload: unknown) => void
  detection: () => ReturnType<typeof getStudioDetection>
  runDetection: () => ReturnType<typeof runStudioDetection>
}

const pushToAllWindows = (channel: string, payload: unknown): void => {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(channel, payload)
  }
}

/**
 * 来源变更监听（plan 2026-10-12-device-list-source-aware）：生效根可能变化的
 * 路径（切换/采纳/清除保留根/恢复）都经 deps.broadcast 发 sdk:source-changed，
 * 在此统一分流——注册表由 ipc/index.ts 登记点填充（devices 域触发全量可用性
 * 重查）。公开入口的 deps 均为每次调用现建（无单例），拦截放 broadcast 包装处
 * 是唯一全覆盖的单点。多监听集合 + 退订返回（review P3-7）：测试可精确清理，
 * 不再依赖覆盖式复位的隐式约定。
 */
const sourceChangedListeners = new Set<() => void>()

export const onSdkSourceChanged = (listener: () => void): (() => void) => {
  sourceChangedListeners.add(listener)
  return () => {
    sourceChangedListeners.delete(listener)
  }
}

export const createSwitchDeps = (): SwitchDeps => ({
  emulatorProcessAlive: () => liveEmulatorProcessPresent(),
  migration: {
    ...createMigrationDeps(() => app.getPath('userData')),
    // win32：迁移/回滚的删源步骤会撞运行中的 adb.exe（issue 2026-10-31-orphan-
    // emulator-after-app-restart）——引擎在 journal 置位后回调停共享 server。
    // best-effort：adb 缺席或 kill 失败不阻断迁移（非 win 平台同样无害）
    stopSharedAdbServer: async () => {
      const adbBin = sdkPaths(resolveSdkRoot()).adbBin
      await runAdb(adbBin, ['kill-server'], { timeoutMs: 10_000 }).catch(() => undefined)
    }
  },
  runningCount: () => runningDeviceCount(),
  avdHome: () => join(app.getPath('userData'), 'avd-home'),
  broadcast: (channel, payload) => {
    pushToAllWindows(channel, payload)
    if (channel === IPC_CHANNELS.sdkSourceChanged) {
      for (const listener of sourceChangedListeners) listener()
    }
  },
  detection: getStudioDetection,
  runDetection: () => runStudioDetection()
})

/** 在途迁移（start/resume 已发起未收尾）；评估入口的 busy 闸 */
let activeRun: { cancel: AbortController; done: Promise<void> } | null = null

const activeRootOf = (state: ReturnType<typeof getSdkSourceState>): string => {
  if (state.source === 'custom' && state.customPath !== null) return state.customPath
  if (state.source === 'shared-studio' && state.sharedPath !== null) return state.sharedPath
  return managedSdkRoot()
}

/**
 * 服务端复验（issue 2026-10-11 问题四处置）：目标路径不得是 Studio 实际 SDK。
 * switchSource 的矩阵判定先行挡住正常 UI 流程，但 adopt/migrate 通道收 renderer
 * 载荷——伪造 {customPath: <Studio SDK>} 可把共享根变成可写自选根（此后卸载/下载
 * 会真写真删 Studio 目录）。与 studio-path-use-shared 同口径，双保险。
 */
async function assertNotStudioRoot(toRoot: string, deps: SwitchDeps): Promise<void> {
  const detection = deps.detection() ?? (await deps.runDetection())
  if (detection.sdkCandidate !== null && (await isStudioSdk(toRoot, detection))) {
    throw new Error('target path is the Android Studio SDK; use the shared source instead')
  }
}

/** 非目标的应用自有根中有可识别 SDK 内容者（落选/迁移来源）——含当前活动根：
 *  从托管/自选切走时，活动根就是要被迁移或二选一处置的那一份 */
async function appOwnedLosers(excludeRoot: string, deps: SwitchDeps): Promise<string[]> {
  const state = getSdkSourceState()
  const candidates = [managedSdkRoot(), state.customPath].filter(
    (root): root is string => root !== null && resolve(root) !== resolve(excludeRoot)
  )
  const losers: string[] = []
  for (const root of candidates) {
    if ((await classifyRoot(root, deps.migration)) === 'sdk') losers.push(resolve(root))
  }
  return losers
}

/**
 * sdk:source-set 矩阵判定：direct 分支当场执行（翻 source + 必要时 relink）并返回
 * 新快照；needs-migration / needs-choice 返回计划交 UI 确认，由 migrate / adopt 通道
 * 二次提交；rejected 附代码（三语词条在 renderer 侧映射）。
 */
export async function switchSource(
  input: { target: SdkSourceMode; customPath?: string },
  deps: SwitchDeps = createSwitchDeps()
): Promise<SdkSourceSwitchEvaluation> {
  return adbRecovery.activity('sdk-source', () => switchSourceImpl(input, deps))
}

async function switchSourceImpl(
  input: { target: SdkSourceMode; customPath?: string },
  deps: SwitchDeps = createSwitchDeps()
): Promise<SdkSourceSwitchEvaluation> {
  if (activeRun !== null) return { action: 'rejected', code: 'busy' }
  if ((await loadMigrationJournal(deps.migration)) !== null) {
    return { action: 'rejected', code: 'journal-pending' }
  }
  const state = getSdkSourceState()
  if (input.target === state.source) {
    if (input.target !== 'custom' || input.customPath === state.customPath) {
      return { action: 'rejected', code: 'no-change' }
    }
  }
  if (deps.runningCount() > 0) return { action: 'rejected', code: 'running-sessions' }

  if (input.target === 'shared-studio') {
    const detection = deps.detection() ?? (await deps.runDetection())
    if (!detection.studioFound) return { action: 'rejected', code: 'studio-not-found' }
    if (detection.sdkCandidate === null) {
      return { action: 'rejected', code: 'studio-sdk-not-located' }
    }
    // 共享切换永不迁移：当前根原地保留为保留根（清除入口在共享模式的保留根区）
    setSdkSourceState({ ...state, source: 'shared-studio', sharedPath: detection.sdkCandidate })
    await persistSdkSourceState()
    deps.broadcast(IPC_CHANNELS.sdkSourceChanged, {})
    return { action: 'direct', snapshot: await getSdkSourceSnapshot() }
  }

  const rawTarget = input.target === 'managed' ? managedSdkRoot() : input.customPath
  if (typeof rawTarget !== 'string' || rawTarget.trim().length === 0) {
    return { action: 'rejected', code: 'custom-path-required' }
  }
  const toRoot = resolve(rawTarget)
  const detection = deps.detection()
  if (detection?.sdkCandidate != null && (await isStudioSdk(toRoot, detection))) {
    return { action: 'rejected', code: 'studio-path-use-shared' }
  }
  if (toRoot === resolve(activeRootOf(state))) return { action: 'rejected', code: 'no-change' }

  const targetClass = await classifyRoot(toRoot, deps.migration)
  if (targetClass === 'junk') return { action: 'rejected', code: 'target-junk' }
  const losers = await appOwnedLosers(toRoot, deps)

  if (targetClass === 'sdk' && losers.length > 0) {
    const loserRoot = losers[0]
    return {
      action: 'needs-choice',
      targetRoot: toRoot,
      targetBytes: await treeSize(toRoot, deps.migration),
      loserRoot,
      loserBytes: await treeSize(loserRoot, deps.migration),
      loserBoundDevices: await countAvdConfigsBoundTo(loserRoot, deps.avdHome(), deps.migration)
    }
  }
  if (targetClass === 'empty' && losers.length > 0) {
    const fromRoot = losers[0]
    return {
      action: 'needs-migration',
      fromRoot,
      toRoot,
      bytes: await treeSize(fromRoot, deps.migration),
      boundDevices: await countAvdConfigsBoundTo(fromRoot, deps.avdHome(), deps.migration)
    }
  }

  // direct：空根起步（无落选）或沿用（目标即保留根、无其他内容）
  setSdkSourceState({
    ...state,
    source: input.target,
    customPath: input.target === 'custom' ? toRoot : state.customPath
  })
  if (losers.length > 0) {
    await relinkAvdConfigs({ avdHome: deps.avdHome(), fromRoot: losers[0], toRoot }, deps.migration)
  }
  await persistSdkSourceState()
  deps.broadcast(IPC_CHANNELS.sdkSourceChanged, {})
  return { action: 'direct', snapshot: await getSdkSourceSnapshot() }
}

interface MigrationProgressPayload {
  phase: string
  percent: number
  movedBytes: number
  totalBytes: number
  currentEntry: string | null
  error?: string
}

const PROGRESS_THROTTLE_MS = 100

const progressWiring = (deps: SwitchDeps): ((progress: MigrationProgressPayload) => void) => {
  let lastPush = 0
  let lastPhase = ''
  return (progress) => {
    const now = Date.now()
    // 阶段切换必推；同阶段 100ms 节流
    if (progress.phase !== lastPhase || now - lastPush >= PROGRESS_THROTTLE_MS) {
      lastPhase = progress.phase
      lastPush = now
      deps.broadcast(IPC_CHANNELS.sdkMigrateProgress, progress)
    }
  }
}

/**
 * sdk:source-migrate：重验预检（服务端不信任 UI 计划）→ 迁移 → 成功翻 source。
 * journal 已在场时即「崩溃恢复继续」入口（同一通道同一语义）。
 */
export async function startSourceMigration(
  input: { target: SdkSourceMode; customPath?: string; replace: boolean },
  deps: SwitchDeps = createSwitchDeps()
): Promise<'started'> {
  return adbRecovery.activity('sdk-source', () => startSourceMigrationImpl(input, deps))
}

async function startSourceMigrationImpl(
  input: { target: SdkSourceMode; customPath?: string; replace: boolean },
  deps: SwitchDeps = createSwitchDeps()
): Promise<'started'> {
  if (activeRun !== null) throw new Error('migration already running')
  await assertNoLiveEmulator(deps)
  const journal = await loadMigrationJournal(deps.migration)
  if (journal !== null) {
    await runMigrationToCompletion(
      (signal) =>
        resumeMigration(
          { avdHome: deps.avdHome(), signal, onProgress: progressWiring(deps) },
          deps.migration
        ),
      deps
    )
    return 'started'
  }
  if (input.target === 'shared-studio') throw new Error('shared target never migrates')
  const toRoot = input.target === 'managed' ? managedSdkRoot() : input.customPath
  if (typeof toRoot !== 'string' || toRoot.trim().length === 0) {
    throw new Error('custom path required')
  }
  await assertNotStudioRoot(toRoot, deps)
  const losers = await appOwnedLosers(toRoot, deps)
  if (losers.length === 0) throw new Error('no sdk to migrate')
  const planResult = await planMigration(
    {
      fromRoot: losers[0],
      toRoot,
      targetSource: input.target === 'managed' ? 'managed' : 'custom',
      replaceTarget: input.replace,
      runningCount: deps.runningCount()
    },
    deps.migration
  )
  if (!planResult.ok) throw new Error(`migration preflight failed: ${planResult.code}`)
  await runMigrationToCompletion(
    (signal) =>
      startMigration(
        planResult.plan,
        { avdHome: deps.avdHome(), signal, onProgress: progressWiring(deps) },
        deps.migration
      ),
    deps,
    planResult.plan
  )
  return 'started'
}

/** 统一收尾包装：跑迁移 → 成功翻 source + 丢弃 journal；失败/取消留 journal 供恢复 */
async function runMigrationToCompletion(
  run: (signal: AbortSignal) => Promise<'done'>,
  deps: SwitchDeps,
  plan?: MigrationPlan
): Promise<void> {
  const cancel = new AbortController()
  const journalSource = plan ? null : await loadMigrationJournal(deps.migration)
  const targetSource = plan?.targetSource ?? journalSource?.targetSource
  const done = (async () => {
    try {
      await run(cancel.signal)
      const state = getSdkSourceState()
      setSdkSourceState({
        ...state,
        source: targetSource ?? state.source,
        customPath:
          targetSource === 'custom'
            ? (plan?.toRoot ?? journalSource?.toRoot ?? state.customPath)
            : state.customPath
      })
      await persistSdkSourceState()
      await discardMigrationJournal(deps.migration)
      deps.broadcast(IPC_CHANNELS.sdkSourceChanged, {})
    } finally {
      activeRun = null
    }
  })()
  activeRun = { cancel, done }
  // await 即消费 done 的拒绝（拒绝只会到达本调用方或 cancel 入口，无 unhandled）
  await done
}

/** sdk:source-migrate-cancel：取消 = 回滚（在途先 abort 等收尾再回滚；崩溃横幅同入口） */
/** sdk:source-migrate-cancel：取消 = 回滚（在途先 abort 等收尾再回滚；崩溃横幅同入口）。
 *  journal 损坏（issue 2026-10-11 问题二）时 entries 不可信——探测式回滚：按盘面
 *  把迁移目标根上源根缺失的条目移回，方向由「活动根 + 非活动有内容的应用自有根」判定。 */
export async function cancelSourceMigration(
  deps: SwitchDeps = createSwitchDeps()
): Promise<'done'> {
  if (activeRun !== null) {
    const run = activeRun
    run.cancel.abort()
    await run.done.catch((error: unknown) => {
      if (!(error instanceof MigrationCancelledError)) throw error
    })
    activeRun = null
  }
  const journalState = await readMigrationJournalState(deps.migration)
  if (journalState.status === 'corrupt') {
    const state = getSdkSourceState()
    const originalRoot = activeRootOf(state)
    // 目标根线索：半损 JSON 里 toRoot 字段常仍可读（形状坏≠全文坏）；
    // 提不出再退「非活动且有内容的应用自有根」。managed→custom 半迁移时
    // customPath 尚未写入 sdk.json——没有这条线索就找不到目标根（测试抓出）。
    const toRootHint = /"toRoot"\s*:\s*"([^"]+)"/.exec(journalState.raw)?.[1]
    const candidates = [
      ...(toRootHint !== undefined ? [toRootHint] : []),
      managedSdkRoot(),
      state.customPath
    ]
    let movedRoot: string | undefined
    for (const root of candidates) {
      if (root === null || resolve(root) === resolve(originalRoot)) continue
      const names = await deps.migration.listDir(root).catch(() => [] as string[])
      if (names.some((name) => name !== '.migrating')) {
        movedRoot = root
        break
      }
    }
    if (movedRoot === undefined) {
      throw new Error('corrupt journal: no second app-owned root to roll back into')
    }
    await rollbackCorruptMigration(
      { movedRoot, originalRoot, avdHome: deps.avdHome() },
      { avdHome: deps.avdHome(), onProgress: progressWiring(deps) },
      deps.migration
    )
    deps.broadcast(IPC_CHANNELS.sdkSourceChanged, {})
    return 'done'
  }
  await assertNoLiveEmulator(deps)
  await rollbackMigration(
    { avdHome: deps.avdHome(), onProgress: progressWiring(deps) },
    deps.migration
  )
  deps.broadcast(IPC_CHANNELS.sdkSourceChanged, {})
  return 'done'
}

/** sdk:source-adopt：直接使用——翻 source + relink 落选根 + 删除落选根（确认在 UI 完成） */
export async function adoptSourceSwitch(
  input: { target: SdkSourceMode; customPath?: string },
  deps: SwitchDeps = createSwitchDeps()
): Promise<SdkSourceSnapshot> {
  return adbRecovery.activity('sdk-source', () => adoptSourceSwitchImpl(input, deps))
}

async function adoptSourceSwitchImpl(
  input: { target: SdkSourceMode; customPath?: string },
  deps: SwitchDeps = createSwitchDeps()
): Promise<SdkSourceSnapshot> {
  if (activeRun !== null) throw new Error('migration running')
  if ((await loadMigrationJournal(deps.migration)) !== null) {
    throw new Error('pending migration journal')
  }
  if (deps.runningCount() > 0) throw new Error('running sessions present')
  const rawTarget = input.target === 'managed' ? managedSdkRoot() : input.customPath
  if (typeof rawTarget !== 'string' || rawTarget.trim().length === 0) {
    throw new Error('custom path required')
  }
  const toRoot = resolve(rawTarget)
  if ((await classifyRoot(toRoot, deps.migration)) !== 'sdk') {
    throw new Error('target has no recognizable sdk')
  }
  await assertNotStudioRoot(toRoot, deps)
  await assertNoLiveEmulator(deps)
  const losers = await appOwnedLosers(toRoot, deps)
  const loserRoot = losers[0]
  const state = getSdkSourceState()
  setSdkSourceState({
    ...state,
    source: input.target,
    customPath: input.target === 'custom' ? toRoot : state.customPath
  })
  if (loserRoot !== undefined) {
    // 删落选根前停 adb（review P2-1，与 clearRetainedRoot 同款）：win32 上活体
    // adb.exe 挡 rmTree；此前失败会落在 setSdkSourceState 与 persist 之间留状态分叉
    await stopAdbServerInRoot(loserRoot)
    await deps.migration.stopSharedAdbServer?.()
    await relinkAvdConfigs({ avdHome: deps.avdHome(), fromRoot: loserRoot, toRoot }, deps.migration)
    await deps.migration.rmTree(loserRoot)
  }
  await persistSdkSourceState()
  deps.broadcast(IPC_CHANNELS.sdkSourceChanged, {})
  return getSdkSourceSnapshot()
}

/** sdk:source-clear-retained：仅共享模式可清（不变量：非共享态无保留根） */
/** 删源操作前置：残留模拟器进程守卫（orphan issue 候选 A 最小版）——
 *  上代 headless qemu 锁镜像文件，删源步骤撞它必 EPERM；提示用户先清进程 */
const assertNoLiveEmulator = async (deps: SwitchDeps): Promise<void> => {
  const alive = deps.emulatorProcessAlive ?? (() => Promise.resolve(false))
  if (await alive()) throw new Error(msg('sdkEmulatorProcessAlive'))
}

/** 清保留根前置：停掉可能从待删根内跑着的共享 adb server（win32 运行中 exe 不可删，
 *  issue 2026-10-31-orphan-emulator 第四幕——切共享是直接切换不走迁移链，前两辑的
 *  预检盖不到这里）。挡删除的 adb 恰跑在待删根里，其二进制必然在场——用它发
 *  kill-server 按端口生效；跟踪器随后从当前活动根重生（不同目录，不再挡删除）。
 *  best-effort：失败不阻断，留给 rmTree 报真错 */
const stopAdbServerInRoot = async (root: string): Promise<void> => {
  await runAdb(sdkPaths(root).adbBin, ['kill-server'], { timeoutMs: 10_000 }).catch(() => undefined)
}

export async function clearRetainedRoot(
  input: { root: string },
  deps: SwitchDeps = createSwitchDeps()
): Promise<SdkSourceSnapshot> {
  return adbRecovery.activity('sdk-source', () => clearRetainedRootImpl(input, deps))
}

async function clearRetainedRootImpl(
  input: { root: string },
  deps: SwitchDeps = createSwitchDeps()
): Promise<SdkSourceSnapshot> {
  if (!isSharedReadOnly()) throw new Error('retained roots clearable only in shared mode')
  if (activeRun !== null) throw new Error('migration running')
  const state = getSdkSourceState()
  const allowed = [managedSdkRoot(), state.customPath]
    .filter((root): root is string => root !== null)
    .map((root) => resolve(root))
  if (!allowed.includes(resolve(input.root))) throw new Error('not a retained root')
  await assertNoLiveEmulator(deps)
  try {
    await stopAdbServerInRoot(resolve(input.root))
    await deps.migration.stopSharedAdbServer?.()
    await deps.migration.rmTree(resolve(input.root))
  } catch (error) {
    // review P3-8：rmTree 中途失败可能留下半删目录——指明可重试清除收尾，
    // 且此时设备级联未启动（编排按成功才走）
    throw new Error(
      `retained root clear failed (may be partially deleted; retry clear to finish): ${
        error instanceof Error ? error.message : String(error)
      }`
    )
  }
  deps.broadcast(IPC_CHANNELS.sdkSourceChanged, {})
  return getSdkSourceSnapshot()
}

/** 清除级联的设备删除结果（devices 域注入；编排见 clearRetainedWithCascade） */
export interface PurgeAppOwnedResult {
  deleted: Array<{ id: string; name: string }>
  failures: Array<{ name: string; message: string }>
}

export interface ClearCascadeDeps extends SwitchDeps {
  /** 清除保留根后的设备级联（devices 域注入；缺席则只清 SDK 不动设备） */
  purgeAppOwnedDevices?: () => Promise<PurgeAppOwnedResult>
}

/**
 * 清除保留根 + 设备级联（用户 2026-10-12 批复，review P2-3 自 ipc handler 下沉
 * 以便域测）：主操作（清 SDK）先行完成，级联逐台 best-effort——失败聚合返回由
 * 调用方本地化上报（failures 非空时 SDK 已删、部分设备残留）。顺序是语义：
 * 级联失败不回滚 SDK 删除（用户确认的主操作优先成立）。
 */
export async function clearRetainedWithCascade(
  input: { root: string },
  deps: ClearCascadeDeps = createSwitchDeps()
): Promise<{ snapshot: SdkSourceSnapshot; failures: PurgeAppOwnedResult['failures'] }> {
  return adbRecovery.activity('sdk-source', () => clearRetainedWithCascadeImpl(input, deps))
}

async function clearRetainedWithCascadeImpl(
  input: { root: string },
  deps: ClearCascadeDeps = createSwitchDeps()
): Promise<{ snapshot: SdkSourceSnapshot; failures: PurgeAppOwnedResult['failures'] }> {
  const snapshot = await clearRetainedRoot(input, deps)
  if (deps.purgeAppOwnedDevices === undefined) return { snapshot, failures: [] }
  const purged = await deps.purgeAppOwnedDevices()
  return { snapshot, failures: purged.failures }
}
