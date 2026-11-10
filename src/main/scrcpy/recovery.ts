import { msg } from '../locale'
import { ACK_STALL_MS, type ManagerContext, type StreamSession } from './types'

/** 包括立即发送的第一次请求；最后一次再等一个间隔才报告失败。 */
export const VIDEO_RESET_ATTEMPTS = 3

export const cancelRecovery = (session: StreamSession): void => {
  if (session.recovery?.timer) clearTimeout(session.recovery.timer)
  session.recovery = null
}

/** 独立于视频 reader：零帧/写入失败也按有界节拍收敛，并拒绝旧会话/视图的回调。 */
export const startRecovery = (ctx: ManagerContext, session: StreamSession): void => {
  if (session.recovery) return
  const viewToken = ctx.viewTokenOf(session)
  if (!viewToken) return
  const recovery: NonNullable<StreamSession['recovery']> = {
    timer: null,
    viewToken,
    generation: session.generation
  }
  session.recovery = recovery
  session.waitingResync = true
  session.resyncArmed = false
  session.nullReplayStalls = 0
  session.recoveryProgress = null

  const tick = (): void => {
    if (session.recovery !== recovery) return
    if (
      session.abort.signal.aborted ||
      session.state !== 'ready' ||
      ctx.sessions.get(session.deviceId) !== session ||
      ctx.viewTokenOf(session) !== recovery.viewToken ||
      session.generation !== recovery.generation
    ) {
      cancelRecovery(session)
      return
    }
    if (session.resetAttempts >= VIDEO_RESET_ATTEMPTS) {
      cancelRecovery(session)
      session.waitingResync = false
      session.outbox = []
      session.state = 'error'
      session.error = msg('screenRecoveryTimeout')
      ctx.sendState(session)
      return
    }
    session.resetAttempts += 1
    void session.writer?.resetVideo().catch(() => undefined)
    recovery.timer = setTimeout(tick, ACK_STALL_MS)
  }
  tick()
}
