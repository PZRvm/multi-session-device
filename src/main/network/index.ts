import { ipcMain } from 'electron'
import { runAdb } from '../emulator/adb'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import type { NetworkSetResult, NetworkState, NetworkTarget } from '@shared/types'
import { msg } from '../locale'

/** 轮询间隔：1s（plan 定案——单发实测 20ms，主进程异步、变化才推送，稳态零 IPC） */
export const NETWORK_POLL_INTERVAL_MS = 1_000
export const NETWORK_ADB_TIMEOUT_MS = 10_000

/** 下发命令拼装：airplane 走 cmd connectivity（PRD 口径）；wifi/data 走 svc */
export const buildSetCommand = (target: NetworkTarget, enabled: boolean): string => {
  const suffix = enabled ? 'enable' : 'disable'
  if (target === 'airplane') return `cmd connectivity airplane-mode ${suffix}`
  if (target === 'wifi') return `svc wifi ${suffix}`
  return `svc data ${suffix}`
}

/** 三值合并读回（单次 spawn）：顺序固定 airplane/wifi/data 三行 */
export const READ_ALL_COMMAND =
  'settings get global airplane_mode_on; settings get global wifi_on; settings get global mobile_data'

/**
 * 三行 settings 输出 → NetworkState；行数不足或垃圾值返回 null（本轮放弃）。
 * 键未设时 settings 输出 'null'（如 wifi-only 画像的 mobile_data）——按该键关闭，
 * 不判整体失败（review P3-A：避免单键缺设令三开关永久禁用）。
 * wifi_on 的 '2' 是飞行模式下推 enable 后的「开启中」瞬态（实测），映射为开。
 */
export const parseNetworkState = (stdout: string): NetworkState | null => {
  const lines = stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  if (lines.length < 3) return null
  const toBool = (value: string): boolean | null => {
    if (value === 'null') return false
    if (!/^\d+$/.test(value)) return null
    return value !== '0'
  }
  const airplane = toBool(lines[0])
  const wifi = toBool(lines[1])
  const data = toBool(lines[2])
  if (airplane === null || wifi === null || data === null) return null
  return { airplane, wifi, data }
}

const isNetworkSetPayload = (
  value: unknown
): value is { id: string; target: NetworkTarget; enabled: boolean } =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as { id?: unknown }).id === 'string' &&
  ((value as { target?: unknown }).target === 'airplane' ||
    (value as { target?: unknown }).target === 'wifi' ||
    (value as { target?: unknown }).target === 'data') &&
  typeof (value as { enabled?: unknown }).enabled === 'boolean'

interface NetworkWatch {
  serial: string
  timer: NodeJS.Timeout
  /** 在途守卫：上一拍读未返回时跳过本轮（设备高负载下命令变慢只延后，不堆积） */
  inFlight: boolean
}

export interface NetworkDeps {
  adbPath: () => string
  runningDevice: (id: string) => Promise<{ serial: string; name: string } | null>
  isMainSender: (sender: Electron.WebContents) => boolean
  /** 变化推送目标（主窗 webContents；窗口不在时静默跳过，下轮变化再补） */
  pushTarget: () => Electron.WebContents | null
  run?: typeof runAdb
  pollIntervalMs?: number
}

export interface NetworkWatchHandle {
  /** running 桥挂点：启动即得初值（首拍立即执行，不等第一个间隔） */
  startWatch: (id: string, serial: string) => void
  /** stopped/beforeKill 桥挂点：清 timer 与读回基准 */
  clearWatch: (id: string) => void
}

const sameState = (a: NetworkState, b: NetworkState): boolean =>
  a.airplane === b.airplane && a.wifi === b.wifi && a.data === b.data

