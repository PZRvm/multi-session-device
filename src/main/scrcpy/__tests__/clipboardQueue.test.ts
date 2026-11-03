// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createClipboardQueue } from '../clipboardQueue'

describe('剪贴板写入队列', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())
  const setup = (): {
    queue: ReturnType<typeof createClipboardQueue>
    write: ReturnType<typeof vi.fn>
    failure: ReturnType<typeof vi.fn>
    done: Array<() => void>
  } => {
    const done: Array<() => void> = []
    const write = vi.fn(() => new Promise<void>((resolve) => done.push(resolve)))
    const failure = vi.fn()
    const queue = createClipboardQueue({
      write,
      onFailure: failure,
      error: (kind) => new Error(kind)
    })
    return { queue, write, failure, done }
  }
  const job = (
    text: string,
    source: 'sync' | 'paste' | 'composition' = 'paste',
    valid = (): boolean => true
  ): {
    text: string
    source: 'sync' | 'paste' | 'composition'
    valid: () => boolean
  } => ({ text, source, valid })

  it('单飞，显式 FIFO 优先、同步仅保留最新；过期任务不写', async () => {
    const h = setup()
    const p1 = h.queue.enqueue(job('first'))
    const old = h.queue.enqueue(job('old', 'sync'))
    const latest = h.queue.enqueue(job('latest', 'sync'))
    const p2 = h.queue.enqueue(job('IME', 'composition'))
    const stale = h.queue.enqueue(job('stale', 'paste', () => false)).catch((e: Error) => e)
    expect(h.write).toHaveBeenCalledTimes(1)
    h.done[0]()
    await p1
    expect(h.write.mock.calls[1][0].text).toBe('IME')
    h.done[1]()
    await p2
    expect(await stale).toEqual(new Error('stale'))
    expect(h.write.mock.calls[2][0].text).toBe('latest')
    h.done[2]()
    await latest
    await old
    expect(h.write).toHaveBeenCalledTimes(3)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('2s 外层降级不解除单飞，晚 ACK 后才开始下一任务', async () => {
    const h = setup()
    const p = h.queue.enqueue(job('first'))
    const next = h.queue.enqueue(job('second'))
    await vi.advanceTimersByTimeAsync(2000)
    await p
    expect(h.write).toHaveBeenCalledTimes(1)
    h.done[0]()
    await vi.advanceTimersByTimeAsync(0)
    expect(h.write).toHaveBeenCalledTimes(2)
    h.done[1]()
    await next
    h.queue.dispose()
  })

  it('5s 底层超时关队列，拒绝尚未执行任务；晚到 resolve 不重开', async () => {
    const h = setup()
    const first = h.queue.enqueue(job('first'))
    const next = h.queue.enqueue(job('second')).catch((e: Error) => e)
    await vi.advanceTimersByTimeAsync(5000)
    await first
    expect(await next).toEqual(new Error('closed'))
    expect(h.failure).toHaveBeenCalledExactlyOnceWith(new Error('timeout'))
    expect(vi.getTimerCount()).toBe(0)
    h.done[0]()
    await vi.advanceTimersByTimeAsync(0)
    expect(h.write).toHaveBeenCalledTimes(1)
  })

  it('等待队列最多 16；取消立即拒绝，底层晚拒绝被观察', async () => {
    const h = setup()
    const all = [h.queue.enqueue(job('active')).catch((e: Error) => e)]
    for (let i = 0; i < 16; i++) all.push(h.queue.enqueue(job(`queued${i}`)).catch((e: Error) => e))
    await expect(h.queue.enqueue(job('overflow'))).rejects.toThrow('backlog')
    h.queue.dispose()
    expect((await Promise.all(all)).every((e) => e instanceof Error)).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('同步和同步 throw 的写失败均立即清队列并观察拒绝', async () => {
    const h = setup()
    h.write.mockImplementationOnce(() => {
      throw new Error('write failed')
    })
    await expect(h.queue.enqueue(job('first'))).rejects.toThrow('write failed')
    expect(h.failure).toHaveBeenCalledOnce()
    await expect(h.queue.enqueue(job('second'))).rejects.toThrow('closed')
    expect(vi.getTimerCount()).toBe(0)
  })
})
