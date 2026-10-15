import { BrowserWindow, ipcMain } from 'electron'
import { networkInterfaces } from 'node:os'
import type { Socket } from 'node:net'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import type {
  DeviceRuntimeView,
  ExternalDevice,
  WirelessCandidate,
  WirelessConnectInput,
  WirelessConnectOutcome,
  WirelessPairInput,
  WirelessPairOutcome,
  WirelessPromoteInput
} from '@shared/types'
import { msg } from '../locale'
import {
  ADB_HOST,
  ADB_SERVER_PORT,
  type AdbRunResult,
  encodeAdbRequest,
  ensureSharedServer,
  runAdb,
  tcpConnect
} from '../emulator/adb'
import { requireAdb } from './environment'

// 真机域（plan 2026-10-13-real-device-usb-and-apk-install；stage06 第一批）：
// host:track-devices-l 长连接跟踪外部物理设备——server 推全量列表（smart-socket 帧：
// 首帧 OKAY + hex4 + 列表，此后每次变化一帧 hex4 + 列表），diff 后更新缓存、推主窗、
// 发会话桥事件（迁入 device 态建投屏会话、消失或迁出销毁）。
// 红线：track 是普通订阅连接，不改变共享 server 生命周期；server 不在时经
// ensureSharedServer 拉起（只 start 不 kill）。纯内存状态，不进 DeviceSnapshot。

/** track 载荷单行解析结果（state 保留原文，映射收口在 toExternalDevices） */
export interface TrackDeviceEntry {
  serial: string
  state: string
  model: string | null
}

/** 会话桥事件（ipc 装配层接 scrcpy ensure/destroy；外部设备没有 runner，第二桥专用） */
export type ExternalSessionEvent =
  { kind: 'connected'; device: ExternalDevice; runId: string } | { kind: 'removed'; id: string }

export interface ExternalDeps {
  /** 变化广播（默认发全部窗口——对齐 devices:changed 语义：独立日志窗的下拉也跟随真机；
   *  测试替身注入断言） */
  broadcast?: (devices: ExternalDevice[]) => void
  isMainSender: (sender: Electron.WebContents) => boolean
  /** 会话桥事件（测试断言 / 装配层消费） */
  onSession?: (event: ExternalSessionEvent) => void
  /** socket 工厂接缝（测试替身；默认 node:net connect） */
  connect?: typeof tcpConnect
  /** server 存续接缝（测试替身；默认 requireAdb + ensureSharedServer） */
  ensureServer?: () => Promise<unknown>
  /** 无线域接缝组（测试替身注入；缺省用本文件 wirelessDefaults） */
  wireless?: Partial<WirelessDeps>
  /** 无线连接窗 sender 判定（五个无线通道同时接受主窗与连接窗——连接窗是原生弹窗
   *  化后的调用方，2026-10-15 用户裁定） */
  isWirelessSender?: (sender: Electron.WebContents) => boolean
}

const broadcastDefault = (devices: ExternalDevice[]): void => {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(IPC_CHANNELS.devicesExternalChanged, devices)
  }
}

// ---- 载荷解析（长/短格式共用）----

/**
 * 行格式 `serial\tstate [key:value ...]`——属性区是 key:value 且 mDNS 同族服务名可能
 * 含空格（flutter#187092），所以只按首个 \t 与首个空格切三次，其余原样留在属性区。
 */
export const parseTrackDevices = (payload: string): TrackDeviceEntry[] => {
  const entries: TrackDeviceEntry[] = []
  for (const line of payload.split('\n')) {
    // 分隔符两种形态：host:devices 短格式 serial\tstate；-l 长格式与 CLI 对齐一致、
    // serial 与 state 之间是空格串（2026-10-13 真机实测 EBG_AN00 载荷）。serial 自身
    // 不含空白，首个空白串后取状态词，其余留给属性区——不按空白切整行（mDNS 同族
    // 服务名含空格的教训不适用于设备行，但仍留单串切法防 serial 含空格的未来形态）
    const match = /^(\S+)[ \t]+([a-z]+)(?:[ \t]+(.*))?$/.exec(line)
    if (!match) continue
    const [, serial, state, props = ''] = match
    // 老 adb 的多词 state（如 "no permissions (…)"）在此被截为首词（'no'）——归入
    // 未知态由 toExternalDevices 映射为 offline 展示，不视为非法行（review P3-7）
    const model = /(?:^|\s)model:([^\s]+)/.exec(props)?.[1]
    entries.push({ serial, state, model: model ?? null })
  }
  return entries
}

