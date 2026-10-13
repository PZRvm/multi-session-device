import { useCallback, useEffect, useRef, useState } from 'react'
import { toApiResult } from '../api'
import type { ApkInstallOutcome } from '@shared/types'

// 拖拽 APK 安装状态机（plan 2026-10-10-drag-apk-install）：dragging 高亮 → installing
// （不定进度）→ installed / failed；busyNote 是安装中再次拖入的 4 秒提示。
// 守卫在两处：这里先拦「单文件 + .apk + 未在安装中」，main 再校验 serial 与串行。
// canBypass 是「仍要安装」链路（真机旧 APK，plan 2026-10-13-real-device-usb-and-apk-install）：
// 仅 failed 结果携带，点击后带旗标重发。

export type ApkInstallPhase =
  | { phase: 'idle' }
  | { phase: 'dragging' }
  | { phase: 'installing'; fileName: string }
  | { phase: 'installed'; fileName: string }
  | { phase: 'failed'; message: string; canBypass?: true; filePath?: string }

const INSTALLED_AUTO_CLEAR_MS = 5_000
const FAILED_AUTO_CLEAR_MS = 10_000
const BUSY_NOTE_CLEAR_MS = 4_000

// 安装态模块级单源（issue 2026-10-10 P2-4）：画布以 id:runId 为 key，设备切换/停止即
// 卸载，hook 内存态随卸载丢——在途安装的重挂载画布只看到 idle，重拖被 main 互斥拒绝
// 成失败卡、原结果无人接收。状态放模块 store 后，重挂载从 store 恢复在途态并经
// listener 接住结局；终态保留至 auto-clear 窗口结束（短暂切走再切回仍能看到结果，
// 超时清除——迟到重挂载不展示陈旧结果）。
type PhaseListener = (phase: ApkInstallPhase) => void
const phaseStore = new Map<string, ApkInstallPhase>()
const phaseListeners = new Map<string, Set<PhaseListener>>()
const evictTimers = new Map<string, number>()

const emitPhase = (deviceId: string, next: ApkInstallPhase, retainMs: number): void => {
  phaseStore.set(deviceId, next)
  for (const listener of phaseListeners.get(deviceId) ?? []) listener(next)
  window.clearTimeout(evictTimers.get(deviceId))
  if (retainMs > 0) {
    evictTimers.set(
      deviceId,
      window.setTimeout(() => phaseStore.delete(deviceId), retainMs)
    )
  }
}

/** 测试隔离用：清空模块级安装态（生产代码不得调用） */
export const resetApkInstallStateForTests = (): void => {
  phaseStore.clear()
  phaseListeners.clear()
  for (const timer of evictTimers.values()) window.clearTimeout(timer)
  evictTimers.clear()
}

/** 从绝对路径取文件名（sandbox renderer 无 node:path；macOS 为主平台，兼容反斜杠） */
export const fileNameOf = (filePath: string): string => {
  const parts = filePath.split(/[/\\]/).filter((part) => part.length > 0)
  return parts.length > 0 ? parts[parts.length - 1] : filePath
}

const isApkPath = (filePath: string): boolean => /\.apk$/i.test(filePath)

