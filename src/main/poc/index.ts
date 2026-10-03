import { BrowserWindow, app, ipcMain } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { connect as tcpConnect, type Socket } from 'node:net'
import { Readable } from 'node:stream'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import type { PoCGpuMode, PoCInjectInput, PoCLogEntry } from '@shared/types'
import { AdbScrcpyOptionsLatest } from '@yume-chan/adb-scrcpy'
import {
  AndroidMotionEventAction,
  ScrcpyControlMessageWriter,
  ScrcpyInstanceId as InstanceId
} from '@yume-chan/scrcpy'
import { Consumable, PushReadableStream, WritableStream } from '@yume-chan/stream-extra'
import { isPoCReport, swipeSteps, toDevicePx, waitForBoot } from './core'

// ---- 固定参数：单 AVD、固定端口、锁定 server 版本（版本对随 PoC 报告记录）----

const POC_AVD_NAME = 'mst_poc'
const POC_SERIAL = 'emulator-5554'
const POC_PORT = 5554
const POC_IMAGE = 'system-images;android-36;google_apis;arm64-v8a'
const POC_TARGET = 'android-36'
const SCRCPY_SERVER_VERSION = '3.3.3'
const SCRCPY_SERVER_URL = `https://github.com/Genymobile/scrcpy/releases/download/v${SCRCPY_SERVER_VERSION}/scrcpy-server-v${SCRCPY_SERVER_VERSION}`
const BOOT_TIMEOUT_MS = 240_000
const BOOT_INTERVAL_MS = 1_500
const INJECT_STEPS = 24

const sdkRoot = (): string =>
  process.env['MSD_POC_SDK_ROOT'] ?? join(homedir(), 'Library', 'Android', 'sdk')
const pocDir = (): string => join(app.getPath('userData'), 'poc')
const avdHome = (): string => join(pocDir(), 'avd-home')
const androidUserHome = (): string => join(pocDir(), 'android-user')

const adbPath = (): string => join(sdkRoot(), 'platform-tools', 'adb')
const emulatorPath = (): string => join(sdkRoot(), 'emulator', 'emulator')

/** 工具子进程统一环境：SDK 与用户目录全部指进应用自有目录（architecture 隔离不变量） */
const toolEnv = (extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  ...process.env,
  ANDROID_HOME: sdkRoot(),
  ANDROID_SDK_ROOT: sdkRoot(),
  ANDROID_AVD_HOME: avdHome(),
  ANDROID_USER_HOME: androidUserHome(),
  ANDROID_EMULATOR_HOME: androidUserHome(),
  ...extra
})

let pocWindow: BrowserWindow | null = null
let emulatorProcess: ChildProcess | null = null
let stopRequested = false
let videoWidth = 0
let videoHeight = 0

const log = (message: string): void => {
  const entry: PoCLogEntry = { ts: Date.now(), message }
  pocWindow?.webContents.send(IPC_CHANNELS.pocLog, entry)
  console.log(`[poc] ${message}`)
}

const stderrTail = (chunks: Buffer[]): string => {
  const text = Buffer.concat(chunks).toString('utf8').trim()
  return text.length > 0 ? text.slice(-800) : '(无 stderr 输出)'
}

interface RunResult {
  code: number
  stdout: string
  stderr: string
}

const run = (
  file: string,
  args: string[],
  options: { env?: NodeJS.ProcessEnv; timeoutMs?: number } = {}
): Promise<RunResult> =>
  new Promise((resolve, reject) => {
    const child = spawn(file, args, { env: options.env ?? process.env })
    const out: Buffer[] = []
    const err: Buffer[] = []
    const timer =
      options.timeoutMs !== undefined
        ? setTimeout(() => child.kill('SIGKILL'), options.timeoutMs)
        : undefined
    child.stdout.on('data', (chunk: Buffer) => out.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => err.push(chunk))
    child.on('error', reject)
    child.on('close', (code) => {
      if (timer) clearTimeout(timer)
      resolve({
        code: code ?? -1,
        stdout: Buffer.concat(out).toString('utf8'),
        stderr: stderrTail(err)
      })
    })
  })