/** track 条目 → 外部设备视图：emulator- 归 AVD 列表、adb- 是 mDNS 发现占位，均不入外部区 */
export const toExternalDevices = (entries: TrackDeviceEntry[]): ExternalDevice[] =>
  entries
    .filter((entry) => !entry.serial.startsWith('emulator-') && !entry.serial.startsWith('adb-'))
    .map((entry) => ({
      id: entry.serial,
      serial: entry.serial,
      transport: entry.serial.includes(':') ? 'wireless' : 'usb',
      state:
        entry.state === 'device'
          ? 'device'
          : entry.state === 'unauthorized'
            ? 'unauthorized'
            : 'offline',
      model: entry.model
    }))

// ---- 帧解析状态机（握手 OKAY/FAIL 一次；之后 hex4 + 载荷反复）----

interface TrackParserSink {
  onList: (payload: string) => void
  onFail: (reason: string) => void
}

/** 缓冲式解析：跨 chunk 半包与单 chunk 多帧都收敛在 push 循环里（learn 2026-10-07 教训） */
export const createTrackParser = (sink: TrackParserSink): { push: (chunk: Buffer) => void } => {
  let buffer = Buffer.alloc(0)
  let stage: 'handshake' | 'length' | 'payload' | 'fail-length' | 'fail-payload' = 'handshake'
  let need = 4
  return {
    push(chunk: Buffer): void {
      buffer = Buffer.concat([buffer, chunk])
      for (;;) {
        if (buffer.length < need) return
        if (stage === 'handshake') {
          const head = buffer.subarray(0, 4).toString('utf8')
          buffer = buffer.subarray(4)
          if (head === 'OKAY') stage = 'length'
          else if (head === 'FAIL') stage = 'fail-length'
          else {
            sink.onFail(`unexpected handshake: ${JSON.stringify(head)}`)
            return
          }
        } else if (stage === 'length' || stage === 'fail-length') {
          const text = buffer.subarray(0, 4).toString('utf8')
          buffer = buffer.subarray(4)
          if (!/^[\da-f]{4}$/i.test(text)) {
            sink.onFail(`bad frame length: ${JSON.stringify(text)}`)
            return
          }
          need = Number.parseInt(text, 16)
          stage = stage === 'length' ? 'payload' : 'fail-payload'
        } else if (stage === 'payload') {
          const payload = buffer.subarray(0, need).toString('utf8')
          buffer = buffer.subarray(need)
          need = 4
          stage = 'length'
          sink.onList(payload)
        } else {
          sink.onFail(buffer.subarray(0, need).toString('utf8'))
          return
        }
      }
    }
  }
}

// ---- 运行时（registerExternalIpc 幂等；可变状态单写方在本文件）----

const START_BACKOFF_MS = 1_000
const MAX_BACKOFF_MS = 30_000
/** 连接代次表上限（review P3-6）：超出才清理已离场 serial */
const EPOCHS_CAP = 64
const HANDSHAKE_DEADLINE_MS = 5_000
/** 空首帧 nudge 延迟（review 二轮 P3-C）：server 侧 USB 枚举可能晚于 track 首帧 */
const EMPTY_FRAME_NUDGE_MS = 1_500

let deps: ExternalDeps | null = null
let cache: ExternalDevice[] = []
let socket: Socket | null = null
let reconnectTimer: NodeJS.Timeout | null = null
let handshakeTimer: NodeJS.Timeout | null = null
let nudgeTimer: NodeJS.Timeout | null = null
/** nudge 一次性闩：空 streak 里最多重开一次，见到设备才复位（防循环） */
let emptyNudgeLatched = false
let backoffStep = 0
let longFormat = true
const epochs = new Map<string, number>()

const clearNudgeTimer = (): void => {
  if (nudgeTimer) {
    clearTimeout(nudgeTimer)
    nudgeTimer = null
  }
}

/** 首帧为空且缓存也为空：延迟一拍重开 track 连接取全新全量列表（server 枚举竞态
 *  的兜底；有界——闩住直到见到设备） */
const armEmptyNudge = (): void => {
  emptyNudgeLatched = true
  nudgeTimer = setTimeout(() => {
    nudgeTimer = null
    if (cache.length > 0 || !deps) return
    console.log('[external] empty first frame persisted — reopening track connection')
    if (socket) {
      const stale = socket
      socket = null
      stale.removeAllListeners()
      stale.destroy()
    }
    void openSocket()
  }, EMPTY_FRAME_NUDGE_MS)
}

