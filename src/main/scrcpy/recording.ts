import type { ScrcpyMediaStreamPacket } from '@yume-chan/scrcpy'
import type { ScreenFormat } from '@shared/types'
import type { ManagerContext, StreamSession } from './types'

export interface RecordingIdentity {
  deviceId: string
  runId: string
  streamId: string
}
export interface RecordingSource extends RecordingIdentity {
  serial: string
  format: ScreenFormat
  configuration: Uint8Array | null
}
export interface RecordingObserver {
  packet: (packet: ScrcpyMediaStreamPacket, format: ScreenFormat) => void
  ended: (reason: string) => void
}
const observers = new WeakMap<StreamSession, Set<RecordingObserver>>()
const resets = new WeakMap<StreamSession, Promise<void>>()
const find = (ctx: ManagerContext, identity: RecordingIdentity): StreamSession | undefined => {
  const session = ctx.sessions.get(identity.deviceId)
  return session?.state === 'ready' &&
    session.runId === identity.runId &&
    session.streamId === identity.streamId
    ? session
    : undefined
}
export const getRecordingSource = (ctx: ManagerContext, id: string): RecordingSource | null => {
  const session = ctx.sessions.get(id)
  if (!session || session.state !== 'ready') return null
  return {
    deviceId: id,
    runId: session.runId,
    streamId: session.streamId,
    serial: session.serial,
    format: { ...session.format },
    configuration: session.cache.snapshot().config?.data.slice() ?? null
  }
}
export const subscribeRecordingSource = (
  ctx: ManagerContext,
  identity: RecordingIdentity,
  observer: RecordingObserver
): (() => void) => {
  const session = find(ctx, identity)
  if (!session) throw new Error('Recording source expired')
  let set = observers.get(session)
  if (!set) {
    set = new Set()
    observers.set(session, set)
  }
  set.add(observer)
  return () => {
    set.delete(observer)
  }
}
export const dispatchRecordingPacket = (
  session: StreamSession,
  packet: ScrcpyMediaStreamPacket
): void => {
  for (const observer of observers.get(session) ?? []) {
    try {
      observer.packet(packet, session.format)
    } catch {
      /* 录制故障不得中断投屏 reader */
    }
  }
}
export const endRecordingSource = (session: StreamSession): void => {
  const set = observers.get(session)
  observers.delete(session)
  for (const observer of set ?? []) {
    try {
      observer.ended(session.error ?? 'source-ended')
    } catch {
      /* 独立消费者 */
    }
  }
}
export const requestRecordingKeyFrame = async (
  ctx: ManagerContext,
  identity: RecordingIdentity
): Promise<void> => {
  const session = find(ctx, identity)
  if (!session?.writer) throw new Error('Recording source expired')
  let pending = resets.get(session)
  if (!pending) {
    pending = session.writer.resetVideo().finally(() => {
      resets.delete(session)
    })
    resets.set(session, pending)
  }
  await pending
}
