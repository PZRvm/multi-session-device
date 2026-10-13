import { msg } from '../locale'
import { CLIPBOARD_ACK_TIMEOUT_MS } from './control'
import { destroySession } from './lifecycle'
import type { ManagerContext, StreamSession } from './types'

export const clipboardPaste = (
  ctx: ManagerContext,
  session: StreamSession,
  content: string
): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    const writer = session.writer
    if (!writer) {
      reject(new Error(msg('controlChannelUnavailable')))
      return
    }
    // 库保留未确认序列号，超时降级后仍需限制数量，直到 ACK 或会话关闭。
    if (session.clipboardWrites >= 64 || session.clipboardSequence >= Number.MAX_SAFE_INTEGER) {
      reject(new Error(msg('clipboardBacklog')))
      return
    }
    const sequence = ++session.clipboardSequence
    session.clipboardWrites += 1
    const finish = (ok: boolean, error?: unknown): void => {
      if (!session.clipboardAcks.delete(sequence)) return
      clearTimeout(timer)
      if (ok) resolve()
      else reject(error instanceof Error ? error : new Error(msg('clipboardChannelClosed')))
    }
    // 缺 ACK 时保留既有派发降级；确认仅代表服务端收到，不证明控件接受粘贴。
    const timer = setTimeout(() => finish(true), CLIPBOARD_ACK_TIMEOUT_MS)
    session.clipboardAcks.set(sequence, (ok) => finish(ok))
    writer.setClipboard({ content, paste: true, sequence: BigInt(sequence) }).then(
      () => {
        session.clipboardWrites -= 1
        finish(true)
      },
      (error: unknown) => {
        session.clipboardWrites -= 1
        finish(false, error)
        if (!session.abort.signal.aborted) {
          session.state = 'error'
          session.error = msg('clipboardSendFailed', {
            message: error instanceof Error ? error.message : String(error)
          })
          ctx.sendState(session)
          void destroySession(ctx, session.deviceId)
        }
      }
    )
  })
