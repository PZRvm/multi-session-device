import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  SdkMigrationProgress,
  SdkSourceMode,
  SdkSourceSnapshot,
  SdkSourceSwitchEvaluation
} from '@shared/types'

/**
 * SDK 来源版面的数据面（plan 2026-10-11-sdk-source-switching §7）：
 * 版面打开自动跑一次检测（主进程缓存刷新），快照/进度经事件与主动拉取双通道保持新鲜；
 * 动作（切换判定/迁移/采纳/取消/清除）全部走 preload 白名单桥，sender 守卫在 main。
 */

export interface SdkSourceUi {
  snapshot: SdkSourceSnapshot | null
  detecting: boolean
  acting: boolean
  /** 项目自有设备计数（清除确认框级联警告，用户 2026-10-12 批复） */
  appOwnedDeviceCount: () => Promise<number>
  /** 迁移进行中的实时进度（done/failed/cancelled 终态保留至下一次动作） */
  progress: SdkMigrationProgress | null
  refresh: () => Promise<void>
  runDetection: () => Promise<void>
  /** 矩阵判定：direct 已在 main 执行完（返回后 refresh）；确认卡数据由调用方渲染 */
  evaluate: (target: SdkSourceMode, customPath?: string) => Promise<SdkSourceSwitchEvaluation>
  startMigration: (
    target: SdkSourceMode,
    customPath: string | undefined,
    replace: boolean
  ) => Promise<void>
  adopt: (target: SdkSourceMode, customPath?: string) => Promise<void>
  cancelMigration: () => Promise<void>
  clearRetained: (root: string) => Promise<void>
  chooseCustomRoot: () => Promise<string | null>
}

const api = (): typeof window.api.sdk | undefined =>
  typeof window !== 'undefined' ? window.api?.sdk : undefined

/** 活动中的迁移阶段（终态 done/failed/cancelled 不在其中） */
const ACTIVE_PHASES: readonly SdkMigrationProgress['phase'][] = [
  'scan',
  'moving',
  'relink',
  'cleanup'
]
/** 终态进度卡的停留时长（done/cancelled 短暂可见后自动收起；failed 保留待处置） */
const TERMINAL_LINGER_MS = 2_500

export const useSdkSource = (): SdkSourceUi => {
  const [snapshot, setSnapshot] = useState<SdkSourceSnapshot | null>(null)
  const [detecting, setDetecting] = useState(false)
  const [acting, setActing] = useState(false)
  const [progress, setProgress] = useState<SdkMigrationProgress | null>(null)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    const sdk = api()
    if (!sdk) return
    // 版面打开：自动检测（刷新缓存）→ 拉快照；事件订阅保持新鲜
    void (async () => {
      setDetecting(true)
      try {
        await sdk.detectStudio()
      } catch {
        // 检测失败不阻塞版面：快照里 detection 为 null，共享选项按未装处理
      } finally {
        if (mounted.current) setDetecting(false)
      }
      await sdk
        .sourceGet()
        .then((next) => {
          if (mounted.current) setSnapshot(next)
        })
        .catch(() => undefined)
    })()
    // 终态进度卡停留计时（done/cancelled 短暂可见后自动收起，fix 2026-10-12：
    // 此前终态卡片永不过期——「正在迁移 SDK」100% 一直挂在页面上）
    let terminalTimer: ReturnType<typeof setTimeout> | null = null
    const clearTerminalTimer = (): void => {
      if (terminalTimer !== null) {
        clearTimeout(terminalTimer)
        terminalTimer = null
      }
    }
    const offChanged = sdk.onSourceChanged(() => {
      void sdk
        .sourceGet()
        .then((next) => {
          if (!mounted.current) return
          setSnapshot(next)
          // 防御性收口：刷新确认迁移已结束（journal 没了）而本地进度仍停在被丢的
          // 活动阶段（终态事件丢失场景）——强制置 done，交给停留计时收起
          if (next.migration === null) {
            setProgress((prev) =>
              prev !== null && ACTIVE_PHASES.includes(prev.phase)
                ? { ...prev, phase: 'done', percent: 100 }
                : prev
            )
            // 胁迫出的终态同样武装停留收起（进度事件丢失场景的完整收口）
            armTerminalDismiss()
          }
        })
        .catch(() => undefined)
    })
    const armTerminalDismiss = (): void => {
      clearTerminalTimer()
      terminalTimer = setTimeout(() => {
        terminalTimer = null
        if (mounted.current) setProgress(null)
      }, TERMINAL_LINGER_MS)
    }
    const offProgress = sdk.onMigrateProgress((next) => {
      if (mounted.current) setProgress(next)
      clearTerminalTimer()
      if (next.phase === 'done' || next.phase === 'cancelled') armTerminalDismiss()
    })
    return () => {
      mounted.current = false
      clearTerminalTimer()
      offChanged()
      offProgress()
    }
  }, [])

  const refresh = useCallback(async (): Promise<void> => {
    const next = await api()?.sourceGet()
    if (mounted.current && next) setSnapshot(next)
  }, [])

  const runDetection = useCallback(async (): Promise<void> => {
    const sdk = api()
    if (!sdk) return
    setDetecting(true)
    try {
      await sdk.detectStudio()
      await refresh()
    } finally {
      if (mounted.current) setDetecting(false)
    }
  }, [refresh])

  const withActing = useCallback(
    async (task: () => Promise<unknown> | undefined): Promise<void> => {
      setActing(true)
      try {
        await task()
      } finally {
        if (mounted.current) setActing(false)
      }
    },
    []
  )

  const evaluate = useCallback(
    async (target: SdkSourceMode, customPath?: string): Promise<SdkSourceSwitchEvaluation> => {
      const sdk = api()
      if (!sdk) throw new Error('sdk api unavailable')
      const evaluation = await sdk.sourceSet(target, customPath)
      await refresh()
      return evaluation
    },
    [refresh]
  )

  const startMigration = useCallback(
    async (
      target: SdkSourceMode,
      customPath: string | undefined,
      replace: boolean
    ): Promise<void> => {
      await withActing(() => api()?.sourceMigrate(target, customPath, replace))
    },
    [withActing]
  )

  const adopt = useCallback(
    async (target: SdkSourceMode, customPath?: string): Promise<void> => {
      await withActing(() => api()?.sourceAdopt(target, customPath))
    },
    [withActing]
  )

  const cancelMigration = useCallback(async (): Promise<void> => {
    await withActing(() => api()?.sourceMigrateCancel())
  }, [withActing])

  const clearRetained = useCallback(
    async (root: string): Promise<void> => {
      await withActing(() => api()?.sourceClearRetained(root))
    },
    [withActing]
  )

  /** 项目自有设备计数（清除确认框的级联警告，用户 2026-10-12 批复） */
  const appOwnedDeviceCount = useCallback(async (): Promise<number> => {
    const sdk = api()
    if (!sdk) return 0
    try {
      return await sdk.appOwnedDeviceCount()
    } catch {
      return 0 // 计数失败不拦清除入口——确认框按 0 台处理，主流程不受影响
    }
  }, [])

  const chooseCustomRoot = useCallback(async (): Promise<string | null> => {
    const sdk = api()
    if (!sdk) return null
    const picked = await sdk.chooseCustomRoot()
    await refresh()
    return picked
  }, [refresh])

  return {
    snapshot,
    detecting,
    acting,
    progress,
    refresh,
    runDetection,
    evaluate,
    startMigration,
    adopt,
    cancelMigration,
    clearRetained,
    appOwnedDeviceCount,
    chooseCustomRoot
  }
}
