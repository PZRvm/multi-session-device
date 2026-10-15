import { randomUUID } from 'node:crypto'
import type { ScrcpyMediaStreamPacket } from '@yume-chan/scrcpy'
import { msg } from '../locale'
import { GopCache } from './cache'
import { startControlReader, wrapWriter } from './controlChannel'
import { destroySession } from './lifecycle'
import { handleMediaPacket, sendResync } from './media'
import { connectTcp, runAdb, spawnProc } from './proc'
import { establishTransport } from './transport'
import { ACK_STALL_MS, type ManagerContext, type StreamSession } from './types'

export const runSession = async (ctx: ManagerContext, session: StreamSession): Promise<void> => {
  const abort = session.abort
  try {
    const transport = await (ctx.deps.establish ?? establishTransport)({
      serial: session.serial,
      adbPath: ctx.deps.adbPath(),
      serverPath: ctx.serverPathFor(),
      run: (path, args, timeoutMs) => runAdb(path, args, timeoutMs),
      spawn: (path, args, env) => spawnProc(path, args, env),
      connect: (port) => connectTcp(port),
      toolEnv: ctx.deps.toolEnv,
      signal: abort.signal
    })
    if (abort.signal.aborted) {
      await transport.teardown()
      return
    }
    session.transport = transport
    session.writer = wrapWriter(transport)
    startControlReader(ctx, session)
    if (
      transport.videoSize.width <= 0 ||
      transport.videoSize.width > 65_535 ||
      transport.videoSize.height <= 0 ||
      transport.videoSize.height > 65_535
    ) {
      throw new Error(
        msg('videoSizeInvalid', {
          width: transport.videoSize.width,
          height: transport.videoSize.height
        })
      )
    }
    session.format = {
      codec: 'h264',
      width: transport.videoSize.width,
      height: transport.videoSize.height
    }
    session.state = 'ready'
    ctx.sendState(session)

    const reader = transport.mediaStream.getReader()
    let stallCheckAt = Date.now()
    for (;;) {
      if (abort.signal.aborted) break
      const { done, value } = await reader.read()
      if (done) break
      handleMediaPacket(ctx, session, value as ScrcpyMediaStreamPacket)

      // ACK 停滞检测：renderer 掉队就作废依赖段重新突发，不无限发送
      const now = Date.now()
      if (now - stallCheckAt > ACK_STALL_MS) {
        stallCheckAt = now
        if (
          session.resyncArmed &&
          session.outbox.length > 0 &&
          now - session.lastAckAt > ACK_STALL_MS &&
          ctx.active?.deviceId === session.deviceId
        ) {
          session.waitingResync = true
          sendResync(ctx, session)
        } else if (
          session.waitingResync &&
          now - session.lastAckAt > ACK_STALL_MS &&
          ctx.active?.deviceId === session.deviceId
        ) {
          // waitingResync 悬空自救（2026-10-15 息屏唤醒冻结根因）：长息屏后唤醒的
          // 突发帧同时打爆 GOP 缓存的 PTS 跨度预算（清链等关键帧）与未 ACK 包预算，
          // sendResync 拿不到可回放链即悬空丢包；渲染端照常 ACK 已收包 → outbox 归
          // 零 → 上方条件永不再触发，会话永久冻结（控制通道不受影响）。此处重试
          // sendResync：链恢复则重放解困，两轮仍空则 nullReplayStalls 走 resetVideo
          // 强制编码器出新配置包。lastAckAt 兼作重试节拍防风暴。
          sendResync(ctx, session)
          session.lastAckAt = Date.now()
        }
      }
    }
    session.state = 'closed'
  } catch (error) {
    if (abort.signal.aborted) return
    session.state = 'error'
    session.error = error instanceof Error ? error.message : String(error)
    ctx.sendState(session)
  } finally {
    await destroySession(ctx, session.deviceId)
  }
}

export const ensureSession = async (
  ctx: ManagerContext,
  device: {
    id: string
    runId: string
    serial: string
  }
): Promise<void> => {
  const existing = ctx.sessions.get(device.id)
  if (existing) {
    if (existing.runId === device.runId) return // 同代次幂等（并发 ensureSession 共享结果）
    await destroySession(ctx, device.id)
  }
  const session: StreamSession = {
    deviceId: device.id,
    runId: device.runId,
    serial: device.serial,
    streamId: randomUUID(),
    generation: 0,
    seq: 0,
    ptsBase: null,
    format: { codec: 'h264', width: 0, height: 0 },
    state: 'connecting',
    cache: new GopCache(),
    transport: null,
    writer: null,
    abort: new AbortController(),
    outbox: [],
    waitingResync: false,
    resyncArmed: true,
    nullReplayStalls: 0,
    lastAckAt: Date.now(),
    pressedPointers: new Set(),
    pressedKeys: new Set(),
    rotating: false,
    clipboardSequence: 0,
    clipboardWrites: 0,
    clipboardAcks: new Map(),
    cleanup: null
  }
  ctx.sessions.set(device.id, session)
  ctx.sendState(session)
  void runSession(ctx, session)
}