/** 组合查询消费：外部设备缓存快照（未注册/未首帧时为空表） */
export const externalDevicesNow = (): ExternalDevice[] => cache

/** 日志域合并视图消费（plan 2026-10-13-real-device-toolbar-parity）：device 态真机映射为
 *  运行视图——status 'running' 是「已连接 ≡ 可订阅」的适配（DeviceRuntimeView 的 status
 *  联合只有 AVD 生命周期态）；runId 省略，订阅侧可惰性建会话 */
export const externalRuntimeViews = (): DeviceRuntimeView[] =>
  cache
    .filter((device) => device.state === 'device')
    .map((device) => ({
      id: device.id,
      name: device.model ?? device.serial,
      status: 'running',
      serial: device.serial,
      origin: 'external' as const
    }))

/** 组合查询（queries.ts）的测试接缝：直写缓存快照（生产代码不得调用） */
export const setExternalDevicesForTests = (devices: ExternalDevice[]): void => {
  cache = devices
}

const sameDevices = (a: ExternalDevice[], b: ExternalDevice[]): boolean =>
  a.length === b.length &&
  a.every((device, i) => {
    const other = b[i]
    return device.id === other.id && device.state === other.state && device.model === other.model
  })

const emitConnected = (device: ExternalDevice): void => {
  const epoch = (epochs.get(device.serial) ?? 0) + 1
  epochs.set(device.serial, epoch)
  deps?.onSession?.({ kind: 'connected', device, runId: `ext:${device.serial}:${epoch}` })
  // review P3-6：代次只增保证重连强制重建；removed 时保留是为了「拔插后 runId 不回退」。
  // 长会话下防无界：超上限才清掉已不在场的 serial（清后重插从 1 起——destroySession
  // 已清会话表，同 runId 复用无害；仅与在途 destroy 有极窄竞窗，下一次 track 帧即恢复）
  if (epochs.size > EPOCHS_CAP) {
    const alive = new Set(cache.map((entry) => entry.serial))
    for (const serial of epochs.keys()) {
      if (!alive.has(serial)) epochs.delete(serial)
    }
  }
}

const applyList = (payload: string, reconnected: boolean): number => {
  const next = toExternalDevices(parseTrackDevices(payload))
  // 消失或迁出 device 态 → 销毁会话（重连首帧同样结算断线期间的消失，漏帧不泄漏）
  for (const before of cache) {
    if (before.state !== 'device') continue
    const after = next.find((device) => device.id === before.id)
    if (!after || after.state !== 'device') deps?.onSession?.({ kind: 'removed', id: before.id })
  }
  for (const device of next) {
    if (device.state !== 'device') continue
    const before = cache.find((entry) => entry.id === device.id)
    // 健在会话不动（ensureSession 同 runId 幂等）；重连首帧全部重建——断线期间
    // 会话可能已死而同 runId 无法复活，代次自增强制销毁重建，代价一帧画面重连
    if (before?.state === 'device' && !reconnected) continue
    emitConnected(device)
  }
  if (!sameDevices(next, cache)) {
    cache = next
    console.log(
      '[external] devices changed:',
      next.map((device) => `${device.serial}(${device.state})`).join(', ') || '(none)'
    )
    ;(deps?.broadcast ?? broadcastDefault)(cache)
  }
  return next.length
}
const clearHandshakeTimer = (): void => {
  if (handshakeTimer) {
    clearTimeout(handshakeTimer)
    handshakeTimer = null
  }
}

const scheduleReconnect = (): void => {
  clearHandshakeTimer()
  if (socket) {
    const stale = socket
    socket = null
    stale.removeAllListeners()
    stale.destroy()
  }
  if (!deps) return
  const delay = Math.min(START_BACKOFF_MS * 2 ** backoffStep, MAX_BACKOFF_MS)
  backoffStep += 1
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    void openSocket()
  }, delay)
}

const ensureServerDefault = async (): Promise<unknown> => {
  const exec = await requireAdb()
  try {
    const descriptor = await ensureSharedServer(exec)
    if (!descriptor.reused) {
      // 全新 server 的 USB 枚举是异步的：track 立即连可能拿到空首帧且等不到推送
      // （「手机先插、应用后起」读不到的一类根因）。主动跑一次 devices 逼扫描落地，
      // 失败不阻断——track 与热插拔推送仍是兜底
      await runAdb(exec.path, ['devices'], { timeoutMs: 10_000 }).catch(() => undefined)
    }
    return descriptor
  } catch (error) {
    // 后台客户端的静默失败就是「列表凭空消失」——失败必须进日志（learn：观测缺口）
    console.warn('[external] ensureSharedServer failed:', String(error))
    throw error
  }
}

