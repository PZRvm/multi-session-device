import { useCallback, useEffect, useRef, useState } from 'react'
import { toApiResult } from '../api'
import type { ApkInstallResult } from '@shared/types'

// 拖拽 APK 安装状态机（plan 2026-10-10-drag-apk-install）：dragging 高亮 → installing
// （不定进度）→ installed / failed；busyNote 是安装中再次拖入的 4 秒提示。
// 守卫在两处：这里先拦「单文件 + .apk + 未在安装中」，main 再校验 running/serial 与串行。

export type ApkInstallPhase =
  | { phase: 'idle' }
  | { phase: 'dragging' }
  | { phase: 'installing'; fileName: string }
  | { phase: 'installed'; fileName: string }
  | { phase: 'failed'; message: string }

const INSTALLED_AUTO_CLEAR_MS = 5_000
const FAILED_AUTO_CLEAR_MS = 10_000
const BUSY_NOTE_CLEAR_MS = 4_000

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
  dragHandlers: {
    onDragEnter: (event: React.DragEvent) => void
    onDragOver: (event: React.DragEvent) => void
    onDragLeave: (event: React.DragEvent) => void
    onDrop: (event: React.DragEvent) => void
  }
} => {
  const [phase, setPhase] = useState<ApkInstallPhase>({ phase: 'idle' })
  const [busyNote, setBusyNote] = useState(false)
  const mountedRef = useRef(false)
  const phaseRef = useRef<ApkInstallPhase>({ phase: 'idle' })
  const clearTimerRef = useRef(0)
  const busyTimerRef = useRef(0)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      window.clearTimeout(clearTimerRef.current)
      window.clearTimeout(busyTimerRef.current)
    }
  }, [])

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

  const startInstall = useCallback(
    async (filePath: string): Promise<void> => {
      window.clearTimeout(clearTimerRef.current)
      setPhaseBoth({ phase: 'installing', fileName: fileNameOf(filePath) })
      const result = await toApiResult(window.api.install.install(deviceId, filePath))
      if (!mountedRef.current) return
      if (result.ok) {
        const { fileName } = result.data as ApkInstallResult
        setPhaseBoth({ phase: 'installed', fileName })
        armAutoClear(INSTALLED_AUTO_CLEAR_MS)
      } else {
        setPhaseBoth({ phase: 'failed', message: result.error })
        armAutoClear(FAILED_AUTO_CLEAR_MS)
      }
    },
    [armAutoClear, deviceId, setPhaseBoth]
  )

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

  return { phase, busyNote, dragHandlers: { onDragEnter, onDragOver, onDragLeave, onDrop } }
}
