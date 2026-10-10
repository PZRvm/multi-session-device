import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useLogcatFeed } from '../useLogcatFeed'
import type { LogcatBatchMessage } from '@shared/types'

const subscribe = vi.fn<(deviceId: string) => Promise<void>>(async () => undefined)
const unsubscribe = vi.fn<(deviceId: string) => Promise<void>>(async () => undefined)
const ack = vi.fn<(payload: { deviceId: string; upToSeq: number }) => Promise<void>>(
  async () => undefined
)
let batchListener: ((message: LogcatBatchMessage) => void) | null = null

const batch = (overrides: Partial<LogcatBatchMessage>): LogcatBatchMessage =>
  ({
    deviceId: 'd1',
    replay: false,
    dropped: 0,
    lines: [],
    ...overrides
  }) as LogcatBatchMessage

const line = (seq: number, text = `l${seq}`): { seq: number; text: string } => ({ seq, text })

const emitBatch = (message: LogcatBatchMessage): void => {
  act(() => {
    batchListener?.(message)
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  batchListener = null
  ;(window as unknown as { api: unknown }).api = {
    logcat: {
      subscribe,
      unsubscribe,
      ack,
      onBatch: (listener: (message: LogcatBatchMessage) => void): (() => void) => {
        batchListener = listener
        return () => {
          batchListener = null
        }
      }
    }
  }
})

afterEach(() => {
  cleanup()
  delete (window as unknown as { api?: unknown }).api
})

describe('useLogcatFeed', () => {
  it('订阅 + 批次消费：行入视图，批次按尾行 ack，卸载退订', () => {
    const { result, unmount } = renderHook(() => useLogcatFeed('d1', 'run-1'))
    expect(subscribe).toHaveBeenCalledWith('d1')
    emitBatch(batch({ lines: [line(1), line(2)] }))
    expect(result.current.entries).toEqual([
      { kind: 'line', seq: 1, text: 'l1' },
      { kind: 'line', seq: 2, text: 'l2' }
    ])
    expect(ack).toHaveBeenCalledWith({ deviceId: 'd1', upToSeq: 2 })
    unmount()
    expect(unsubscribe).toHaveBeenCalledWith('d1')
  })

  it('订阅失败置 error；ack reject 被吞——不产生 unhandled rejection，后续批次照常消费', async () => {
    subscribe.mockRejectedValue(new Error('boom'))
    ack.mockRejectedValue(new Error('ack rejected'))
    const { result } = renderHook(() => useLogcatFeed('d1', 'run-1'))
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(result.current.error).toContain('boom')
    emitBatch(batch({ lines: [line(1)] }))
    expect(result.current.entries).toHaveLength(1)
    expect(ack).toHaveBeenCalledTimes(1)
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    emitBatch(batch({ lines: [line(2)] }))
    expect(ack).toHaveBeenCalledTimes(2)
    expect(result.current.entries).toHaveLength(2)
  })

  it('replay 批次整体重置视图（不追加旧内容）', () => {
    const { result } = renderHook(() => useLogcatFeed('d1', 'run-1'))
    emitBatch(batch({ lines: [line(1)] }))
    emitBatch(batch({ replay: true, lines: [line(5), line(6)] }))
    expect(result.current.entries).toEqual([
      { kind: 'line', seq: 5, text: 'l5' },
      { kind: 'line', seq: 6, text: 'l6' }
    ])
  })

  it('dropped>0 补 gap 标记；暂停期间批次 ack 但不入视图，恢复补断点标记', () => {
    const { result } = renderHook(() => useLogcatFeed('d1', 'run-1'))
    emitBatch(batch({ lines: [line(1)], dropped: 7 }))
    expect(result.current.entries.at(-1)).toEqual({ kind: 'gap', count: 7 })
    act(() => {
      result.current.togglePaused()
    })
    emitBatch(batch({ lines: [line(2)] }))
    expect(ack).toHaveBeenCalledWith({ deviceId: 'd1', upToSeq: 2 })
    expect(result.current.entries).toHaveLength(2)
    act(() => {
      result.current.togglePaused()
    })
    expect(result.current.entries.at(-1)).toEqual({ kind: 'gap', count: null })
  })

  it('视图裁剪有界：超限时丢弃段内的 gap 一并裁掉', () => {
    const { result } = renderHook(() => useLogcatFeed('d1', 'run-1'))
    emitBatch(batch({ lines: [line(1), line(2), line(3)], dropped: 3 }))
    emitBatch(batch({ lines: Array.from({ length: 5001 }, (_, i) => line(4 + i)) }))
    const entries = result.current.entries
    // 3 + 5001 = 5004 行，超限 4：头部 4 行 + 旧 gap（落在丢弃段内）一并裁掉
    expect(entries).toHaveLength(5000)
    expect(entries[0]).toEqual({ kind: 'line', seq: 5, text: 'l5' })
    expect(entries.some((entry) => entry.kind === 'gap')).toBe(false)
  })

  it('裁剪时相邻 gap 合并计数；断点标记（null）合并后保持 null', () => {
    const { result } = renderHook(() => useLogcatFeed('d1', 'run-1'))
    emitBatch(batch({ lines: Array.from({ length: 5000 }, (_, i) => line(i + 1)) }))
    emitBatch(batch({ dropped: 5 }))
    emitBatch(batch({ dropped: 8 }))
    // 3 行新批次触发裁剪（5003 > 5000）：相邻 g5 + g8 合并成 g13
    emitBatch(batch({ lines: [line(6001), line(6002), line(6003)] }))
    const gaps = result.current.entries.filter((entry) => entry.kind === 'gap')
    expect(gaps).toHaveLength(1)
    expect(gaps[0]).toEqual({ kind: 'gap', count: 13 })

    const second = renderHook(() => useLogcatFeed('d1', 'run-1'))
    emitBatch(batch({ lines: Array.from({ length: 5000 }, (_, i) => line(i + 1)) }))
    emitBatch(batch({ dropped: 5 }))
    // 暂停→恢复各一 act：同一 act 里连点两次会读到过期 paused，断点标记不落
    act(() => {
      second.result.current.togglePaused()
    })
    act(() => {
      second.result.current.togglePaused()
    })
    emitBatch(batch({ lines: [line(6001)] }))
    const merged = second.result.current.entries.filter((entry) => entry.kind === 'gap')
    expect(merged).toHaveLength(1)
    expect(merged[0]).toEqual({ kind: 'gap', count: null })
  })
})
