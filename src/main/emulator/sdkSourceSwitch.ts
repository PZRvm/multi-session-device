import { BrowserWindow, app } from 'electron'
import { join, resolve } from 'node:path'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import type { SdkSourceMode, SdkSourceSnapshot, SdkSourceSwitchEvaluation } from '@shared/types'
import {
  getSdkSourceState,
  getSdkSourceSnapshot,
  isSharedReadOnly,
  managedSdkRoot,
  persistSdkSourceState,
  setSdkSourceState
} from './sdkSource'
import { getStudioDetection, isStudioSdk, runStudioDetection } from './studioDetect'
import {
  MigrationCancelledError,
  classifyRoot,
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

export const createSwitchDeps = (): SwitchDeps => ({
  migration: createMigrationDeps(() => app.getPath('userData')),
  runningCount: () => runningDeviceCount(),
  avdHome: () => join(app.getPath('userData'), 'avd-home'),
  broadcast: pushToAllWindows,
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
  if (activeRun !== null) throw new Error('migration already running')
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
  const losers = await appOwnedLosers(toRoot, deps)
  const loserRoot = losers[0]
  const state = getSdkSourceState()
  setSdkSourceState({
    ...state,
    source: input.target,
    customPath: input.target === 'custom' ? toRoot : state.customPath
  })
  if (loserRoot !== undefined) {
    await relinkAvdConfigs({ avdHome: deps.avdHome(), fromRoot: loserRoot, toRoot }, deps.migration)
    await deps.migration.rmTree(loserRoot)
  }
  await persistSdkSourceState()
  deps.broadcast(IPC_CHANNELS.sdkSourceChanged, {})
  return getSdkSourceSnapshot()
}

/** sdk:source-clear-retained：仅共享模式可清（不变量：非共享态无保留根） */
export async function clearRetainedRoot(
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
  await deps.migration.rmTree(resolve(input.root))
  deps.broadcast(IPC_CHANNELS.sdkSourceChanged, {})
  return getSdkSourceSnapshot()
}