const openSocket = async (): Promise<void> => {
  const current = deps
  if (!current || socket || reconnectTimer) return
  try {
    await (current.ensureServer ?? ensureServerDefault)()
  } catch {
    scheduleReconnect()
    return
  }
  if (!current || socket || reconnectTimer) return
  const reconnected = backoffStep > 0
  await new Promise<void>((resolve) => {
    let sock: Socket
    try {
      sock = (current.connect ?? tcpConnect)({ host: ADB_HOST, port: ADB_SERVER_PORT })
    } catch {
      resolve()
      scheduleReconnect()
      return
    }
    socket = sock
    let firstFrame = true
    const parser = createTrackParser({
      onList: (payload) => {
        clearHandshakeTimer()
        backoffStep = 0
        const count = applyList(payload, reconnected)
        if (count > 0) {
          clearNudgeTimer()
          emptyNudgeLatched = false
        } else if (firstFrame && !emptyNudgeLatched) {
          armEmptyNudge()
        }
        firstFrame = false
      },
      onFail: (reason) => {
        console.warn('[external] track handshake FAIL:', reason)
        // 极老 server 不认 -l：FAIL 退短格式立即重试一次；短格式也败进退避
        const wasLong = longFormat
        if (wasLong) longFormat = false
        detach()
        clearHandshakeTimer()
        if (socket === sock) socket = null
        sock.destroy()
        resolve()
        if (wasLong) void openSocket()
        else scheduleReconnect()
      }
    })
    const onConnect = (): void => {
      console.log('[external] track socket connected, requesting', longFormat ? 'long' : 'short')
      try {
        sock.write(encodeAdbRequest(longFormat ? 'host:track-devices-l' : 'host:track-devices'))
      } catch {
        detach()
        resolve()
        scheduleReconnect()
        return
      }
      // 握手期无首帧（半死 server）：按断线退避，不留悬空等待
      handshakeTimer = setTimeout(() => {
        detach()
        if (socket === sock) socket = null
        sock.destroy()
        resolve()
        scheduleReconnect()
      }, HANDSHAKE_DEADLINE_MS)
    }
    const onData = (chunk: Buffer): void => parser.push(chunk)
    const onClose = (): void => {
      console.log('[external] track socket closed')
      detach()
      clearHandshakeTimer()
      clearNudgeTimer()
      if (socket === sock) socket = null
      scheduleReconnect()
      resolve()
    }
    const onError = (): void => {
      // error 后 close 必到，统一在 close 收口；此处仅防 unhandled error 事件
    }
    function detach(): void {
      sock.off('connect', onConnect)
      sock.off('data', onData)
      sock.off('close', onClose)
      sock.off('error', onError)
    }
    sock.on('connect', onConnect)
    sock.on('data', onData)
    sock.on('close', onClose)
    sock.on('error', onError)
  })
}

