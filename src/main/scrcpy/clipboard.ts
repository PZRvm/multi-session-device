import { msg } from '../locale'
import { createClipboardQueue } from './clipboardQueue'
import type { ClipboardSource, ClipboardTarget } from './clipboardSync'
import { destroySession } from './lifecycle'
import type { ManagerContext, StreamSession } from './types'

/** 所有 clipboard 写入共用实际 writer 单飞队列；显式输入的 2s 降级不释放队列。 */
export function queueClipboard(
  ctx: ManagerContext,
  session: StreamSession,
  target: ClipboardTarget,
  text: string,
  source: ClipboardSource,
  valid: () => boolean
): Promise<void> {
  if (!session.clipboardQueue) {
    session.clipboardQueue = createClipboardQueue({
      error: (kind) =>
        new Error(
          msg(
            kind === 'backlog'
              ? 'clipboardBacklog'
              : kind === 'stale'
                ? 'inputStale'
                : kind === 'timeout'
                  ? 'clipboardWriteTimeout'
                  : 'clipboardChannelClosed'
          )
        ),
      write: async (job) => {
        const writer = session.writer
        if (!writer || session.abort.signal.aborted)
          throw new Error(msg('controlChannelUnavailable'))
        if (session.clipboardSequence >= Number.MAX_SAFE_INTEGER)
          throw new Error(msg('clipboardBacklog'))
        ctx.clipboardSync.observeLocalWrite(target, job.text, job.source)
        const sequence = ++session.clipboardSequence
        await writer.setClipboard({
          content: job.text,
          paste: job.source !== 'sync',
          sequence: BigInt(sequence)
        })
        if (!session.abort.signal.aborted)
          ctx.clipboardSync.observeLocalWrite(target, job.text, job.source)
      },
      onFailure: (error) => {
        if (session.abort.signal.aborted) return
        session.state = 'error'
        session.error = msg('clipboardSendFailed', { message: error.message })
        ctx.sendState(session)
        void destroySession(ctx, session.deviceId)
      }
    })
  }
  return session.clipboardQueue.enqueue({ text, source, valid })
}

export const clipboardPaste = (
  ctx: ManagerContext,
  session: StreamSession,
  content: string,
  source: 'paste' | 'composition' = 'composition',
  valid: () => boolean = () =>
    !session.abort.signal.aborted &&
    ctx.sessions.get(session.deviceId) === session &&
    ctx.active?.deviceId === session.deviceId
): Promise<void> =>
  queueClipboard(
    ctx,
    session,
    {
      session,
      deviceId: session.deviceId,
      runId: session.runId,
      streamId: session.streamId,
      viewToken: ctx.active?.viewToken ?? ''
    },
    content,
    source,
    valid
  )
