import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LogcatBatchMessage } from '@shared/types'
import LogcatPanel from '../LogcatPanel'
import { MAIN_COPY } from '@shared/i18n'

const copy = MAIN_COPY['zh-CN']

type BatchListener = (message: LogcatBatchMessage) => void

describe('LogcatPanel', () => {
  let batchListener: BatchListener | null = null
  const subscribe = vi.fn(async () => undefined)
  const unsubscribe = vi.fn(async () => undefined)
  const ack = vi.fn(async () => undefined)

  const emitBatch = (message: LogcatBatchMessage): void => {
    act(() => {
      batchListener?.(message)
    })
  }

  const batchOf = (
    lines: Array<[number, string]>,
    extra?: Partial<LogcatBatchMessage>
  ): LogcatBatchMessage => ({
    deviceId: 'd1',
    runId: 'run-1',
    replay: false,
    lines: lines.map(([seq, text]) => ({ seq, text })),
    dropped: 0,
    ...extra
  })

  beforeEach(() => {
    vi.clearAllMocks()
    batchListener = null
    ;(window as unknown as { api: unknown }).api = {
      logcat: {
        subscribe,
        unsubscribe,
        ack,
        onBatch: (callback: BatchListener): (() => void) => {
          batchListener = callback
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

  it('订阅设备并渲染回放与实时行，批次即时回执', async () => {
    render(<LogcatPanel deviceId="d1" runId="run-1" />)
    await screen.findByRole('log')
    expect(subscribe).toHaveBeenCalledWith('d1')
    emitBatch(
      batchOf(
        [
          [1, 'hello'],
          [2, 'world']
        ],
        { replay: true }
      )
    )
    expect(screen.getByText('hello')).toBeTruthy()
    expect(screen.getByText('world')).toBeTruthy()
    expect(ack).toHaveBeenCalledWith({ deviceId: 'd1', upToSeq: 2 })
  })

  it('replay 首包整体重置视图（会话重建不残留旧行）', () => {
    render(<LogcatPanel deviceId="d1" runId="run-1" />)
    emitBatch(
      batchOf(
        [
          [1, 'old-a'],
          [2, 'old-b']
        ],
        { replay: true }
      )
    )
    expect(screen.getByText('old-a')).toBeTruthy()
    emitBatch(batchOf([[1, 'new-a']], { replay: true, runId: 'run-2' }))
    expect(screen.queryByText('old-a')).toBeNull()
    expect(screen.getByText('new-a')).toBeTruthy()
  })

  it('关键字过滤大小写不敏感，只作用于视图', () => {
    render(<LogcatPanel deviceId="d1" runId="run-1" />)
    emitBatch(
      batchOf(
        [
          [1, 'Activity started'],
          [2, 'Fatal EXCEPTION']
        ],
        { replay: true }
      )
    )
    fireEvent.change(screen.getByLabelText(copy.logcatFilterPlaceholder), {
      target: { value: 'fatal' }
    })
    expect(screen.queryByText('Activity started')).toBeNull()
    expect(screen.getByText('Fatal EXCEPTION')).toBeTruthy()
    // 清空过滤后全部恢复
    fireEvent.change(screen.getByLabelText(copy.logcatFilterPlaceholder), { target: { value: '' } })
    expect(screen.getByText('Activity started')).toBeTruthy()
  })

  it('暂停期间批次不入视图但照常回执；恢复后从最新行接入并留断点标记', () => {
    render(<LogcatPanel deviceId="d1" runId="run-1" />)
    emitBatch(batchOf([[1, 'before']], { replay: true }))
    fireEvent.click(screen.getByTitle(copy.logcatPause))
    emitBatch(batchOf([[2, 'during-pause']]))
    expect(screen.queryByText('during-pause')).toBeNull()
    expect(ack).toHaveBeenCalledWith({ deviceId: 'd1', upToSeq: 2 })
    fireEvent.click(screen.getByTitle(copy.logcatResume))
    expect(screen.getByText(copy.logcatResumed)).toBeTruthy()
    emitBatch(batchOf([[3, 'after-resume']]))
    expect(screen.getByText('after-resume')).toBeTruthy()
  })

  it('流控丢弃计数渲染为省略标记', () => {
    render(<LogcatPanel deviceId="d1" runId="run-1" />)
    emitBatch(batchOf([[1, 'kept']], { replay: true }))
    emitBatch(batchOf([[2, 'later']], { dropped: 120 }))
    expect(screen.getByText(copy.logcatDroppedLines.replace('{count}', '120'))).toBeTruthy()
  })

  it('清空只清视图；后续批次继续追加', () => {
    render(<LogcatPanel deviceId="d1" runId="run-1" />)
    emitBatch(batchOf([[1, 'gone-soon']], { replay: true }))
    fireEvent.click(screen.getByTitle(copy.logcatClear))
    expect(screen.queryByText('gone-soon')).toBeNull()
    emitBatch(batchOf([[2, 'fresh']]))
    expect(screen.getByText('fresh')).toBeTruthy()
  })

  it('无设备时显示空态且不订阅；有设备时显示日志空态', async () => {
    const { rerender } = render(<LogcatPanel deviceId={null} />)
    expect(screen.getByText(copy.logcatNoDevice)).toBeTruthy()
    expect(subscribe).not.toHaveBeenCalled()
    rerender(<LogcatPanel deviceId="d1" runId="run-1" />)
    await screen.findByRole('log')
    expect(screen.getByText(copy.logcatEmpty)).toBeTruthy()
  })

  it('弹出按钮回调（dock 模式）；日志窗模式不渲染弹出入口', () => {
    const onPopOut = vi.fn()
    const { rerender } = render(<LogcatPanel deviceId="d1" runId="run-1" onPopOut={onPopOut} />)
    fireEvent.click(screen.getByTitle(copy.logcatPopOut))
    expect(onPopOut).toHaveBeenCalledTimes(1)
    rerender(<LogcatPanel deviceId="d1" runId="run-1" />)
    expect(screen.queryByTitle(copy.logcatPopOut)).toBeNull()
  })

  it('订阅失败展示错误条（设备未运行等）', async () => {
    subscribe.mockRejectedValueOnce(new Error(copy.logcatNoDevice))
    render(<LogcatPanel deviceId="d1" runId="run-1" />)
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByText(copy.logcatNoDevice)).toBeTruthy()
  })

  it('卸载或换设备时退订旧设备', async () => {
    const { rerender } = render(<LogcatPanel deviceId="d1" runId="run-1" />)
    await screen.findByRole('log')
    rerender(<LogcatPanel deviceId="d2" runId="run-2" />)
    expect(unsubscribe).toHaveBeenCalledWith('d1')
    expect(subscribe).toHaveBeenLastCalledWith('d2')
  })
})