const ensureAdbServer = async (): Promise<void> => {
  const result = await run(adbPath(), ['start-server'], { timeoutMs: 30_000 })
  if (result.code !== 0) throw new Error(`adb start-server 失败：${result.stderr}`)
}

const adbShell = async (command: string): Promise<string> => {
  const result = await run(adbPath(), ['-s', POC_SERIAL, 'shell', command], { timeoutMs: 10_000 })
  if (result.code !== 0) throw new Error(`adb shell ${command} 失败：${result.stderr}`)
  return result.stdout
}

// ---- poc:setup ----

const createPocAvd = async (): Promise<string> => {
  await mkdir(avdHome(), { recursive: true })
  await mkdir(androidUserHome(), { recursive: true })
  const iniPath = join(avdHome(), `${POC_AVD_NAME}.ini`)
  try {
    await readFile(iniPath, 'utf8')
    return `AVD 已存在，跳过创建（${iniPath}）`
  } catch {
    // 首次创建
  }
  // avdmanager 19/20 在本机无法解析 SDK 根（--sdk_root 移除且 env 不生效，报
  // "Valid system image paths are: null"，issue 2026-10-04-avdmanager-sdk-root-null）——
  // 改为按 AVD 目录规范直接写 .ini + config.ini（emulator 只读 config.ini，实测 24s 无头启动）
  log(`创建 PoC AVD：${POC_AVD_NAME}（Pixel 8 画像，镜像 ${POC_IMAGE}，手写 config）`)
  await mkdir(join(avdHome(), `${POC_AVD_NAME}.avd`), { recursive: true })
  await writeFile(iniPath, avdIni(), 'utf8')
  await writeFile(join(avdHome(), `${POC_AVD_NAME}.avd`, 'config.ini'), avdConfig(), 'utf8')
  return `AVD 已创建：${iniPath}`
}

const avdIni = (): string =>
  [
    'avd.ini.encoding=UTF-8',
    `path=${join(avdHome(), `${POC_AVD_NAME}.avd`)}`,
    `target=${POC_TARGET}`
  ].join('\n') + '\n'

const avdConfig = (): string =>
  [
    `AvdId=${POC_AVD_NAME}`,
    'PlayStore.enabled=false',
    'abi.type=arm64-v8a',
    `avd.ini.displayname=${POC_AVD_NAME}`,
    'avd.ini.encoding=UTF-8',
    'disk.dataPartition.size=6G',
    'hw.accelerometer=yes',
    'hw.arc=false',
    'hw.battery=yes',
    'hw.cpu.arch=arm64',
    'hw.cpu.ncore=4',
    'hw.device.manufacturer=Google',
    'hw.device.name=pixel_8',
    'hw.gps=yes',
    'hw.gpu.enabled=yes',
    'hw.gpu.mode=auto',
    'hw.initialOrientation=portrait',
    'hw.keyboard=yes',
    'hw.lcd.density=420',
    'hw.lcd.height=2400',
    'hw.lcd.width=1080',
    'hw.ramSize=2048',
    'hw.sdCard=no',
    `image.sysdir.1=${POC_IMAGE.replaceAll(';', '/')}/`,
    'runtime.network.latency=none',
    'runtime.network.speed=full',
    'showDeviceFrame=no',
    'tag.display=Google APIs',
    'tag.id=google_apis',
    `target=${POC_TARGET}`,
    'vm.heapSize=336'
  ].join('\n') + '\n'

// ---- poc:emulator-start / stop ----

const stopEmulator = async (): Promise<void> => {
  const child = emulatorProcess
  emulatorProcess = null
  if (!child || child.exitCode !== null) return
  // emulator 是启动器，真正占 AVD 锁的 qemu 是同组子进程——按进程组整组终止
  const killGroup = (signal: NodeJS.Signals): void => {
    try {
      if (child.pid) process.kill(-child.pid, signal)
    } catch {
      child.kill(signal)
    }
  }
  await new Promise<void>((resolve) => {
    child.once('close', () => resolve())
    killGroup('SIGTERM')
    setTimeout(() => {
      if (child.exitCode === null) killGroup('SIGKILL')
    }, 3_000).unref()
  })
  log('模拟器已停止')
}

