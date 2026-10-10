import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { connect as tcpConnect, type Socket } from 'node:net'
import { app, ipcMain, type BrowserWindow, type WebContents } from 'electron'
import {
  BufferedReadableStream,
  Consumable,
  ReadableStream,
  WritableStream
} from '@yume-chan/stream-extra'
import type { AndroidKeyCode, ScrcpyMediaStreamPacket } from '@yume-chan/scrcpy'
import { h264ParseConfiguration, type ScrcpyControlMessageWriter } from '@yume-chan/scrcpy'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import type { ScreenAckMessage, ScreenFormat, ScreenStateMessage } from '@shared/types'
import { scrubAdbEnv } from '../emulator/adb'
import { buildReplay, GopCache, type CachedPacket } from './cache'
import {
  CLIPBOARD_ACK_TIMEOUT_MS,
  chunkUtf8,
  injectInput,
  validateInputRequest,
  type InjectContext
} from './control'
import { establishTransport, SCRCPY_SERVER_VERSION, type Transport } from './transport'
import { SafeControlMessageWriter } from './controlWriter'
import { msg } from '../locale'

// ---- 预算（设计值，超限走重同步而非积压）----
/** 未确认包数/字节上限（IPC 背压；重同步突发不受此限，由缓存上限约束） */
export const MAX_UNACKED_PACKETS = 16
export const MAX_UNACKED_BYTES = 2 * 1024 * 1024
/** ACK 停滞（renderer 掉队/丢失）后强制重同步的间隔 */
export const ACK_STALL_MS = 3_000

export interface ScrcpyManagerDeps {
  adbPath: () => string
  toolEnv: () => NodeJS.ProcessEnv
  getMainWindow: () => BrowserWindow | null
  isMainSender: (sender: Electron.WebContents) => boolean
  /** 传输建立接缝（单测注入 fake transport） */
  establish?: typeof establishTransport
  /** 手动旋转的 adb 命令接缝 */
  runAdb?: typeof runAdb
}

type SessionState = 'connecting' | 'ready' | 'error' | 'closed'

interface StreamSession {
  deviceId: string
  runId: string
  serial: string
  streamId: string
  generation: number
  seq: number
  ptsBase: number | null
  format: ScreenFormat
  state: SessionState
  error?: string
  cache: GopCache
  transport: Transport | null
  writer: ScrcpyControlMessageWriter | null
  abort: AbortController
  /** 当前视图代次的未确认发送窗（重同步时整体作废重建） */
  outbox: CachedPacket[]
  /** 等待重同步突发（突发前不零散发数据包） */
  waitingResync: boolean
  /** 触发过一次重同步后需等 ACK 再武装（防重同步风暴） */
  resyncArmed: boolean
  /** 重同步时缓存无关键帧的连续次数（≥2 才升级 resetVideo） */
  nullReplayStalls: number
  lastAckAt: number
  /** 按下指针（兜底释放） */
  pressedPointers: Set<number>
  /** 已接受的按下键（暂停前由 main 释放） */
  pressedKeys: Set<AndroidKeyCode>
  /** 方向锁定与旋转期间丢弃所有新输入 */
  rotating: boolean
  clipboardSequence: number
  clipboardWrites: number
  clipboardAcks: Map<number, (ok: boolean) => void>
  /** 唯一清理 Promise（幂等） */
  cleanup: Promise<void> | null
}

export interface ScrcpyManager {
  ensureSession: (device: { id: string; runId: string; serial: string }) => Promise<void>
  destroySession: (deviceId: string) => Promise<void>
  destroyAll: () => Promise<void>
  activeDeviceId: () => string | null
  registerIpc: () => void
}

