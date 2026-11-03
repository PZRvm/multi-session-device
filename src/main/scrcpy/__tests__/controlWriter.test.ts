// @vitest-environment node
import { AdbScrcpyOptionsLatest } from '@yume-chan/adb-scrcpy'
import { ScrcpyInstanceId } from '@yume-chan/scrcpy'
import { SafeControlMessageWriter } from '../controlWriter'
import { Consumable, WritableStream } from '@yume-chan/stream-extra'
import { describe, expect, it, vi } from 'vitest'

describe('控制发送失败的完整收口', () => {
  it.each(['immediate', 'deferred'] as const)(
    '%s 写失败后关闭 parser 不产生独立 rejection',
    async (mode) => {
      const options = new AdbScrcpyOptionsLatest<true>({
        scid: new ScrcpyInstanceId(1),
        audio: false,
        clipboardAutosync: true
      })
      const failure = new Error('synthetic socket write failed')
      const stream = new WritableStream<Uint8Array>({
        write: () =>
          mode === 'immediate'
            ? Promise.reject(failure)
            : new Promise((_resolve, reject) => setTimeout(() => reject(failure), 0))
      })
      const writer = new SafeControlMessageWriter(
        new Consumable.WrapWritableStream(stream).getWriter(),
        options as never
      )
      await expect(
        writer.setClipboard({ content: 'test', paste: true, sequence: 1n })
      ).rejects.toBe(failure)
      options.deviceMessageParsers.close()
      await new Promise((resolve) => setTimeout(resolve, 5))
      await writer.close().catch(() => undefined)
    }
  )

  it('写成功仍等 ACK；parser 关闭只拒绝一次', async () => {
    const options = new AdbScrcpyOptionsLatest<true>({
      scid: new ScrcpyInstanceId(2),
      audio: false,
      clipboardAutosync: true
    })
    const written = vi.fn()
    const writer = new SafeControlMessageWriter(
      new Consumable.WrapWritableStream(
        new WritableStream<Uint8Array>({ write: written })
      ).getWriter(),
      options as never
    )
    const settled = vi.fn()
    const pending = writer
      .setClipboard({ content: 'test', paste: true, sequence: 1n })
      .then(settled, settled)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(written).toHaveBeenCalledOnce()
    expect(settled).not.toHaveBeenCalled()
    options.deviceMessageParsers.close()
    await pending
    expect(settled).toHaveBeenCalledOnce()
    await writer.close()
  })
})