const startEmulator = async (mode: PoCGpuMode): Promise<string> => {
  if (emulatorProcess && emulatorProcess.exitCode === null) {
    throw new Error('模拟器已在运行，先停止再启动')
  }
  await ensureAdbServer()
  // 上一轮残留实例会抢 AVD 锁，新实例静默 exit 1——启动前显式检查同名 serial
  const existing = await run(adbPath(), ['devices'], { timeoutMs: 10_000 })
  if (existing.stdout.includes(POC_SERIAL)) {
    throw new Error(
      `${POC_SERIAL} 已被占用（可能是残留的模拟器进程），先停止它再启动：adb -s ${POC_SERIAL} emu kill`
    )
  }
  const stderrChunks: Buffer[] = []
  const child = spawn(
    emulatorPath(),
    [
      `@${POC_AVD_NAME}`,
      '-no-window',
      '-no-audio',
      '-no-boot-anim',
      // 快照恢复路径在本 AVD 上原生崩溃（crash_report_exception_handler，issue 同记）——
      // PoC 每轮冷启动，快照加速属 v1.1 候选（PRD 5.1）
      '-no-snapshot',
      '-gpu',
      mode,
      '-port',
      String(POC_PORT)
    ],
    { env: toolEnv(), detached: true }
  )
  child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk))
  const exitedEarly = new Promise<never>((_, reject) => {
    child.once('close', (code) => {
      if (emulatorProcess === child) emulatorProcess = null
      reject(new Error(`模拟器提前退出（exit ${code}）：${stderrTail(stderrChunks)}`))
    })
  })
  emulatorProcess = child
  log(`模拟器启动中：@${POC_AVD_NAME} -no-window -gpu ${mode} -port ${POC_PORT}`)

  const poll = async (): Promise<string> => {
    const result = await run(
      adbPath(),
      ['-s', POC_SERIAL, 'shell', 'getprop', 'sys.boot_completed'],
      { timeoutMs: 5_000 }
    )
    return result.stdout
  }
  await Promise.race([
    waitForBoot(poll, { timeoutMs: BOOT_TIMEOUT_MS, intervalMs: BOOT_INTERVAL_MS }),
    exitedEarly
  ])
  child.removeAllListeners('close')
  child.on('close', (code) => {
    if (emulatorProcess === child) emulatorProcess = null
    log(`模拟器进程退出（exit ${code}）：${stderrTail(stderrChunks)}`)
  })

  // 关系统动画（像素首变判延迟不被动画噪声污染）+ 开触摸指示圈（tap 按下即有可视反馈）
  for (const key of [
    'window_animation_scale',
    'transition_animation_scale',
    'animator_duration_scale'
  ]) {
    await adbShell(`settings put global ${key} 0`)
  }
  await adbShell('settings put system show_touches 1')
  log('boot 完成，系统动画已关闭，触摸指示圈已开启')
  return `${POC_SERIAL} boot 完成（gpu=${mode}）`
}

// ---- poc:stream-start / 注入 ----

const DEVICE_SERVER_PATH = '/data/local/tmp/mst_scrcpy_server.jar'

let controlWriter: ScrcpyControlMessageWriter | null = null
let serverProcess: ChildProcess | null = null
let forwardSpec: string | null = null

const ensureServerFile = async (): Promise<string> => {
  const cachePath = join(pocDir(), `scrcpy-server-v${SCRCPY_SERVER_VERSION}`)
  try {
    await readFile(cachePath)
    return cachePath
  } catch {
    // 首次下载
  }
  log(`下载 scrcpy-server v${SCRCPY_SERVER_VERSION} …`)
  const response = await fetch(SCRCPY_SERVER_URL)
  if (!response.ok) throw new Error(`scrcpy-server 下载失败：HTTP ${response.status}`)
  const buffer = Buffer.from(await response.arrayBuffer())
  await mkdir(pocDir(), { recursive: true })
  await writeFile(cachePath, buffer)
  log(
    `scrcpy-server 已缓存（sha256 ${createHash('sha256').update(buffer).digest('hex').slice(0, 16)}…）`
  )
  return cachePath
}