export function registerExternalIpc(input: ExternalDeps): void {
  if (deps) return
  deps = input
  const requireMain = (channel: string, sender: Electron.WebContents): void => {
    if (!input.isMainSender(sender)) {
      throw new Error(`${channel}: ${msg('unregisteredWindowSuffix')}`)
    }
  }
  // 无线五通道的守卫放行主窗与无线连接窗（后者是原生弹窗化后的发起方）
  const requireWirelessCaller = (channel: string, sender: Electron.WebContents): void => {
    if (!input.isMainSender(sender) && !(input.isWirelessSender?.(sender) ?? false)) {
      throw new Error(`${channel}: ${msg('unregisteredWindowSuffix')}`)
    }
  }
  ipcMain.handle(IPC_CHANNELS.devicesExternalList, (event): ExternalDevice[] => {
    requireMain(IPC_CHANNELS.devicesExternalList, event.sender)
    return cache
  })
  // ---- 无线域通道（plan 2026-10-15-real-device-wireless）：失败是结果不是错误，
  // outcome 判别联合直达 renderer；载荷非法才 throw（对齐其余通道惯例）----
  ipcMain.handle(IPC_CHANNELS.devicesExternalScan, (event): Promise<WirelessCandidate[]> => {
    requireWirelessCaller(IPC_CHANNELS.devicesExternalScan, event.sender)
    return scanWireless(input.wireless)
  })
  ipcMain.handle(
    IPC_CHANNELS.devicesExternalPair,
    (event, raw: unknown): Promise<WirelessPairOutcome> => {
      requireWirelessCaller(IPC_CHANNELS.devicesExternalPair, event.sender)
      if (!isWirelessPairInput(raw)) {
        throw new Error(`${IPC_CHANNELS.devicesExternalPair}${msg('invalidPayload')}`)
      }
      return pairWirelessDevice(raw, input.wireless)
    }
  )
  ipcMain.handle(
    IPC_CHANNELS.devicesExternalConnect,
    (event, raw: unknown): Promise<WirelessConnectOutcome> => {
      requireWirelessCaller(IPC_CHANNELS.devicesExternalConnect, event.sender)
      if (!isWirelessConnectInput(raw)) {
        throw new Error(`${IPC_CHANNELS.devicesExternalConnect}${msg('invalidPayload')}`)
      }
      return connectWirelessDevice(raw, input.wireless)
    }
  )
  ipcMain.handle(
    IPC_CHANNELS.devicesExternalPromote,
    (event, raw: unknown): Promise<WirelessConnectOutcome> => {
      requireWirelessCaller(IPC_CHANNELS.devicesExternalPromote, event.sender)
      if (
        typeof raw !== 'object' ||
        raw === null ||
        typeof (raw as WirelessPromoteInput).serial !== 'string'
      ) {
        throw new Error(`${IPC_CHANNELS.devicesExternalPromote}${msg('invalidPayload')}`)
      }
      return promoteToWireless(raw as WirelessPromoteInput, input.wireless)
    }
  )
  ipcMain.handle(
    IPC_CHANNELS.devicesExternalDisconnect,
    async (event, raw: unknown): Promise<void> => {
      requireWirelessCaller(IPC_CHANNELS.devicesExternalDisconnect, event.sender)
      if (
        typeof raw !== 'object' ||
        raw === null ||
        typeof (raw as { serial?: unknown }).serial !== 'string'
      ) {
        throw new Error(`${IPC_CHANNELS.devicesExternalDisconnect}${msg('invalidPayload')}`)
      }
      await disconnectWirelessDevice((raw as { serial: string }).serial, input.wireless)
    }
  )
  void openSocket()
}

/** before-quit 收口：断 socket、清定时器；removeAllListeners 保证 close 不再触发重连 */
export function stopExternalTracking(): void {
  deps = null
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  clearHandshakeTimer()
  clearNudgeTimer()
  if (socket) {
    const stale = socket
    socket = null
    stale.removeAllListeners()
    stale.destroy()
  }
}

/**
 * 取消退出（用户选择留下）后恢复外部会话（review P2-1）：shutdownStreams 的
 * destroyAll 连带销毁了真机的投屏/日志会话与网络轮询，而 track 连接未断、也不会有
 * 新帧（设备集没变）——对全部 device 态条目重发 connected（代次自增强制重建）。
 */
export function resumeExternalSessions(): void {
  if (!deps) return
  for (const device of cache) {
    if (device.state === 'device') emitConnected(device)
  }
}

// ---- 无线域（plan 2026-10-15-real-device-wireless；无状态裁定：不存任何设备记录，
// 断线即失、不做找回）。荣耀/华为系没有官方「无线调试」开关，tcpip 直连是唯一路径
// （转无线按钮承载）；mDNS/配对码留给有官方开关的机型（小米等），网段探活补漏 ----

/** 无线域接缝组（测试替身注入；缺省走本文件 defaults） */
export interface WirelessDeps {
  /** adb 命令接缝（默认 requireAdb + runAdb） */
  runCmd: (args: string[], timeoutMs?: number) => Promise<AdbRunResult>
  /** ADB 握手探活接缝（默认 node:net 发 CNXN 收应答；网段扫描用——只认 adbd，顺带
   *  取 model，非安卓服务一律 false，用户 2026-10-15 需求「检测 IP 是不是手机」） */
  probeAdb: (host: string, port: number, timeoutMs: number) => Promise<AdbProbeResult>
  /** 延时接缝（默认 setTimeout；连接重试退避用） */
  delay: (ms: number) => Promise<void>
  /** 本机 IPv4 网段前缀接缝（默认 networkInterfaces 过滤内网；如 '192.168.31.'） */
  localSubnets: () => string[]
}

/** 网段探活结果：ok = 对端以 ADB CNXN 应答（是 adbd）；model 取自身份串 */
export interface AdbProbeResult {
  ok: boolean
  model: string | null
}

