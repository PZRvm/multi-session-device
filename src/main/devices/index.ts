import { BrowserWindow, ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import type { CreateDeviceInput, Device, DeviceMeta } from '@shared/types'
import { isImageVariant, readDeviceMetas, writeDeviceMetas } from '../store'

const MAX_NAME_LENGTH = 50

const normalizeName = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  const name = value.trim()
  if (name.length === 0 || name.length > MAX_NAME_LENGTH) return null
  return name
}

/** renderer payload 不可信，进业务前先过守卫（coding-style IPC 纪律） */
const isCreateDeviceInput = (value: unknown): value is CreateDeviceInput => {
  if (typeof value !== 'object' || value === null) return false
  const input = value as Record<string, unknown>
  return (
    typeof input.profileId === 'string' &&
    input.profileId.length > 0 &&
    typeof input.profileLabel === 'string' &&
    input.profileLabel.length > 0 &&
    typeof input.apiLevel === 'number' &&
    Number.isInteger(input.apiLevel) &&
    input.apiLevel >= 1 &&
    input.apiLevel <= 100 &&
    isImageVariant(input.variant) &&
    normalizeName(input.name) !== null
  )
}

const isRenameInput = (value: unknown): value is { id: string; name: string } => {
  if (typeof value !== 'object' || value === null) return false
  const input = value as Record<string, unknown>
  return typeof input.id === 'string' && input.id.length > 0 && normalizeName(input.name) !== null
}

const isDeviceIdInput = (value: unknown): value is { id: string } => {
  if (typeof value !== 'object' || value === null) return false
  const input = value as Record<string, unknown>
  return typeof input.id === 'string' && input.id.length > 0
}

const isSetRunningInput = (value: unknown): value is { id: string; running: boolean } => {
  if (typeof value !== 'object' || value === null) return false
  const input = value as Record<string, unknown>
  return typeof input.id === 'string' && input.id.length > 0 && typeof input.running === 'boolean'
}

// 主进程是设备列表与运行状态的唯一事实源（architecture 边界不变量）：
// status 只活在这里的内存里，重启一律「停止」，不入盘。
let devices: Device[] = []
let loaded = false

const ensureLoaded = async (): Promise<void> => {
  if (loaded) return
  const metas = await readDeviceMetas()
  devices = metas.map((meta) => ({ ...meta, status: 'stopped' as const }))
  loaded = true
}

const toMeta = (device: Device): DeviceMeta => ({
  id: device.id,
  name: device.name,
  profileId: device.profileId,
  profileLabel: device.profileLabel,
  apiLevel: device.apiLevel,
  variant: device.variant,
  createdAt: device.createdAt
})

const persistMetas = async (): Promise<void> => {
  await writeDeviceMetas(devices.map(toMeta))
}

const broadcastChanged = (): void => {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(IPC_CHANNELS.devicesChanged, devices)
  }
}

const requireDevice = (id: string): Device => {
  const device = devices.find((entry) => entry.id === id)
  if (!device) throw new Error(`设备不存在（${id}）`)
  return device
}

export function registerDevicesIpc(): void {
  ipcMain.handle(IPC_CHANNELS.devicesList, async (): Promise<Device[]> => {
    await ensureLoaded()
    return devices
  })

  ipcMain.handle(IPC_CHANNELS.devicesCreate, async (_event, raw: unknown): Promise<Device[]> => {
    if (!isCreateDeviceInput(raw)) {
      throw new Error(`${IPC_CHANNELS.devicesCreate}: 非法的入参`)
    }
    await ensureLoaded()
    const device: Device = {
      id: randomUUID(),
      name: raw.name.trim(),
      profileId: raw.profileId,
      profileLabel: raw.profileLabel,
      apiLevel: raw.apiLevel,
      variant: raw.variant,
      createdAt: Date.now(),
      status: 'stopped'
    }
    devices = [...devices, device]
    await persistMetas()
    broadcastChanged()
    return devices
  })

  ipcMain.handle(IPC_CHANNELS.devicesRename, async (_event, raw: unknown): Promise<Device[]> => {
    if (!isRenameInput(raw)) {
      throw new Error(`${IPC_CHANNELS.devicesRename}: 非法的入参`)
    }
    const name = normalizeName(raw.name)
    if (!name) throw new Error(`${IPC_CHANNELS.devicesRename}: 非法的名称`)
    await ensureLoaded()
    requireDevice(raw.id).name = name
    await persistMetas()
    broadcastChanged()
    return devices
  })

  ipcMain.handle(IPC_CHANNELS.devicesDelete, async (_event, raw: unknown): Promise<Device[]> => {
    if (!isDeviceIdInput(raw)) {
      throw new Error(`${IPC_CHANNELS.devicesDelete}: 非法的入参`)
    }
    await ensureLoaded()
    requireDevice(raw.id)
    devices = devices.filter((entry) => entry.id !== raw.id)
    await persistMetas()
    broadcastChanged()
    return devices
  })

  ipcMain.handle(
    IPC_CHANNELS.devicesSetRunning,
    async (_event, raw: unknown): Promise<Device[]> => {
      if (!isSetRunningInput(raw)) {
        throw new Error(`${IPC_CHANNELS.devicesSetRunning}: 非法的入参`)
      }
      await ensureLoaded()
      requireDevice(raw.id).status = raw.running ? 'running' : 'stopped'
      // 运行态不入盘：只广播，不落盘
      broadcastChanged()
      return devices
    }
  )
}
