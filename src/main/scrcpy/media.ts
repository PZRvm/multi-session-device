import { h264ParseConfiguration } from '@yume-chan/scrcpy'
import type { ScrcpyMediaStreamPacket } from '@yume-chan/scrcpy'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import { GopCache, buildReplay, type CachedPacket } from './cache'
import { destroySession } from './lifecycle'
import { cancelRecovery, startRecovery } from './recovery'
import {
  MAX_UNACKED_BYTES,
  MAX_UNACKED_PACKETS,
  type ManagerContext,
  type StreamSession
} from './types'

export const sendPacket = (
  ctx: ManagerContext,
  session: StreamSession,
  packet: CachedPacket,
  viewToken: string
): void => {
  const webContents = ctx.mainWindowWebContents()
  if (!webContents) return
  webContents.send(IPC_CHANNELS.screenPacket, {
    deviceId: session.deviceId,
    runId: session.runId,
    streamId: session.streamId,
    generation: session.generation,
    viewToken,
    seq: packet.seq,
    type: packet.type,
    pts: packet.pts,
    keyframe: packet.keyframe,
    data: packet.data
  })
  if (packet.type === 'data') session.outbox.push(packet)
}

/**
 * 重同步突发：配置 + 当前完整链；renderer 以配置包为同步点，之后要求 seq 连续。
 * 激活/切回或实时发送已暂停时，无回放链就立刻 resetVideo，不能依赖设备定期出关键帧。
 * 未暂停的被动同步保留两轮退让；暂停后的独立计时器负责有界重试。
 */
export const sendResync = (
  ctx: ManagerContext,
  session: StreamSession,
  immediate = false
): void => {
  const viewToken = ctx.viewTokenOf(session)
  if (!viewToken) return
  const replay = buildReplay(session.cache)
  if (!replay) {
    if (immediate || session.waitingResync) {
      startRecovery(ctx, session)
      return
    }
    session.nullReplayStalls += 1
    if (session.nullReplayStalls >= 2) {
      session.nullReplayStalls = 0
      startRecovery(ctx, session)
    }
    return
  }
  session.nullReplayStalls = 0
  cancelRecovery(session)
  session.outbox = []
  for (const packet of replay) sendPacket(ctx, session, packet, viewToken)
  session.waitingResync = false
  session.resyncArmed = false
  session.lastAckAt = Date.now()
}

const unackedBytes = (session: StreamSession): number =>
  session.outbox.reduce((sum, packet) => sum + packet.data.byteLength, 0)

const overBudget = (session: StreamSession): boolean =>
  session.outbox.length > MAX_UNACKED_PACKETS || unackedBytes(session) > MAX_UNACKED_BYTES

export const handleMediaPacket = (
  ctx: ManagerContext,
  session: StreamSession,
  packet: ScrcpyMediaStreamPacket
): void => {
  if (session.state !== 'ready') return // 超时错误态保留重试入口，不再接纳迟到配置/视频
  if (packet.type === 'configuration') {
    cancelRecovery(session)
    // encoder 配置/尺寸重建：递增 generation、清旧 GOP 与发送窗
    session.generation += 1
    session.cache = new GopCache()
    session.ptsBase = null
    session.outbox = []
    session.waitingResync = false
    session.resyncArmed = true
    // 旋转后的新分辨率以配置包里的 SPS 为准（transport 元数据只反映首连尺寸）
    try {
      const { croppedWidth, croppedHeight } = h264ParseConfiguration(packet.data)
      if (
        croppedWidth > 0 &&
        croppedWidth <= 65_535 &&
        croppedHeight > 0 &&
        croppedHeight <= 65_535 &&
        (croppedWidth !== session.format.width || croppedHeight !== session.format.height)
      ) {
        session.format = { codec: 'h264', width: croppedWidth, height: croppedHeight }
        if (session.state === 'ready') ctx.sendState(session)
      }
    } catch {
      // 解析失败不阻塞流：输入尺寸校验用旧值，renderer 同样以帧实际尺寸绘制
    }
  }
  // Tango 的 pts 是 bigint（µs）——IPC 边界转 Number（µs 值域内安全）
  const cached: CachedPacket = {
    seq: session.seq,
    type: packet.type,
    pts: packet.type === 'data' && packet.pts !== undefined ? Number(packet.pts) : undefined,
    keyframe: packet.type === 'data' ? packet.keyframe : undefined,
    data: packet.data
  }
  session.seq += 1
  if (cached.type === 'data' && session.ptsBase === null && cached.pts !== undefined) {
    session.ptsBase = cached.pts
  }
  try {
    session.cache.push(cached)
  } catch (error) {
    session.state = 'error'
    session.error = error instanceof Error ? error.message : String(error)
    ctx.sendState(session)
    void destroySession(ctx, session.deviceId)
    return
  }

  const viewToken = ctx.viewTokenOf(session)
  if (!viewToken) return // 后台会话：只收包与缓存，停 renderer 解码
  if (session.waitingResync && cached.type !== 'configuration') return
  sendPacket(ctx, session, cached, viewToken)

  // 预算/停滞都只在武装状态下触发，突发后等 ACK 再武装（防风暴）
  if (session.resyncArmed && overBudget(session)) {
    session.waitingResync = true
    sendResync(ctx, session)
  }
}