/** 端口钉死 5555（用户裁定 2026-10-15）：adbd 每机各听各的，IP 已区分，配置零收益 */
const WIRELESS_PORT = 5555
/** adbd 重启竞态退避（plan 风险表）：`tcpip` 下发后 adbd 重启数秒不应答，重试吸收 */
const CONNECT_RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 16_000]
/** TCP 层失败的快速退避（P2-1）：重启窗口内监听短暂消失，前 3 拍先别下结论 */
const TCP_RETRY_DELAYS_MS = [500, 1_000, 2_000]
/** 点分 IPv4：形态 + 每段 0–255（P3-5——999.1.1.1 曾通过并误报 cross-subnet） */
const HOST_PATTERN =
  /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/

const runCmdDefault = async (args: string[], timeoutMs = 15_000): Promise<AdbRunResult> => {
  const exec = await requireAdb()
  return runAdb(exec.path, args, { timeoutMs })
}

// ---- ADB CNXN 握手（amessage：command[4] arg1 arg2 data_length data_check magic，
// 小端；magic = command ^ 0xffffffff。无载荷请求 24 字节）----

export const buildCnxnRequest = (): Buffer => {
  const buf = Buffer.alloc(24)
  buf.write('CNXN', 0, 'utf8')
  buf.writeUInt32LE(0x01000000, 4) // A_VERSION
  buf.writeUInt32LE(4_096, 8) // MAX_PAYLOAD
  buf.writeUInt32LE(0, 12)
  buf.writeUInt32LE(0, 16)
  buf.writeUInt32LE((buf.readUInt32LE(0) ^ 0xffff_ffff) >>> 0, 20)
  return buf
}

/** 设备身份串（`device::ro.product.model=X;ro.serialno=Y;…`）→ model；非 device 串为 null */
export const parseCnxnIdentity = (payload: string): string | null =>
  /^device::/i.test(payload) ? (/ro\.product\.model=([^\s;]+)/.exec(payload)?.[1] ?? null) : null

const probeAdbDefault = (host: string, port: number, timeoutMs: number): Promise<AdbProbeResult> =>
  new Promise((resolve) => {
    let sock: Socket
    try {
      sock = tcpConnect({ host, port })
    } catch {
      resolve({ ok: false, model: null })
      return
    }
    let settled = false
    let buffer = Buffer.alloc(0)
    const finish = (result: AdbProbeResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      sock.destroy()
      resolve(result)
    }
    const timer = setTimeout(() => finish({ ok: false, model: null }), timeoutMs)
    const onData = (chunk: Buffer): void => {
      buffer = Buffer.concat([buffer, chunk])
      if (buffer.length < 24) return
      const command = buffer.subarray(0, 4).toString('utf8')
      if (command !== 'CNXN') {
        finish({ ok: false, model: null })
        return
      }
      const payloadLength = buffer.readUInt32LE(12)
      if (buffer.length < 24 + payloadLength) return
      const payload = buffer.subarray(24, 24 + payloadLength).toString('utf8')
      finish({ ok: true, model: parseCnxnIdentity(payload) })
    }
    sock.once('connect', () => {
      try {
        sock.write(buildCnxnRequest())
      } catch {
        finish({ ok: false, model: null })
      }
    })
    sock.once('error', () => finish({ ok: false, model: null }))
    sock.on('data', onData)
  })

const delayDefault = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

/** 虚拟/隧道接口名族（2026-10-15 实测教训：utun 的 198.18.x 网段被扫描后，代理对
 *  探活假应答，列表出现幽灵候选——TUN 网段只扫得出鬼，必须整族排除） */
const VIRTUAL_INTERFACE_RE =
  /^(utun|tun|tap|awdl|llw|bridge|veth|vmnet|docker|gif|stf|ppp|ipsec|anpi|wg)/i

/** LAN 接口判定（导出供测试）：物理网卡上的 IPv4、非内部、非虚拟接口族 */
export const isLanInterface = (
  name: string,
  info: { family: string; internal: boolean }
): boolean => info.family === 'IPv4' && !info.internal && !VIRTUAL_INTERFACE_RE.test(name)

/** /24 前提的粗粒度网段采集：cross-subnet 提示是 best-effort，不做精确掩码运算 */
const localSubnetsDefault = (): string[] => {
  const prefixes = new Set<string>()
  for (const [name, infos] of Object.entries(networkInterfaces())) {
    for (const info of infos ?? []) {
      if (!isLanInterface(name, info)) continue
      prefixes.add(`${info.address.replace(/\.\d+$/, '')}.`)
    }
  }
  return [...prefixes]
}

