import type { ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import type { Socket } from 'node:net'
import { AdbScrcpyOptionsLatest } from '@yume-chan/adb-scrcpy'
import type { ScrcpyMediaStreamPacket, ScrcpyOptions } from '@yume-chan/scrcpy'
import { ScrcpyCodecOptions, ScrcpyInstanceId as InstanceId } from '@yume-chan/scrcpy'

export const SCRCPY_SERVER_VERSION = '3.3.3'
/** 构建期钉死的官方 3.3.3 二进制（resources/），运行时逐会话校验 */
export const SCRCPY_SERVER_SHA256 =
  '7e70323ba7f259649dd4acce97ac4fefbae8102b2c6d91e2e7be613fd5354be0'
export const DEVICE_SERVER_PATH = '/data/local/tmp/mst_scrcpy_server.jar'

/** 首次连接总预算（可取消）：失败回收后由 renderer 展示重试 */
export const CONNECT_BUDGET_MS = 15_000
/** video socket 的 dummy byte 单轮等待 */
export const DUMMY_BYTE_TIMEOUT_MS = 1_000
/** 转发类 adb 命令的超时 */
export const FORWARD_TIMEOUT_MS = 10_000
/** forward 清理的超时 */
export const FORWARD_REMOVE_TIMEOUT_MS = 5_000

export interface RunResult {
  code: number
  stdout: string
  stderr: string
}

export interface TransportDeps {
  serial: string
  adbPath: string
  serverPath: string
  run: (path: string, args: string[], timeoutMs: number) => Promise<RunResult>
  spawn: (path: string, args: string[], env: NodeJS.ProcessEnv) => ChildProcess
  connect: (port: number) => Promise<Socket>
  toolEnv: () => NodeJS.ProcessEnv
  signal: AbortSignal
}

export interface Transport {
  scid: string
  serverProc: ChildProcess
  /** `tcp:<port>`——清理时只 remove 这一条 */
  forwardSpec: string
  videoSocket: Socket
  controlSocket: Socket
  mediaStream: ReadableStream<ScrcpyMediaStreamPacket>
  options: ScrcpyOptions<object>
  videoSize: { width: number; height: number }
  /** 幂等清理：任何一步报错仍尝试其余步骤；禁止 forward --remove-all 或碰别的 server */
  teardown: () => Promise<void>
}

/** 校验钉死 server 的 SHA-256——缺失/不匹配直接失败，不用下载缓存兜底 */
export async function verifyServerBinary(path: string): Promise<void> {
  let buffer: Buffer
  try {
    buffer = await readFile(path)
  } catch {
    throw new Error(`scrcpy server 缺失（${path}），安装包不完整`)
  }
  const digest = createHash('sha256').update(buffer).digest('hex')
  if (digest !== SCRCPY_SERVER_SHA256) {
    throw new Error('scrcpy server 校验失败（sha256 不匹配），拒绝使用')
  }
}

const readFirstChunk = (socket: Socket, signal: AbortSignal): Promise<Buffer | null> =>
  new Promise((resolve) => {
    const cleanup = (): void => {
      socket.removeListener('error', onError)
      socket.removeListener('data', onData)
      signal.removeEventListener('abort', onAbort)
    }
    const onAbort = (): void => {
      cleanup()
      resolve(null)
    }
    const onError = (): void => {
      cleanup()
      resolve(null)
    }
    const onData = (chunk: Buffer): void => {
      cleanup()
      socket.pause()
      resolve(chunk)
    }
    signal.addEventListener('abort', onAbort, { once: true })
    socket.once('error', onError)
    socket.once('data', onData)
  })

/** socket → web 流：跳过 dummy byte 的剩余字节先行入流（分片/粘包安全） */
const socketToStream = (socket: Socket, initial: Uint8Array): ReadableStream<Uint8Array> => {
  const source: UnderlyingDefaultSource<Uint8Array> = {
    start: (controller) => {
      if (initial.length > 0) controller.enqueue(initial)
      socket.resume()
      socket.on('data', (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)))
      socket.on('close', () => {
        try {
          controller.close()
        } catch {
          // 已 error
        }
      })
      socket.on('error', (error) => controller.error(error))
    },
    cancel: () => {
      socket.destroy()
    }
  }
  return new ReadableStream<Uint8Array>(source)
}

/**
 * 建立一条 scrcpy 传输（PoC 已验证路径）：
 * push server → 启动 server → 独立 scid 的 forward tcp:0 → video dummy-byte
 * 握手（以 dummy byte 到达为准超时重连）→ control → 解析媒体流。
 */
