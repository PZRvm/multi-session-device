// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createClipboardSync, CLIPBOARD_MAX_BYTES, type ClipboardTarget } from '../clipboardSync'

const target = (id = 'a', viewToken = 'view'): ClipboardTarget => ({
  deviceId: id,
  runId: 'run',
  streamId: 'stream',
  viewToken,
  session: {}
})

describe('剪贴板同步协调器', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())
  const setup = (): {
    sync: ReturnType<typeof createClipboardSync>
    setHost: (text: string | null, formats?: string[]) => void
    read: ReturnType<typeof vi.fn>
    write: ReturnType<typeof vi.fn>
    send: ReturnType<typeof vi.fn>
    error: ReturnType<typeof vi.fn>
    current: ClipboardTarget
  } => {
    let snapshot = { text: 'initial' as string | null, formats: ['text/plain'] }
    const read = vi.fn(() => snapshot)
    const write = vi.fn((text: string) => {
      snapshot = { text, formats: ['text/plain'] }
    })
    const send = vi.fn(async () => {})
    const error = vi.fn()
    const sync = createClipboardSync({
      readSnapshot: read,
      writeText: write,
      send,
      reportError: error,
      isCurrent: () => true
    })
    const current = target()
    sync.rebind(current)
    return {
      sync,
      read,
      write,
      send,
      error,
      current,
      setHost: (text, formats = text === null ? ['image/png'] : ['text/plain']) => {
        snapshot = { text, formats }
      }
    }
  }

  it('首次不覆盖，300ms 变化才发送；空串/图片不清空，A→图片→A 仍同步', async () => {
    const h = setup()
    await vi.advanceTimersByTimeAsync(900)
    expect(h.send).not.toHaveBeenCalled()
    h.setHost('中文 😀\n ')
    await vi.advanceTimersByTimeAsync(299)
    expect(h.send).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(h.send.mock.calls[0].slice(0, 2)).toEqual([h.current, '中文 😀\n '])
    h.setHost('')
    await vi.advanceTimersByTimeAsync(300)
    h.setHost(null)
    await vi.advanceTimersByTimeAsync(300)
    expect(h.send).toHaveBeenCalledTimes(1)
    h.setHost('中文 😀\n ')
    await vi.advanceTimersByTimeAsync(300)
    expect(h.send).toHaveBeenCalledTimes(2)
    h.sync.dispose()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('设备复制写宿主并更新基线，不反射；后台/空串/旧绑定不写', async () => {
    const h = setup()
    h.sync.acceptDeviceText(target('background'), 'wrong')
    h.sync.acceptDeviceText(h.current, '')
    h.sync.acceptDeviceText(h.current, '设备\n😀')
    expect(h.write).toHaveBeenCalledExactlyOnceWith('设备\n😀')
    await vi.advanceTimersByTimeAsync(600)
    expect(h.send).not.toHaveBeenCalled()
    const next = target('b')
    h.sync.rebind(next)
    h.sync.acceptDeviceText(h.current, 'late')
    expect(h.write).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(1)
    h.sync.dispose()
  })

  it('设备事件发现宿主尚未采样变化时，宿主优先；相同文本不破坏富文本格式', () => {
    const h = setup()
    h.setHost('new host')
    h.sync.acceptDeviceText(h.current, 'racing device')
    expect(h.write).not.toHaveBeenCalled()
    expect(h.send).toHaveBeenCalledOnce()
    h.setHost('new host', ['text/plain', 'text/html'])
    h.sync.acceptDeviceText(h.current, 'new host')
    expect(h.write).not.toHaveBeenCalled()
    h.sync.dispose()
  })

  it('本程序输入回声不回写，记录 2 秒后过期；同步 revision 与切换撤销旧队列资格', async () => {
    const h = setup()
    h.sync.observeLocalWrite(h.current, '内部组合', 'composition')
    h.sync.acceptDeviceText(h.current, '内部组合')
    expect(h.write).not.toHaveBeenCalled()
    h.setHost('one')
    await vi.advanceTimersByTimeAsync(300)
    const valid = h.send.mock.calls[0][2] as () => boolean
    expect(valid()).toBe(true)
    h.setHost('two')
    await vi.advanceTimersByTimeAsync(300)
    expect(valid()).toBe(false)
    const valid2 = h.send.mock.calls[1][2] as () => boolean
    h.sync.rebind(target('a', 'new-view'))
    expect(valid2()).toBe(false)
    await vi.advanceTimersByTimeAsync(2100)
    const newer = target('c')
    h.sync.rebind(newer)
    h.sync.acceptDeviceText(newer, '内部组合')
    expect(h.write).toHaveBeenCalledWith('内部组合')
    h.sync.dispose()
  })

  it('大小预算按 UTF-8；读取失败退避、成功恢复；写失败仍可再收到推送', async () => {
    const h = setup()
    h.setHost('中'.repeat(Math.ceil(CLIPBOARD_MAX_BYTES / 3)))
    await vi.advanceTimersByTimeAsync(300)
    expect(h.send).not.toHaveBeenCalled()
    expect(h.error.mock.calls[0][0]).toBe('oversize')
    h.sync.acceptDeviceText(h.current, 'a'.repeat(CLIPBOARD_MAX_BYTES + 1))
    expect(h.error).toHaveBeenCalledTimes(1)
    h.read.mockImplementationOnce(() => {
      throw new Error('read denied')
    })
    await vi.advanceTimersByTimeAsync(300)
    const count = h.read.mock.calls.length
    await vi.advanceTimersByTimeAsync(2999)
    expect(h.read).toHaveBeenCalledTimes(count)
    h.setHost('good')
    await vi.advanceTimersByTimeAsync(1)
    expect(h.send).toHaveBeenCalledOnce()
    h.write.mockImplementationOnce(() => {
      throw new Error('write denied')
    })
    h.sync.acceptDeviceText(h.current, 'device')
    h.sync.acceptDeviceText(h.current, 'device')
    expect(h.write).toHaveBeenCalledTimes(2)
    expect(h.error.mock.calls.map(([kind]) => kind)).toEqual(['oversize', 'read', 'write'])
    h.sync.dispose()
  })

  it('rebind(null) 后零采样，晚到写失败不报告；同绑定幂等不重新取基线', async () => {
    const h = setup()
    h.setHost('next')
    h.sync.rebind(h.current)
    await vi.advanceTimersByTimeAsync(300)
    expect(h.send).toHaveBeenCalledOnce()
    h.sync.rebind(null)
    const count = h.read.mock.calls.length
    await vi.advanceTimersByTimeAsync(900)
    expect(h.read).toHaveBeenCalledTimes(count)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('写宿主后的核验若读到另一应用的新复制，不把它吞成自身基线', async () => {
    const h = setup()
    h.write.mockImplementationOnce(() => h.setHost('another app'))
    h.sync.acceptDeviceText(h.current, 'device copy')
    await vi.advanceTimersByTimeAsync(300)
    expect(h.send.mock.calls[0].slice(0, 2)).toEqual([h.current, 'another app'])
    h.sync.dispose()
  })

  it('首次读失败恢复只建基线；自身写入后读失败不反射平台格式差异', async () => {
    const h = setup()
    h.read.mockImplementationOnce(() => {
      throw new Error('denied')
    })
    h.sync.rebind(target('b'))
    h.setHost('during failure')
    await vi.advanceTimersByTimeAsync(3000)
    expect(h.send).not.toHaveBeenCalled()
    h.sync.rebind(h.current)
    h.read
      .mockImplementationOnce(() => ({ text: 'during failure', formats: ['text/plain'] }))
      .mockImplementationOnce(() => {
        throw new Error('after write')
      })
    h.sync.acceptDeviceText(h.current, 'device')
    h.setHost('device', ['public.utf8-plain-text'])
    await vi.advanceTimersByTimeAsync(3000)
    expect(h.send).not.toHaveBeenCalled()
    h.sync.dispose()
  })

  it.each(['before-bind', 'after-bind'] as const)(
    '%s 的 32MiB 超限正文不参与轮询序列化或全文扫描，恢复原正常文本仍同步',
    async (when) => {
      const h = setup()
      const huge = 'x'.repeat(32 * 1024 * 1024)
      const stringify = vi.spyOn(JSON, 'stringify')
      const byteLength = vi.spyOn(Buffer, 'byteLength')
      try {
        if (when === 'before-bind') h.sync.rebind(null)
        h.setHost(huge)
        if (when === 'before-bind') h.sync.rebind(h.current)
        await vi.advanceTimersByTimeAsync(3600)
        expect(h.send).not.toHaveBeenCalled()
        expect(
          stringify.mock.calls.some(([value]) => {
            const text = (value as { text?: unknown } | null)?.text
            return typeof text === 'string' && text.length > CLIPBOARD_MAX_BYTES
          })
        ).toBe(false)
        expect(byteLength.mock.calls.some(([text]) => text === huge)).toBe(false)
        expect(h.error).toHaveBeenCalledTimes(when === 'before-bind' ? 0 : 1)
        h.setHost('initial')
        await vi.advanceTimersByTimeAsync(300)
        expect(h.send.mock.calls[0].slice(0, 2)).toEqual([h.current, 'initial'])
      } finally {
        h.sync.dispose()
        stringify.mockRestore()
        byteLength.mockRestore()
      }
    }
  )

  it('UTF-8 临界值按字节拦截，超限使旧 pending 失效且告警去重', async () => {
    const h = setup()
    const atLimit =
      '中'.repeat(Math.floor(CLIPBOARD_MAX_BYTES / 3)) + 'a'.repeat(CLIPBOARD_MAX_BYTES % 3)
    h.setHost(atLimit)
    await vi.advanceTimersByTimeAsync(300)
    expect(h.send).toHaveBeenCalledOnce()
    const valid = h.send.mock.calls[0][2] as () => boolean
    expect(valid()).toBe(true)
    h.setHost(atLimit + 'a')
    await vi.advanceTimersByTimeAsync(300)
    expect(valid()).toBe(false)
    expect(h.send).toHaveBeenCalledTimes(1)
    expect(h.error).toHaveBeenCalledExactlyOnceWith('oversize', h.current)
    h.setHost('😀'.repeat(CLIPBOARD_MAX_BYTES / 2))
    await vi.advanceTimersByTimeAsync(600)
    expect(h.send).toHaveBeenCalledTimes(1)
    expect(h.error).toHaveBeenCalledTimes(1)
    h.setHost(null)
    await vi.advanceTimersByTimeAsync(300)
    h.setHost(atLimit)
    await vi.advanceTimersByTimeAsync(300)
    expect(h.send).toHaveBeenCalledTimes(2)
    h.sync.dispose()
  })
})
