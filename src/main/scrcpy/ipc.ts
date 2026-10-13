import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import type { ScreenAckMessage, ScreenStateMessage } from '@shared/types'
import { msg } from '../locale'
import { clipboardPaste } from './clipboard'
import { chunkUtf8, injectInput, validateInputRequest, type InjectContext } from './control'
import { destroySession } from './lifecycle'
import { sendResync } from './media'
import { runAdb } from './proc'
import { ensureSession } from './session'
import type { ManagerContext, StreamSession } from './types'

const requireReadySession = (ctx: ManagerContext, sender: Electron.WebContents): StreamSession => {
  if (!ctx.deps.isMainSender(sender)) throw new Error(msg('screenUnregisteredWindow'))
  if (!ctx.active) throw new Error(msg('screenNoActiveView'))
  const session = ctx.sessions.get(ctx.active.deviceId)
  if (!session || session.state !== 'ready') throw new Error(msg('screenSessionNotReady'))
  return session
}

export const registerIpc = (ctx: ManagerContext): void => {
  ipcMain.handle(
    IPC_CHANNELS.screenActivate,
    async (event, raw: unknown): Promise<ScreenStateMessage | null> => {
      if (!ctx.deps.isMainSender(event.sender)) throw new Error(msg('screenUnregisteredWindow'))
      if (typeof raw !== 'object' || raw === null) throw new Error(msg('activateInvalidPayload'))
      const value = raw as Record<string, unknown>
      const id = value['id']
      const viewToken = value['viewToken']
      if (id !== null && typeof id !== 'string') throw new Error(msg('activateInvalidId'))
      if (typeof viewToken !== 'string' || viewToken.length === 0) {
        throw new Error(msg('activateInvalidViewToken'))
      }
      if (id === null) {
        ctx.active = null
        return null
      }
      const session = ctx.sessions.get(id)
      ctx.active = { deviceId: id, viewToken }
      if (!session || session.state !== 'ready') {
        // 未就绪也登记：状态推送随后会到，renderer 按连接态渲染
        return session ? ctx.buildState(session) : null
      }
      // 激活即换绑视图：突发回放衔接（监听已由 renderer 先装好），seq 从回放起连续
      session.outbox = []
      session.lastAckAt = Date.now()
      session.resyncArmed = false
      sendResync(ctx, session, true)
      return { ...ctx.buildState(session), viewToken }
    }
  )

  ipcMain.handle(IPC_CHANNELS.screenRetry, async (event, raw: unknown): Promise<void> => {
    if (!ctx.deps.isMainSender(event.sender)) throw new Error(msg('screenUnregisteredWindow'))
    if (typeof raw !== 'object' || raw === null) throw new Error(msg('retryInvalidPayload'))
    const value = raw as Record<string, unknown>
    if (typeof value['id'] !== 'string' || typeof value['runId'] !== 'string') {
      throw new Error(msg('retryInvalidPayload'))
    }
    const session = ctx.sessions.get(value['id'])
    if (!session) throw new Error(msg('retryNoSession'))
    if (session.runId !== value['runId']) throw new Error(msg('retryGenerationStale'))
    await destroySession(ctx, value['id'])
    await ensureSession(ctx, { id: value['id'], runId: value['runId'], serial: session.serial })
  })

  ipcMain.handle(IPC_CHANNELS.screenAck, (event, raw: unknown): void => {
    const session = requireReadySession(ctx, event.sender)
    const ack = raw as Partial<ScreenAckMessage> | null
    if (
      !ack ||
      ack.viewToken !== ctx.active?.viewToken ||
      ack.generation !== session.generation ||
      !Number.isFinite(ack.throughSeq)
    ) {
      return // 旧代次/旧视图的 ACK 直接忽略
    }
    if ((ack.throughSeq as number) > session.seq) return // 拒绝大于已发送 seq 的 ACK
    session.outbox = session.outbox.filter((packet) => packet.seq > (ack.throughSeq as number))
    session.lastAckAt = Date.now()
    session.resyncArmed = true
  })

  ipcMain.handle(IPC_CHANNELS.screenInput, async (event, raw: unknown): Promise<void> => {
    const session = requireReadySession(ctx, event.sender)
    const request = validateInputRequest(raw)
    if (!request) throw new Error(msg('inputInvalidPayload'))
    if (
      request.deviceId !== session.deviceId ||
      request.runId !== session.runId ||
      request.streamId !== session.streamId ||
      request.generation !== session.generation ||
      request.viewToken !== ctx.active?.viewToken
    ) {
      throw new Error(msg('inputStale'))
    }
    if (request.width !== session.format.width || request.height !== session.format.height) {
      throw new Error(msg('inputSizeMismatch'))
    }
    const writer = session.writer
    if (!writer) throw new Error(msg('inputControlUnavailable'))
    if (session.rotating) return
    const context: InjectContext = {
      writer,
      width: session.format.width,
      height: session.format.height,
      pressedPointers: session.pressedPointers,
      pressedKeys: session.pressedKeys,
      clipboardPaste: (content) => clipboardPaste(ctx, session, content),
      lockRotation: async () => {
        // scrcpy 会恢复原先的自动旋转；先同步冻结当前方向，手动切换才会保持。
        const result = await (ctx.deps.runAdb ?? runAdb)(
          ctx.deps.adbPath(),
          ['-s', session.serial, 'shell', 'wm', 'user-rotation', 'lock'],
          10_000
        )
        if (result.code !== 0) {
          throw new Error(
            msg('rotateLockFailed', { detail: result.stderr || result.stdout || result.code })
          )
        }
        if (
          session.abort.signal.aborted ||
          ctx.sessions.get(session.deviceId) !== session ||
          ctx.active?.deviceId !== session.deviceId ||
          ctx.active.viewToken !== request.viewToken ||
          session.generation !== request.generation
        ) {
          throw new Error(msg('inputStaleDuringRotation'))
        }
      }
    }
    if (request.input.kind === 'text') {
      if (request.input.ime) {
        // IME 组合文本：设备侧剪贴板 + 粘贴（ACK 只证明协议确认）
        await context.clipboardPaste(request.input.text)
        return
      }
      for (const chunk of chunkUtf8(request.input.text)) {
        await writer.injectText(chunk)
      }
      return
    }
    if (request.input.kind === 'rotate') {
      // 在第一个 await 前封住新手势，成功、失败或会话取消都解除守卫。
      session.rotating = true
      try {
        await injectInput(request, context)
      } finally {
        session.rotating = false
      }
    } else {
      await injectInput(request, context)
    }
  })
}