export const useApkInstall = (
  deviceId: string
): {
  phase: ApkInstallPhase
  busyNote: boolean
  retryWithBypass: () => void
  dragHandlers: {
    onDragEnter: (event: React.DragEvent) => void
    onDragOver: (event: React.DragEvent) => void
    onDragLeave: (event: React.DragEvent) => void
    onDrop: (event: React.DragEvent) => void
  }
} => {
  const [phase, setPhase] = useState<ApkInstallPhase>(
    () => phaseStore.get(deviceId) ?? { phase: 'idle' }
  )
  const [busyNote, setBusyNote] = useState(false)
  const mountedRef = useRef(false)
  const phaseRef = useRef<ApkInstallPhase>(phase)
  const clearTimerRef = useRef(0)
  const busyTimerRef = useRef(0)

  const setPhaseBoth = useCallback((next: ApkInstallPhase): void => {
    phaseRef.current = next
    setPhase(next)
  }, [])

  const armAutoClear = useCallback(
    (delayMs: number): void => {
      window.clearTimeout(clearTimerRef.current)
      clearTimerRef.current = window.setTimeout(() => {
        if (mountedRef.current) setPhaseBoth({ phase: 'idle' })
      }, delayMs)
    },
    [setPhaseBoth]
  )

  // 订阅模块 store：本画布发起的安装经 emitPhase 回流，卸载画布的在途安装结局经
  // listener 交接到重挂载的画布（busyNote 随终态清理——「已安装 + 正在安装上一个」
  // 不再同屏）
  useEffect(() => {
    mountedRef.current = true
    const listener: PhaseListener = (next) => {
      if (!mountedRef.current) return
      setPhaseBoth(next)
      window.clearTimeout(busyTimerRef.current)
      setBusyNote(false)
      if (next.phase === 'installed') armAutoClear(INSTALLED_AUTO_CLEAR_MS)
      else if (next.phase === 'failed') armAutoClear(FAILED_AUTO_CLEAR_MS)
    }
    let listeners = phaseListeners.get(deviceId)
    if (!listeners) {
      listeners = new Set()
      phaseListeners.set(deviceId, listeners)
    }
    listeners.add(listener)
    // 重挂载时若已处于终态（结局完成于卸载期间）：补本画布的自动清理
    const stored = phaseStore.get(deviceId)
    if (stored?.phase === 'installed') armAutoClear(INSTALLED_AUTO_CLEAR_MS)
    else if (stored?.phase === 'failed') armAutoClear(FAILED_AUTO_CLEAR_MS)
    return () => {
      mountedRef.current = false
      listeners.delete(listener)
      window.clearTimeout(clearTimerRef.current)
      window.clearTimeout(busyTimerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setPhaseBoth/armAutoClear 均为稳定引用
  }, [deviceId])

  const startInstall = useCallback(
    async (filePath: string, opts?: { allowLowTargetSdk?: boolean }): Promise<void> => {
      window.clearTimeout(clearTimerRef.current)
      emitPhase(deviceId, { phase: 'installing', fileName: fileNameOf(filePath) }, 0)
      const result = await toApiResult(window.api.install.install(deviceId, filePath, opts))
      if (!result.ok) {
        emitPhase(deviceId, { phase: 'failed', message: result.error }, FAILED_AUTO_CLEAR_MS)
        return
      }
      const outcome = result.data as ApkInstallOutcome
      if (outcome.ok) {
        emitPhase(
          deviceId,
          { phase: 'installed', fileName: outcome.fileName },
          INSTALLED_AUTO_CLEAR_MS
        )
      } else {
        // filePath 留原始绝对路径：「仍要安装」带旗标重发要用（文件名从它派生）
        emitPhase(
          deviceId,
          {
            phase: 'failed',
            message: outcome.message,
            canBypass: outcome.canBypassLowTargetSdk ? true : undefined,
            filePath
          },
          FAILED_AUTO_CLEAR_MS
        )
      }
    },
    [deviceId]
  )

  /** 失败卡「仍要安装」：同一文件带旗标重发（仅 canBypass 失败卡可触发） */
  const retryWithBypass = useCallback((): void => {
    const current = phaseRef.current
    if (current.phase !== 'failed' || !current.canBypass || !current.filePath) return
    void startInstall(current.filePath, { allowLowTargetSdk: true })
  }, [startInstall])

  const flashBusyNote = useCallback((): void => {
    window.clearTimeout(busyTimerRef.current)
    setBusyNote(true)
    busyTimerRef.current = window.setTimeout(() => {
      if (mountedRef.current) setBusyNote(false)
    }, BUSY_NOTE_CLEAR_MS)
  }, [])

  const onDragEnter = useCallback(
    (event: React.DragEvent): void => {
      // 悬停期拿不到文件名（安全限制），无法预判 .apk——先高亮，松开时再守卫
      if (!event.dataTransfer.types.includes('Files')) return
      event.preventDefault()
      const current = phaseRef.current
      // 安装中再拖入：保持 spinner 不打断（真实拖放序列 dragenter 先于 drop，
      // issue 2026-10-10-apk-install-busy-unreachable），以 busyNote 提示串行约束
      if (current.phase === 'installing') {
        flashBusyNote()
        return
      }
      // 已在高亮会话中：no-op，避免清掉 installed/failed 结果卡
      if (current.phase === 'dragging') return
      window.clearTimeout(clearTimerRef.current)
      setPhaseBoth({ phase: 'dragging' })
    },
    [flashBusyNote, setPhaseBoth]
  )

  const onDragOver = useCallback(
    (event: React.DragEvent): void => {
      if (!event.dataTransfer.types.includes('Files')) return
      // 必须 preventDefault 才允许 drop
      event.preventDefault()
      if (phaseRef.current.phase === 'idle') setPhaseBoth({ phase: 'dragging' })
    },
    [setPhaseBoth]
  )

  const onDragLeave = useCallback(
    (event: React.DragEvent): void => {
      // 只在真正离开舞台时收起：离开子元素（relatedTarget 仍在内）不收
      if (
        event.relatedTarget !== null &&
        event.currentTarget.contains(event.relatedTarget as Node)
      ) {
        return
      }
      if (phaseRef.current.phase === 'dragging') setPhaseBoth({ phase: 'idle' })
    },
    [setPhaseBoth]
  )

  const onDrop = useCallback(
    (event: React.DragEvent): void => {
      event.preventDefault()
      const current = phaseRef.current
      if (current.phase === 'installing') {
        // 安装中再拖入：不排队，4 秒提示后回到原状态
        flashBusyNote()
        return
      }
      const files = Array.from(event.dataTransfer.files)
      if (files.length !== 1) {
        if (phaseRef.current.phase === 'dragging') setPhaseBoth({ phase: 'idle' })
        return
      }
      const [filePath] = window.api.install.resolveDropPaths(files)
      if (!filePath || !isApkPath(filePath)) {
        // 非 .apk：静默无效（plan 边界），高亮收起
        if (phaseRef.current.phase === 'dragging') setPhaseBoth({ phase: 'idle' })
        return
      }
      void startInstall(filePath)
    },
    [flashBusyNote, setPhaseBoth, startInstall]
  )

  return {
    phase,
    busyNote,
    retryWithBypass,
    dragHandlers: { onDragEnter, onDragOver, onDragLeave, onDrop }
  }
}