export function createScrcpyManager(deps: ScrcpyManagerDeps): ScrcpyManager {
  const sessions = new Map<string, StreamSession>()
  let active: { deviceId: string; viewToken: string } | null = null

  const serverPathFor = (): string =>
    app.isPackaged
      ? join(process.resourcesPath, `scrcpy-server-v${SCRCPY_SERVER_VERSION}`)
      : join(app.getAppPath(), 'resources', `scrcpy-server-v${SCRCPY_SERVER_VERSION}`)

  const mainWindowWebContents = (): WebContents | null => {
    const window = deps.getMainWindow()
    return window && !window.isDestroyed() ? window.webContents : null
  }

  const viewTokenOf = (session: StreamSession): string =>
    active?.deviceId === session.deviceId ? active.viewToken : ''

  const buildState = (session: StreamSession): ScreenStateMessage => ({
    deviceId: session.deviceId,
    runId: session.runId,
    streamId: session.streamId,
    generation: session.generation,
    viewToken: viewTokenOf(session),
    status: session.state,
    format: session.state === 'ready' ? session.format : undefined,
    error: session.error
  })

  const sendState = (session: StreamSession): void => {
    mainWindowWebContents()?.send(IPC_CHANNELS.screenState, buildState(session))
  }

  const wrapWriter = (transport: Transport): ScrcpyControlMessageWriter => {
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

  const startControlReader = (session: StreamSession): void => {
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
        sendState(session)
        await destroySession(session.deviceId)
      } finally {
        unlink()
        session.abort.signal.removeEventListener('abort', onAbort)
        await buffered.cancel().catch(() => undefined)
      }
    })()
  }

  const clipboardPaste = (session: StreamSession, content: string): Promise<void> =>
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
            sendState(session)
            void destroySession(session.deviceId)
          }
        }
      )
    })

  // ---- 发送与重同步 ----

  const sendPacket = (session: StreamSession, packet: CachedPacket, viewToken: string): void => {
    const webContents = mainWindowWebContents()
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
   * immediate（激活/切回）：缓存没有关键帧就立刻 resetVideo——新视图正等首帧；
   * stall（渲染端已有画面）：先被动等关键帧（≤1 个关键帧间隔），连续两轮未恢复才 resetVideo。
   */
  const sendResync = (session: StreamSession, immediate = false): void => {
    const viewToken = viewTokenOf(session)
    if (!viewToken) return
    const replay = buildReplay(session.cache)
    if (!replay) {
      if (immediate) {
        void session.writer?.resetVideo().catch(() => undefined)
        return
      }
      session.nullReplayStalls += 1
      if (session.nullReplayStalls >= 2) {
        session.nullReplayStalls = 0
        void session.writer?.resetVideo().catch(() => undefined)
      }
      return
    }
    session.nullReplayStalls = 0
    session.outbox = []
    for (const packet of replay) sendPacket(session, packet, viewToken)
    session.waitingResync = false
    session.resyncArmed = false
    session.lastAckAt = Date.now()
  }

  const unackedBytes = (session: StreamSession): number =>
    session.outbox.reduce((sum, packet) => sum + packet.data.byteLength, 0)

  const overBudget = (session: StreamSession): boolean =>
    session.outbox.length > MAX_UNACKED_PACKETS || unackedBytes(session) > MAX_UNACKED_BYTES

  // ---- 会话生命周期 ----

  function handleMediaPacket(session: StreamSession, packet: ScrcpyMediaStreamPacket): void {
    if (packet.type === 'configuration') {
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
          if (session.state === 'ready') sendState(session)
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
      sendState(session)
      void destroySession(session.deviceId)
      return
    }

    const viewToken = viewTokenOf(session)
    if (!viewToken) return // 后台会话：只收包与缓存，停 renderer 解码
    if (session.waitingResync && cached.type !== 'configuration') return
    sendPacket(session, cached, viewToken)

    // 预算/停滞都只在武装状态下触发，突发后等 ACK 再武装（防风暴）
    if (session.resyncArmed && overBudget(session)) {
      session.waitingResync = true
      sendResync(session)
    }
  }

  async function runSession(session: StreamSession): Promise<void> {
    const abort = session.abort
    try {
      const transport = await (deps.establish ?? establishTransport)({
        serial: session.serial,
        adbPath: deps.adbPath(),
        serverPath: serverPathFor(),
        run: (path, args, timeoutMs) => runAdb(path, args, timeoutMs),
        spawn: (path, args, env) => spawnProc(path, args, env),
        connect: (port) => connectTcp(port),
        toolEnv: deps.toolEnv,
        signal: abort.signal
      })
      if (abort.signal.aborted) {
        await transport.teardown()
        return
      }
      session.transport = transport
      session.writer = wrapWriter(transport)
      startControlReader(session)
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
      sendState(session)

      const reader = transport.mediaStream.getReader()
      let stallCheckAt = Date.now()
      for (;;) {
        if (abort.signal.aborted) break
        const { done, value } = await reader.read()
        if (done) break
        handleMediaPacket(session, value as ScrcpyMediaStreamPacket)

        // ACK 停滞检测：renderer 掉队就作废依赖段重新突发，不无限发送
        const now = Date.now()
        if (now - stallCheckAt > ACK_STALL_MS) {
          stallCheckAt = now
          if (
            session.resyncArmed &&
            session.outbox.length > 0 &&
            now - session.lastAckAt > ACK_STALL_MS &&
            active?.deviceId === session.deviceId
          ) {
            session.waitingResync = true
            sendResync(session)
          }
        }
      }
      session.state = 'closed'
    } catch (error) {
      if (abort.signal.aborted) return
      session.state = 'error'
      session.error = error instanceof Error ? error.message : String(error)
      sendState(session)
    } finally {
      await destroySession(session.deviceId)
    }
  }

  const cleanupSession = async (session: StreamSession): Promise<void> => {
    // 幂等清理：撤销活动归属 → abort 循环 → 关 writer/socket → 结束 server → 删 forward
    session.abort.abort()
    if (active?.deviceId === session.deviceId) active = null
    try {
      void session.writer?.close().catch(() => undefined)
    } catch {
      // 已断
    }
    session.writer = null
    for (const resolve of session.clipboardAcks.values()) resolve(false)
    session.clipboardAcks.clear()
    try {
      await session.transport?.teardown()
    } catch {
      // 每步各自吞错
    }
    session.transport = null
    sessions.delete(session.deviceId)
    session.state = 'closed'
  }

  async function destroySession(deviceId: string): Promise<void> {
    const session = sessions.get(deviceId)
    if (!session) return
    if (!session.cleanup) session.cleanup = cleanupSession(session)
    await session.cleanup
  }

  async function ensureSession(device: {
    id: string
    runId: string
    serial: string
  }): Promise<void> {
    const existing = sessions.get(device.id)
    if (existing) {
      if (existing.runId === device.runId) return // 同代次幂等（并发 ensureSession 共享结果）
      await destroySession(device.id)
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
    sessions.set(device.id, session)
    sendState(session)
    void runSession(session)
  }

  async function destroyAll(): Promise<void> {
    await Promise.allSettled([...sessions.keys()].map((deviceId) => destroySession(deviceId)))
    active = null
  }

  // ---- IPC ----

  const requireReadySession = (sender: Electron.WebContents): StreamSession => {
    if (!deps.isMainSender(sender)) throw new Error(msg('screenUnregisteredWindow'))
    if (!active) throw new Error(msg('screenNoActiveView'))
    const session = sessions.get(active.deviceId)
    if (!session || session.state !== 'ready') throw new Error(msg('screenSessionNotReady'))
    return session
  }

  function registerIpc(): void {
    ipcMain.handle(
      IPC_CHANNELS.screenActivate,
      async (event, raw: unknown): Promise<ScreenStateMessage | null> => {
        if (!deps.isMainSender(event.sender)) throw new Error(msg('screenUnregisteredWindow'))
        if (typeof raw !== 'object' || raw === null) throw new Error('screen:activate: 非法的入参')
        const value = raw as Record<string, unknown>
        const id = value['id']
        const viewToken = value['viewToken']
        if (id !== null && typeof id !== 'string') throw new Error('screen:activate: 非法的 id')
        if (typeof viewToken !== 'string' || viewToken.length === 0) {
          throw new Error('screen:activate: 非法的 viewToken')
        }
        if (id === null) {
          active = null
          return null
        }
        const session = sessions.get(id)
        active = { deviceId: id, viewToken }
        if (!session || session.state !== 'ready') {
          // 未就绪也登记：状态推送随后会到，renderer 按连接态渲染
          return session ? buildState(session) : null
        }
        // 激活即换绑视图：突发回放衔接（监听已由 renderer 先装好），seq 从回放起连续
        session.outbox = []
        session.lastAckAt = Date.now()
        session.resyncArmed = false
        sendResync(session, true)
        return { ...buildState(session), viewToken }
      }
    )

    ipcMain.handle(IPC_CHANNELS.screenRetry, async (event, raw: unknown): Promise<void> => {
      if (!deps.isMainSender(event.sender)) throw new Error(msg('screenUnregisteredWindow'))
      if (typeof raw !== 'object' || raw === null) throw new Error('screen:retry: 非法的入参')
      const value = raw as Record<string, unknown>
      if (typeof value['id'] !== 'string' || typeof value['runId'] !== 'string') {
        throw new Error('screen:retry: 非法的入参')
      }
      const session = sessions.get(value['id'])
      if (!session) throw new Error(msg('retryNoSession'))
      if (session.runId !== value['runId']) throw new Error(msg('retryGenerationStale'))
      await destroySession(value['id'])
      await ensureSession({ id: value['id'], runId: value['runId'], serial: session.serial })
    })

    ipcMain.handle(IPC_CHANNELS.screenAck, (event, raw: unknown): void => {
      const session = requireReadySession(event.sender)
      const ack = raw as Partial<ScreenAckMessage> | null
      if (
        !ack ||
        ack.viewToken !== active?.viewToken ||
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
      const session = requireReadySession(event.sender)
      const request = validateInputRequest(raw)
      if (!request) throw new Error('screen:input: 非法的入参')
      if (
        request.deviceId !== session.deviceId ||
        request.runId !== session.runId ||
        request.streamId !== session.streamId ||
        request.generation !== session.generation ||
        request.viewToken !== active?.viewToken
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
        clipboardPaste: (content) => clipboardPaste(session, content),
        lockRotation: async () => {
          // scrcpy 会恢复原先的自动旋转；先同步冻结当前方向，手动切换才会保持。
          const result = await (deps.runAdb ?? runAdb)(
            deps.adbPath(),
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
            sessions.get(session.deviceId) !== session ||
            active?.deviceId !== session.deviceId ||
            active.viewToken !== request.viewToken ||
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

  return {
    ensureSession,
    destroySession,
    destroyAll,
    activeDeviceId: () => active?.deviceId ?? null,
    registerIpc
  }
}

// ---- 进程工具（真实实现；单测整体替换 manager deps 或 transport deps）----

const runAdb = (
  path: string,
  args: string[],
  timeoutMs: number
): Promise<{ code: number; stdout: string; stderr: string }> =>
  new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(path, args, { env: scrubAdbEnv(process.env) })
    const out: Buffer[] = []
    const err: Buffer[] = []
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs)
    child.stdout?.on('data', (chunk: Buffer) => out.push(chunk))
    child.stderr?.on('data', (chunk: Buffer) => err.push(chunk))
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({
        code: code ?? -1,
        stdout: Buffer.concat(out).toString('utf8'),
        stderr: Buffer.concat(err).toString('utf8').slice(-2000)
      })
    })
  })

const spawnProc = (path: string, args: string[], env: NodeJS.ProcessEnv): ChildProcess =>
  spawn(path, args, { env })

const connectTcp = (port: number): Promise<Socket> =>
  new Promise((resolve, reject) => {
    const socket = tcpConnect({ host: '127.0.0.1', port })
    socket.once('connect', () => resolve(socket))
    socket.once('error', reject)
  })
