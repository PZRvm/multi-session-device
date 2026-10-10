import { useCallback, useEffect, useRef, useState } from 'react'
import type { LogcatBatchMessage } from '@shared/types'
import { toApiResult } from '../api'

/** 视图行：日志原文或断点标记（流控丢弃 N 行 / 暂停恢复跳至最新） */
export type LogcatViewEntry =
  { kind: 'line'; seq: number; text: string } | { kind: 'gap'; count: number | null }

/** renderer 视图行数上限（与主进程环形缓冲同量级，超限裁最旧） */
const MAX_VIEW_LINES = 5000

export interface LogcatFeed {
  entries: LogcatViewEntry[]
  paused: boolean
  error: string | null
  togglePaused: () => void
  clear: () => void
}

/**
 * 设备日志订阅：消费方以 `key={deviceId:runId}` 挂载——设备重启即整体重挂，
 * replay 首包重置视图。暂停只是视图停更——批次照常 ack（不占 main 侧 backlog），
 * 恢复后从最新行接入。
 */
export const useLogcatFeed = (
  deviceId: string | null,
  runId: string | null | undefined
): LogcatFeed => {
  const [entries, setEntries] = useState<LogcatViewEntry[]>([])
  const [paused, setPaused] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pausedRef = useRef(false)

  useEffect(() => {
    pausedRef.current = paused
  }, [paused])

  useEffect(() => {
    if (!deviceId) return
    let alive = true
    void (async () => {
      const result = await toApiResult(window.api.logcat.subscribe(deviceId))
      if (alive && !result.ok) setError(result.error)
    })()
    const unbind = window.api.logcat.onBatch((message: LogcatBatchMessage) => {
      if (message.deviceId !== deviceId) return
      // 暂停也回执：不确认会让 main 侧积压并开始丢行
      const last = message.lines.length > 0 ? message.lines[message.lines.length - 1].seq : null
      if (last !== null) void window.api.logcat.ack({ deviceId, upToSeq: last })
      if (pausedRef.current) return
      setEntries((current) => {
        let next = message.replay
          ? message.lines.map((line) => ({ kind: 'line' as const, seq: line.seq, text: line.text }))
          : [
              ...current,
              ...message.lines.map((line) => ({
                kind: 'line' as const,
                seq: line.seq,
                text: line.text
              }))
            ]
        if (message.dropped > 0) next = [...next, { kind: 'gap', count: message.dropped }]
        // 视图裁剪：只数日志行，超过上限从最旧整段丢弃（与 main 环形缓冲同向）
        let lineCount = 0
        for (const entry of next) if (entry.kind === 'line') lineCount += 1
        if (lineCount > MAX_VIEW_LINES) {
          let excess = lineCount - MAX_VIEW_LINES
          next = next.filter((entry) => {
            if (excess === 0 || entry.kind === 'gap') return true
            excess -= 1
            return false
          })
        }
        return next
      })
    })
    return () => {
      alive = false
      unbind()
      void window.api.logcat.unsubscribe(deviceId).catch(() => undefined)
    }
  }, [deviceId, runId])

  // 恢复时补一个断点标记：暂停期间的行不入视图，从最新行继续
  const togglePaused = useCallback(() => {
    if (paused) setEntries((latest) => [...latest, { kind: 'gap', count: null }])
    setPaused(!paused)
  }, [paused])

  const clear = useCallback(() => {
    setEntries([])
  }, [])

  return { entries, paused, error, togglePaused, clear }
}