export async function establishTransport(deps: TransportDeps): Promise<Transport> {
  const { signal, serial } = deps
  if (signal.aborted) throw new Error('aborted')
  await verifyServerBinary(deps.serverPath)

  const push = await deps.run(
    deps.adbPath,
    ['-s', serial, 'push', deps.serverPath, DEVICE_SERVER_PATH],
    30_000
  )
  if (push.code !== 0) throw new Error(`scrcpy-server push 失败：${push.stderr}`)

  const scid = InstanceId.random()
  const options = new AdbScrcpyOptionsLatest<true>({
    scid,
    audio: false,
    tunnelForward: true,
    // autosync 开启才有剪贴板 ACK 的序列化器；设备侧剪贴板推送由读侧消费丢弃，不同步宿主
    clipboardAutosync: true,
    // 关键帧间隔钉 1s：后台恢复/重同步的回放链不超过 1s PTS 跨度（缓存预算按此设计）
    videoCodecOptions: new ScrcpyCodecOptions({ iFrameInterval: 1 })
  })
  const socketName = `scrcpy_${(scid.toOptionValue() ?? '').padStart(8, '0')}`

  if (signal.aborted) throw new Error('aborted')
  const serverProc = deps.spawn(
    deps.adbPath,
    [
      '-s',
      serial,
      'shell',
      `CLASSPATH=${DEVICE_SERVER_PATH} app_process / com.genymobile.scrcpy.Server ${SCRCPY_SERVER_VERSION} ${options.serialize().join(' ')}`
    ],
    deps.toolEnv()
  )

  const fwd = await deps.run(
    deps.adbPath,
    ['-s', serial, 'forward', 'tcp:0', `localabstract:${socketName}`],
    FORWARD_TIMEOUT_MS
  )
  if (fwd.code !== 0) throw new Error(`adb forward 失败：${fwd.stderr}`)
  const port = Number(fwd.stdout.trim())

  let videoSocket: Socket | null = null
  let firstChunk: Buffer | null = null
  const deadline = Date.now() + CONNECT_BUDGET_MS
  while (!firstChunk) {
    if (signal.aborted) throw new Error('aborted')
    if (Date.now() > deadline) throw new Error('连接 scrcpy video socket 超时')
    const sock = await deps.connect(port)
    const winner = await Promise.race([
      readFirstChunk(sock, signal),
      new Promise<null>((resolve) => {
        const timer = setTimeout(() => resolve(null), DUMMY_BYTE_TIMEOUT_MS)
        signal.addEventListener(
          'abort',
          () => {
            clearTimeout(timer)
            resolve(null)
          },
          { once: true }
        )
      })
    ])
    if (winner === null) {
      sock.destroy()
      continue
    }
    videoSocket = sock
    firstChunk = winner
  }
  if (!videoSocket || !firstChunk) throw new Error('video socket 未建立')

  if (signal.aborted) throw new Error('aborted')
  const controlSocket = await deps.connect(port)

  const videoParsed = await options.parseVideoStreamMetadata(
    socketToStream(videoSocket, firstChunk.subarray(1)) as unknown as Parameters<
      typeof options.parseVideoStreamMetadata
    >[0]
  )
  // Tango 品牌流与全局 ReadableStream 形改实同，交界处一次 cast
  const mediaStream = videoParsed.stream.pipeThrough(
    options.createMediaStreamTransformer()
  ) as unknown as ReadableStream<ScrcpyMediaStreamPacket>
  const videoSize = {
    width: videoParsed.metadata.width ?? 0,
    height: videoParsed.metadata.height ?? 0
  }

  const teardown = async (): Promise<void> => {
    try {
      controlSocket.destroy()
    } catch {
      // 已断
    }
    try {
      videoSocket?.destroy()
    } catch {
      // 已断
    }
    try {
      if (serverProc.exitCode === null) serverProc.kill('SIGTERM')
    } catch {
      // 已退
    }
    try {
      await deps.run(
        deps.adbPath,
        ['-s', serial, 'forward', '--remove', `tcp:${port}`],
        FORWARD_REMOVE_TIMEOUT_MS
      )
    } catch {
      // adb 不可用时放弃
    }
  }

  return {
    scid: scid.toOptionValue() ?? '',
    serverProc,
    forwardSpec: `tcp:${port}`,
    videoSocket,
    controlSocket,
    mediaStream,
    options,
    videoSize,
    teardown
  }
}
