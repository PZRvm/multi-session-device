import { ipcMain } from 'electron'
import type { Socket } from 'node:net'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import type { ExternalDevice } from '@shared/types'
import { msg } from '../locale'
import {
  ADB_HOST,
  ADB_SERVER_PORT,
  encodeAdbRequest,
  ensureSharedServer,
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
  /** 变化推送目标（主窗 webContents；窗口不在时静默跳过，下次变化再推） */
  pushTarget: () => Electron.WebContents | null
  isMainSender: (sender: Electron.WebContents) => boolean
  /** 会话桥事件（测试断言 / 装配层消费） */
  onSession?: (event: ExternalSessionEvent) => void
  /** socket 工厂接缝（测试替身；默认 node:net connect） */
  connect?: typeof tcpConnect
  /** server 存续接缝（测试替身；默认 requireAdb + ensureSharedServer） */
  ensureServer?: () => Promise<unknown>
}

// ---- 载荷解析（长/短格式共用）----

/**
 * 行格式 `serial\tstate [key:value ...]`——属性区是 key:value 且 mDNS 同族服务名可能
 * 含空格（flutter#187092），所以只按首个 \t 与首个空格切三次，其余原样留在属性区。
 */
export const parseTrackDevices = (payload: string): TrackDeviceEntry[] => {
  const entries: TrackDeviceEntry[] = []
  for (const line of payload.split('\n')) {
    const tab = line.indexOf('\t')
    if (tab <= 0) continue
    const serial = line.slice(0, tab)
    const rest = line.slice(tab + 1)
    const space = rest.indexOf(' ')
    const state = space === -1 ? rest : rest.slice(0, space)
    if (!/^[a-z]+$/i.test(state)) continue
    const props = space === -1 ? '' : rest.slice(space + 1)
    const model = /(?:^|\s)model:([^\s]*)/.exec(props)?.[1]
    entries.push({ serial, state, model: model && model.length > 0 ? model : null })
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
const HANDSHAKE_DEADLINE_MS = 5_000

let deps: ExternalDeps | null = null
let cache: ExternalDevice[] = []
let socket: Socket | null = null
let reconnectTimer: NodeJS.Timeout | null = null
let handshakeTimer: NodeJS.Timeout | null = null
let backoffStep = 0
let longFormat = true
const epochs = new Map<string, number>()

/** 组合查询消费：外部设备缓存快照（未注册/未首帧时为空表） */
export const externalDevicesNow = (): ExternalDevice[] => cache

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
}

const applyList = (payload: string, reconnected: boolean): void => {
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
  if (sameDevices(next, cache)) return
  cache = next
  deps?.pushTarget()?.send(IPC_CHANNELS.devicesExternalChanged, cache)
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

const ensureServerDefault = async (): Promise<unknown> => ensureSharedServer(await requireAdb())

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
    const parser = createTrackParser({
      onList: (payload) => {
        clearHandshakeTimer()
        backoffStep = 0
        applyList(payload, reconnected)
      },
      onFail: () => {
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
      detach()
      clearHandshakeTimer()
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
  ipcMain.handle(IPC_CHANNELS.devicesExternalList, (event): ExternalDevice[] => {
    if (!input.isMainSender(event.sender)) {
      throw new Error(`${IPC_CHANNELS.devicesExternalList}: ${msg('unregisteredWindowSuffix')}`)
    }
    return cache
  })
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
  if (socket) {
    const stale = socket
    socket = null
    stale.removeAllListeners()
    stale.destroy()
  }
}
