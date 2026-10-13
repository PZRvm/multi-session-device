import {
  BufferedReadableStream,
  Consumable,
  ReadableStream,
  WritableStream
} from '@yume-chan/stream-extra'
import type { ScrcpyControlMessageWriter } from '@yume-chan/scrcpy'
import { msg } from '../locale'
import { SafeControlMessageWriter } from './controlWriter'
import { destroySession } from './lifecycle'
import type { Transport } from './transport'
import type { ManagerContext, StreamSession } from './types'

export const wrapWriter = (transport: Transport): ScrcpyControlMessageWriter => {
  const controlRaw = new WritableStream<Uint8Array>({
    write: (chunk) =>
      new Promise<void>((resolve, reject) => {
        transport.controlSocket.write(chunk, (error) => (error ? reject(error) : resolve()))
      }),
    close: () =>
      new Promise<void>((resolve) => {
        transport.controlSocket.end(resolve)
      }),
    abort: () => {
      transport.controlSocket.destroy()
    }
  })
  return new SafeControlMessageWriter(
    new Consumable.WrapWritableStream(controlRaw).getWriter(),
    transport.options as never
  )
}

// ---- 控制读侧使用与 writer 同一份协议解析器；剪贴板同步只消费，不写宿主 ----

export const startControlReader = (ctx: ManagerContext, session: StreamSession): void => {
  const transport = session.transport
  if (!transport) return
  const socket = transport.controlSocket
  const parsers = transport.options.deviceMessageParsers
  let queuedBytes = 0
  let messageBytes = 0
  let settled = false
  let controller: ReadableStreamDefaultController<Uint8Array>
  const source = new ReadableStream<Uint8Array>({
    start: (value) => {
      controller = value
    }
  })
  const buffered = new BufferedReadableStream(source)
  const exact = {
    get position(): number {
      return buffered.position
    },
    async readExactly(length: number): Promise<Uint8Array> {
      // 在协议库按声明长度分配内存前检查；同时约束粘连包/未完成分片的积压。
      if (!Number.isSafeInteger(length) || length < 0 || messageBytes + length > 1024 * 1024) {
        throw new Error(msg('controlBudgetExceeded'))
      }
      messageBytes += length
      const value = await buffered.readExactly(length)
      queuedBytes -= length
      return value
    }
  }
  const onData = (chunk: Buffer): void => {
    queuedBytes += chunk.length
    if (queuedBytes > 2 * 1024 * 1024) {
      controller.error(new Error(msg('controlBufferExceeded')))
      unlink()
      return
    }
    controller.enqueue(chunk)
  }
  const onEnd = (): void => {
    unlink()
    controller.close()
  }
  const onError = (error: Error): void => {
    unlink()
    controller.error(error)
  }
  const unlink = (): void => {
    socket.off('data', onData)
    socket.off('end', onEnd)
    socket.off('close', onEnd)
    socket.off('error', onError)
  }
  const onAbort = (): void => {
    unlink()
    if (!settled) {
      settled = true
      parsers.close()
    }
    void buffered.cancel().catch(() => undefined)
  }
  socket.on('data', onData)
  socket.on('end', onEnd)
  socket.on('close', onEnd)
  socket.on('error', onError)
  session.abort.signal.addEventListener('abort', onAbort, { once: true })

  // ClipboardStream 有背压；不消费会让后续 ACK 卡在同步消息后面。
  const clipboardReader = transport.options.clipboard?.getReader()
  if (clipboardReader) {
    void (async () => {
      try {
        while (!(await clipboardReader.read()).done) {
          // 丢弃设备剪贴板内容，保持现有单向粘贴行为。
        }
      } catch {
        // 错误由控制读循环报告。
      } finally {
        clipboardReader.releaseLock()
      }
    })()
  }
  void (async () => {
    try {
      for (;;) {
        messageBytes = 0
        const id = (await exact.readExactly(1))[0]
        await parsers.parse(id, exact)
      }
    } catch (error) {
      if (session.abort.signal.aborted) return
      settled = true
      parsers.error(error)
      session.state = 'error'
      session.error = msg('controlStreamReadFailed', {
        message: error instanceof Error ? error.message : String(error)
      })
      ctx.sendState(session)
      await destroySession(ctx, session.deviceId)
    } finally {
      unlink()
      session.abort.signal.removeEventListener('abort', onAbort)
      await buffered.cancel().catch(() => undefined)
    }
  })()
}