const wirelessDefaults: WirelessDeps = {
  runCmd: runCmdDefault,
  probeAdb: probeAdbDefault,
  delay: delayDefault,
  localSubnets: localSubnetsDefault
}

const resolveWirelessDeps = (overrides?: Partial<WirelessDeps>): WirelessDeps => ({
  ...wirelessDefaults,
  ...overrides
})

/**
 * `adb mdns services` 输出解析：按服务类型子串匹配行（实例名可含空格——同族教训，
 * 绝不按空白切整行），行尾 ip:port 用正则提取；无地址的行（老版本只打端口）丢弃。
 */
export const parseMdnsServices = (output: string): WirelessCandidate[] => {
  const found: WirelessCandidate[] = []
  for (const raw of output.split('\n')) {
    const line = raw.trim()
    if (!line.includes('_adb-tls-connect._tcp') && !line.includes('_adb-tls-pairing._tcp')) continue
    const source = line.includes('_adb-tls-pairing._tcp') ? 'mdns-pairing' : 'mdns-connect'
    const addr = /(\d{1,3}(?:\.\d{1,3}){3}):(\d+)\s*$/.exec(line)
    if (!addr) continue
    const name = line.slice(0, line.indexOf('_adb-tls-')).trim().replace(/\.$/, '')
    found.push({ source, name: name || null, host: addr[1], port: Number(addr[2]) })
  }
  return found
}

/** `adb devices` CLI 输出 → 指定 serial 的 transport 态（表头行剥掉后复用 track 解析） */
const transportStateOf = async (
  runCmd: WirelessDeps['runCmd'],
  serial: string
): Promise<string | null> => {
  const result = await runCmd(['devices'], 5_000)
  const body = result.stdout.replace(/^List of devices attached\s*\n/, '')
  return parseTrackDevices(body).find((entry) => entry.serial === serial)?.state ?? null
}

export const connectWirelessDevice = async (
  input: WirelessConnectInput,
  overrides?: Partial<WirelessDeps>
): Promise<WirelessConnectOutcome> => {
  const { runCmd, delay, localSubnets } = resolveWirelessDeps(overrides)
  const host = input.host.trim()
  const port = input.port ?? WIRELESS_PORT
  const serial = `${host}:${port}`
  for (let attempt = 0; ; attempt++) {
    const result = await runCmd(['connect', serial], 10_000)
    if (/(?:^|\n)(?:connected|already connected) to /.test(result.stdout)) {
      const state = await transportStateOf(runCmd, serial)
      if (state === 'device') return { ok: true, serial }
      if (state === 'unauthorized') return { ok: false, reason: 'unauthorized', host }
      // offline / 未列出 → adbd 重启竞态窗口，退避后重连
    } else {
      // TCP 层失败（failed/cannot connect）：前几拍可能是 adbd 重启窗口（监听短暂
      // 消失，2026-10-15 实测连续两次 refused 才通）——快速退避重试，耗尽再按同网段
      // 与否给终态提示
      if (attempt < TCP_RETRY_DELAYS_MS.length) {
        await delay(TCP_RETRY_DELAYS_MS[attempt])
        continue
      }
      const same = localSubnets().some((prefix) => host.startsWith(prefix))
      return { ok: false, reason: same ? 'unreachable' : 'cross-subnet', host }
    }
    if (attempt >= CONNECT_RETRY_DELAYS_MS.length)
      return { ok: false, reason: 'offline-race', host }
    await delay(CONNECT_RETRY_DELAYS_MS[attempt])
  }
}

export const promoteToWireless = async (
  input: WirelessPromoteInput,
  overrides?: Partial<WirelessDeps>
): Promise<WirelessConnectOutcome> => {
  const { runCmd } = resolveWirelessDeps(overrides)
  // 在线校验走 track 缓存（真值）：非 device 态转无线只会得到竞态噪音
  const present = cache.find((device) => device.serial === input.serial)
  if (!present || present.state !== 'device') {
    return { ok: false, reason: 'not-found', host: input.serial }
  }
  // 先读 IP 再 tcpip——adbd 重启窗口可能干扰 shell，顺序反了会白等一轮重试
  const route = await runCmd(['-s', input.serial, 'shell', 'ip', 'route'], 10_000)
  const host = /wlan0[^\n]*\bsrc (\d{1,3}(?:\.\d{1,3}){3})/.exec(route.stdout)?.[1]
  if (!host) return { ok: false, reason: 'no-wifi', host: input.serial }
  await runCmd(['-s', input.serial, 'tcpip', String(WIRELESS_PORT)], 10_000)
  return connectWirelessDevice({ host, port: WIRELESS_PORT }, overrides)
}