const readChunk = (socket: Socket): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const onError = (error: Error): void => reject(error)
    socket.once('error', onError)
    socket.once('data', (chunk: Buffer) => {
      socket.removeListener('error', onError)
      socket.pause()
      resolve(chunk)
    })
  })

const connectTcp = (port: number): Promise<Socket> =>
  new Promise((resolve, reject) => {
    const socket = tcpConnect({ host: '127.0.0.1', port })
    socket.once('connect', () => resolve(socket))
    socket.once('error', reject)
  })

const startStream = async (sender: Electron.WebContents, maxSize: number): Promise<string> => {
  if (controlWriter) throw new Error('取流已在进行，先停止')
  stopRequested = false
  await ensureAdbServer()

  const cachePath = await ensureServerFile()
  const pushed = await run(adbPath(), ['-s', POC_SERIAL, 'push', cachePath, DEVICE_SERVER_PATH], {
    timeoutMs: 30_000
  })
  if (pushed.code !== 0) throw new Error(`scrcpy-server push 失败：${pushed.stderr}`)

  // options 只承担协议面：参数序列化、流元数据解析、控制消息编码（与官方客户端同构）
  const scid = InstanceId.random()
  const options = new AdbScrcpyOptionsLatest<true>({
    scid,
    audio: false,
    tunnelForward: true,
    clipboardAutosync: false,
    maxSize: maxSize > 0 ? maxSize : undefined
  })
  const socketName = `scrcpy_${(scid.toOptionValue() ?? '').padStart(8, '0')}`

  serverProcess = spawn(
    adbPath(),
    [
      '-s',
      POC_SERIAL,
      'shell',
      `CLASSPATH=${DEVICE_SERVER_PATH} app_process / com.genymobile.scrcpy.Server ${SCRCPY_SERVER_VERSION} ${options.serialize().join(' ')}`
    ],
    { env: toolEnv() }
  )
  const serverTail: Buffer[] = []
  serverProcess.stdout?.on('data', (chunk: Buffer) => {
    for (const line of chunk.toString('utf8').split('\n')) {
      if (line.trim().length > 0) log(`[scrcpy] ${line.trim()}`)
    }
  })
  serverProcess.stderr?.on('data', (chunk: Buffer) => serverTail.push(chunk))
  serverProcess.on('close', (code) => {
    log(
      `scrcpy server 进程退出（exit ${code}）${serverTail.length > 0 ? `：${stderrTail(serverTail)}` : ''}`
    )
    stopRequested = true
    if (controlWriter) {
      controlWriter = null
    }
  })

  // 传输路径与官方客户端同款：adb forward tcp:0（由 adb 分配宿主端口）→ 裸 TCP 双连接。
  // Tango 的 adb server 直连 localabstract 路径在本环境会卡死服务端取帧（issue 同记）。
  const fwd = await run(
    adbPath(),
    ['-s', POC_SERIAL, 'forward', 'tcp:0', `localabstract:${socketName}`],
    { timeoutMs: 10_000 }
  )
  if (fwd.code !== 0) throw new Error(`adb forward 失败：${fwd.stderr}`)
  const port = Number(fwd.stdout.trim())
  forwardSpec = `tcp:${port}`

  // video socket 先连（server 在 forward 隧道第一个字节回执前先发 1 个 dummy byte）。
  // host 侧 forward 连接总是立即成功，设备侧 adbd 若早于 server 监听会静默失败挂死——
  // 必须像官方客户端一样以 dummy byte 到达为准做超时重连
  let videoSock: Socket | null = null
  let firstChunk: Buffer | null = null
  for (let attempt = 0; attempt < 100 && !firstChunk; attempt += 1) {
    const sock = await connectTcp(port)
    const winner = await Promise.race([
      readChunk(sock).then((chunk) => chunk),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 1_000))
    ])
    if (winner === null) {
      sock.destroy()
      continue
    }
    videoSock = sock
    firstChunk = winner
  }
  if (!videoSock || !firstChunk) throw new Error('连接 scrcpy video socket 超时（重试 100 次）')
  const controlSock = await connectTcp(port)

  // video 流：跳过 dummy byte，重组为连续 web 流后交给 options 解析元数据（codec + 分辨率）
  const videoWeb = new PushReadableStream<Uint8Array>(async (controller) => {
    const rest = firstChunk.subarray(1)
    if (rest.length > 0) await controller.enqueue(rest)
    videoSock.resume()
    const reader = (Readable.toWeb(videoSock) as unknown as ReadableStream<Uint8Array>).getReader()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        await controller.enqueue(value)
      }
    } finally {
      reader.releaseLock()
    }
  }) as unknown as ReadableStream<Uint8Array>
  // node web 流与 Tango 品牌流类型形改实同，交界处一次 cast
  const videoParsed = await options.parseVideoStreamMetadata(
    videoWeb as unknown as Parameters<typeof options.parseVideoStreamMetadata>[0]
  )
  videoWidth = videoParsed.metadata.width ?? 0
  videoHeight = videoParsed.metadata.height ?? 0
  log(`视频流已连接：${videoWidth}×${videoHeight} codec=${videoParsed.metadata.codec}`)

  // control 流：裸 socket 写入口包一层 Consumable 解包，再交给协议 writer
  const controlRaw = new WritableStream<Uint8Array>({
    write: (chunk) =>
      new Promise<void>((resolve, reject) => {
        controlSock.write(chunk, (error) => (error ? reject(error) : resolve()))
      }),
    close: () =>
      new Promise<void>((resolve) => {
        controlSock.end(resolve)
      }),
    abort: () => {
      controlSock.destroy()
    }
  })
  controlWriter = new ScrcpyControlMessageWriter(
    new Consumable.WrapWritableStream(controlRaw).getWriter(),
    options
  )

  // 视频包通道：webContents.send（MessagePort 跨 contextBridge 在本环境不投递，issue 同记）
  void (async () => {
    const packets = videoParsed.stream.pipeThrough(options.createMediaStreamTransformer())
    const reader = packets.getReader()
    let count = 0
    try {
      while (!stopRequested) {
        const { done, value } = await reader.read()
        if (done) break
        sender.send(IPC_CHANNELS.pocStreamPort, value)
        count += 1
        if (count === 1 || count % 300 === 0) log(`已转发 ${count} 个视频包`)
      }
    } catch (error) {
      log(`视频流中断：${String(error)}`)
    } finally {
      reader.releaseLock()
    }
  })()
  log('取流已开始')
  return `取流已开始（server v${SCRCPY_SERVER_VERSION}，video ${videoWidth}×${videoHeight}）`
}