export function registerNetworkIpc(deps: NetworkDeps): NetworkWatchHandle {
  const run = deps.run ?? runAdb
  const intervalMs = deps.pollIntervalMs ?? NETWORK_POLL_INTERVAL_MS

  /** 每设备最近一次读回（set 与轮询共用比较基准；设备为唯一事实源） */
  const lastStates = new Map<string, NetworkState>()
  const watches = new Map<string, NetworkWatch>()
  /** set 互斥：同设备同时只允许一次下发（同步占位——检查与 add 之间零 await） */
  const setFlights = new Set<string>()

  /** 值变化才推（稳态零 IPC） */
  const publishIfChanged = (id: string, state: NetworkState): void => {
    const previous = lastStates.get(id)
    if (previous && sameState(previous, state)) return
    lastStates.set(id, state)
    deps.pushTarget()?.send(IPC_CHANNELS.networkChanged, { deviceId: id, state })
  }

  const readAll = async (serial: string): Promise<NetworkState | null> => {
    const result = await run(deps.adbPath(), ['-s', serial, 'shell', READ_ALL_COMMAND], {
      timeoutMs: NETWORK_ADB_TIMEOUT_MS
    })
    if (result.code !== 0) return null
    return parseNetworkState(result.stdout)
  }

  const tick = async (id: string): Promise<void> => {
    const watch = watches.get(id)
    if (!watch || watch.inFlight) return
    watch.inFlight = true
    try {
      const state = await readAll(watch.serial)
      // 读失败（设备重启中/adb 闪断）：本轮放弃，保留旧值不推不告警
      if (state) publishIfChanged(id, state)
    } catch {
      // runAdb 抛出（spawn 失败等）同样本轮放弃
    } finally {
      // 等待期间设备可能已停止并被清理——不得复活条目
      const current = watches.get(id)
      if (current) current.inFlight = false
    }
  }

  ipcMain.handle(
    IPC_CHANNELS.networkSet,
    async (event, raw: unknown): Promise<NetworkSetResult> => {
      if (!deps.isMainSender(event.sender)) {
        throw new Error(`${IPC_CHANNELS.networkSet}${msg('unregisteredWindowSuffix')}`)
      }
      if (!isNetworkSetPayload(raw)) {
        throw new Error(`${IPC_CHANNELS.networkSet}${msg('invalidPayload')}`)
      }
      const id = raw.id
      // 同步占位再 await：检查与 add 之间若有 await，两次快速调用会双双通过检查
      if (setFlights.has(id)) throw new Error(msg('networkBusy'))
      setFlights.add(id)
      try {
        const device = await deps.runningDevice(id)
        if (!device) throw new Error(msg('networkDeviceNotRunning'))
        const result = await run(
          deps.adbPath(),
          ['-s', device.serial, 'shell', buildSetCommand(raw.target, raw.enabled)],
          { timeoutMs: NETWORK_ADB_TIMEOUT_MS }
        )
        if (result.code !== 0) {
          const detail = result.stderr.trim() || `exit ${result.code}`
          throw new Error(msg('networkCommandFailed', { detail }))
        }
        // 命令成功即返回；读回失败不判错误——真实态由轮询 1s 内补推
        const state = await readAll(device.serial)
        if (state) publishIfChanged(id, state)
        return { state }
      } finally {
        setFlights.delete(id)
      }
    }
  )

  ipcMain.handle(IPC_CHANNELS.networkGet, async (event): Promise<Record<string, NetworkState>> => {
    if (!deps.isMainSender(event.sender)) {
      throw new Error(`${IPC_CHANNELS.networkGet}${msg('unregisteredWindowSuffix')}`)
    }
    // 内存快照即可：lastStates 由轮询持续刷新（≤1s 旧），不再触 adb
    return Object.fromEntries(lastStates)
  })

  const startWatch = (id: string, serial: string): void => {
    const existing = watches.get(id)
    // 防御分支：同 id 重启时桥理论上先走 stopped 清理，这里兜底刷新 serial
    if (existing) {
      existing.serial = serial
      return
    }
    watches.set(id, {
      serial,
      inFlight: false,
      timer: setInterval(() => void tick(id), intervalMs)
    })
    void tick(id)
  }

  const clearWatch = (id: string): void => {
    const watch = watches.get(id)
    if (watch) {
      clearInterval(watch.timer)
      watches.delete(id)
    }
    lastStates.delete(id)
  }

  return { startWatch, clearWatch }
}