export const scanWireless = async (
  overrides?: Partial<WirelessDeps>
): Promise<WirelessCandidate[]> => {
  const { runCmd, probeAdb, localSubnets } = resolveWirelessDeps(overrides)
  // mdns daemon 不在/不可用 → 该源静默空（手动输入是一等入口，不是降级）
  const mdns = await runCmd(['mdns', 'services'], 8_000)
    .then((result) => parseMdnsServices(result.stdout))
    .catch(() => [])
  // 网段探活走 CNXN 握手（用户 2026-10-15 需求）：只认以 ADB 协议应答的对端——
  // 5555 端口开着的不一定是安卓机；身份串顺带带回 model 作候选名。
  // 并发帽 256（P3-6）：多网卡主机瞬时 sockets 有界；同一网段内的次序无关紧要
  const hosts: string[] = []
  for (const prefix of localSubnets()) {
    for (let i = 1; i <= 254; i++) hosts.push(`${prefix}${i}`)
  }
  const SCAN_CONCURRENCY = 256
  const cursor = { index: 0 }
  const workers: Array<Promise<WirelessCandidate | null>> = Array.from(
    { length: Math.min(SCAN_CONCURRENCY, hosts.length) },
    () =>
      (async (): Promise<WirelessCandidate | null> => {
        for (;;) {
          const index = cursor.index++
          if (index >= hosts.length) return null
          const host = hosts[index]
          const probe = await probeAdb(host, WIRELESS_PORT, 1_500)
          if (probe.ok)
            return { source: 'subnet-scan', name: probe.model, host, port: WIRELESS_PORT }
        }
      })()
  )
  const subnetHits = (await Promise.all(workers)).filter(
    (candidate): candidate is WirelessCandidate => candidate !== null
  )
  // mDNS 命中优先（有实例名）；网段扫描只补 mDNS 看不见的 tcpip 设备（荣耀系）
  const seen = new Set(mdns.map((candidate) => `${candidate.host}:${candidate.port}`))
  return [...mdns, ...subnetHits.filter((c) => !seen.has(`${c.host}:${c.port}`))]
}

export const pairWirelessDevice = async (
  input: WirelessPairInput,
  overrides?: Partial<WirelessDeps>
): Promise<WirelessPairOutcome> => {
  const { runCmd } = resolveWirelessDeps(overrides)
  const result = await runCmd(
    ['pair', `${input.host.trim()}:${input.port}`, input.code.trim()],
    15_000
  )
  if (/Successfully paired to/.test(`${result.stdout}\n${result.stderr}`)) return { ok: true }
  const message =
    [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join('\n') || `exit ${result.code}`
  return { ok: false, message }
}

/** adb disconnect 对未知 serial 也无害；track 下一帧自然推消失、会话桥销毁 */
export const disconnectWirelessDevice = async (
  serial: string,
  overrides?: Partial<WirelessDeps>
): Promise<void> => {
  const { runCmd } = resolveWirelessDeps(overrides)
  await runCmd(['disconnect', serial], 5_000)
}

// ---- 通道载荷校验（host 限点分 IPv4；端口 1–65535 整数；配对码短非空串）----

export const isWirelessConnectInput = (raw: unknown): raw is WirelessConnectInput => {
  if (typeof raw !== 'object' || raw === null) return false
  const input = raw as WirelessConnectInput
  if (typeof input.host !== 'string' || !HOST_PATTERN.test(input.host.trim())) return false
  if (input.port === undefined) return true
  return Number.isInteger(input.port) && input.port >= 1 && input.port <= 65_535
}

export const isWirelessPairInput = (raw: unknown): raw is WirelessPairInput => {
  if (typeof raw !== 'object' || raw === null) return false
  const input = raw as WirelessPairInput
  return (
    typeof input.host === 'string' &&
    HOST_PATTERN.test(input.host.trim()) &&
    Number.isInteger(input.port) &&
    input.port >= 1 &&
    input.port <= 65_535 &&
    typeof input.code === 'string' &&
    input.code.trim().length > 0 &&
    input.code.trim().length <= 16
  )
}