const stopStream = async (): Promise<void> => {
  stopRequested = true
  controlWriter = null
  const process = serverProcess
  serverProcess = null
  if (forwardSpec) {
    await run(adbPath(), ['-s', POC_SERIAL, 'forward', '--remove', forwardSpec], {
      timeoutMs: 5_000
    }).catch(() => undefined)
    forwardSpec = null
  }
  if (process && process.exitCode === null) {
    process.kill('SIGTERM')
  }
  log('取流已停止')
}

const inject = async (input: PoCInjectInput): Promise<void> => {
  const controller = controlWriter
  if (!controller) throw new Error('尚未取流，无法注入')
  const width = videoWidth
  const height = videoHeight
  if (!width || !height) throw new Error('画面尺寸未知（还没收到首帧配置）')

  if (input.kind === 'tap') {
    const x = toDevicePx(input.x, width)
    const y = toDevicePx(input.y, height)
    await controller.injectTouch({
      action: AndroidMotionEventAction.Down,
      pointerId: 0n,
      pointerX: x,
      pointerY: y,
      videoWidth: width,
      videoHeight: height,
      pressure: 1,
      actionButton: 0,
      buttons: 0
    })
    await new Promise((resolve) => setTimeout(resolve, 60))
    await controller.injectTouch({
      action: AndroidMotionEventAction.Up,
      pointerId: 0n,
      pointerX: x,
      pointerY: y,
      videoWidth: width,
      videoHeight: height,
      pressure: 0,
      actionButton: 0,
      buttons: 0
    })
    return
  }

  const steps = swipeSteps(input.x1, input.y1, input.x2, input.y2, INJECT_STEPS)
  const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
  const stepDelay = Math.max(1, Math.round(input.durationMs / INJECT_STEPS))
  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i]
    const action =
      i === 0
        ? AndroidMotionEventAction.Down
        : i === steps.length - 1
          ? AndroidMotionEventAction.Up
          : AndroidMotionEventAction.Move
    await controller.injectTouch({
      action,
      pointerId: 0n,
      pointerX: toDevicePx(step.x, width),
      pointerY: toDevicePx(step.y, height),
      videoWidth: width,
      videoHeight: height,
      pressure: action === AndroidMotionEventAction.Up ? 0 : 1,
      actionButton: 0,
      buttons: 0
    })
    if (i < steps.length - 1) await sleep(stepDelay)
  }
}

