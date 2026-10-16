import type { ManagerContext, StreamSession } from './types'
import { cancelRecovery } from './recovery'

export const cleanupSession = async (
  ctx: ManagerContext,
  session: StreamSession,
  preserveActive = false
): Promise<void> => {
  // 幂等清理：撤销活动归属 → abort 循环 → 关 writer/socket → 结束 server → 删 forward
  session.abort.abort()
  if (ctx.active?.deviceId === session.deviceId) ctx.clipboardSync.rebind(null)
  session.clipboardQueue?.dispose()
  session.clipboardQueue = null
  cancelRecovery(session)
  if (!preserveActive && ctx.active?.deviceId === session.deviceId) ctx.active = null
  try {
    void session.writer?.close().catch(() => undefined)
  } catch {
    // 已断
  }
  session.writer = null
  try {
    await session.transport?.teardown()
  } catch {
    // 每步各自吞错
  }
  session.transport = null
  ctx.sessions.delete(session.deviceId)
  session.state = 'closed'
}

export const destroySession = async (
  ctx: ManagerContext,
  deviceId: string,
  preserveActive = false
): Promise<void> => {
  const session = ctx.sessions.get(deviceId)
  if (!session) return
  if (!session.cleanup) session.cleanup = cleanupSession(ctx, session, preserveActive)
  await session.cleanup
}

export const destroyAll = async (ctx: ManagerContext): Promise<void> => {
  ctx.clipboardSync.dispose()
  await Promise.allSettled(
    [...ctx.sessions.keys()].map((deviceId) => destroySession(ctx, deviceId))
  )
  ctx.active = null
}