// ---- poc:report / teardown ----

const saveReport = async (report: unknown): Promise<string> => {
  if (!isPoCReport(report)) throw new Error('报告字段不齐，拒绝落盘')
  await mkdir(pocDir(), { recursive: true })
  const path = join(pocDir(), `report-${report.gpuMode}-${Date.now()}.json`)
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  log(`报告已落盘：${path}`)
  return path
}

const teardown = async (): Promise<string> => {
  await stopStream()
  await stopEmulator()
  await rm(avdHome(), { recursive: true, force: true })
  await rm(androidUserHome(), { recursive: true, force: true })
  log('PoC 环境已清理（模拟器停止 + AVD 目录删除）')
  return '已清理'
}

export function createPocWindow(): void {
  pocWindow = new BrowserWindow({
    width: 1080,
    height: 760,
    show: false,
    autoHideMenuBar: true,
    title: 'PoC · 投屏链路闸门',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true
    }
  })
  pocWindow.once('ready-to-show', () => pocWindow?.show())
  pocWindow.on('closed', () => {
    pocWindow = null
  })
  const url = process.env['ELECTRON_RENDERER_URL']
  if (url) {
    void pocWindow.loadURL(`${url}/poc.html`)
  } else {
    void pocWindow.loadFile(join(__dirname, '../renderer/poc.html'))
  }
}

export function registerPocIpc(): void {
  ipcMain.handle(IPC_CHANNELS.pocSetup, () => createPocAvd())

  ipcMain.handle(IPC_CHANNELS.pocEmulatorStart, (_event, raw: unknown) => {
    if (raw !== 'host' && raw !== 'swiftshader_indirect') {
      throw new Error(`${IPC_CHANNELS.pocEmulatorStart}: 非法的 gpu 模式`)
    }
    return startEmulator(raw)
  })

  ipcMain.handle(IPC_CHANNELS.pocEmulatorStop, () => stopEmulator().then(() => '已停止'))

  ipcMain.handle(IPC_CHANNELS.pocStreamStart, (event, raw: unknown): Promise<string> => {
    const maxSize = typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 ? raw : 0
    return startStream(event.sender, maxSize)
  })

  ipcMain.handle(IPC_CHANNELS.pocStopStream, () => stopStream())

  ipcMain.handle(IPC_CHANNELS.pocInject, (_event, raw: unknown) => {
    if (typeof raw !== 'object' || raw === null) {
      throw new Error(`${IPC_CHANNELS.pocInject}: 非法的入参`)
    }
    const input = raw as PoCInjectInput
    if (input.kind === 'tap') {
      for (const value of [input.x, input.y]) {
        if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('非法坐标')
      }
    } else if (input.kind === 'swipe') {
      for (const value of [input.x1, input.y1, input.x2, input.y2, input.durationMs]) {
        if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('非法坐标')
      }
    } else {
      throw new Error(`${IPC_CHANNELS.pocInject}: 未知注入类型`)
    }
    return inject(input)
  })

  ipcMain.handle(IPC_CHANNELS.pocReport, (_event, raw: unknown) => saveReport(raw))

  ipcMain.handle(IPC_CHANNELS.pocTeardown, () => teardown())
}
