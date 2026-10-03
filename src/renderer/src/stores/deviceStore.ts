import { create } from 'zustand'
import type { CreateDeviceInput, Device } from '@shared/types'
import { toApiResult, type ApiResult } from '../api'

/** 选中态维护：选中设备消失（删除/推送覆盖）时回落到首台，列表空则清空 */
const normalizeSelection = (devices: Device[], selectedId: string | null): string | null => {
  if (selectedId !== null && devices.some((device) => device.id === selectedId)) return selectedId
  return devices[0]?.id ?? null
}

interface DeviceState {
  devices: Device[]
  selectedId: string | null
  /** 首次 list 拉取是否已落定（成败都算落定，避免空库时永远 loading） */
  loaded: boolean
  load: () => Promise<void>
  create: (input: CreateDeviceInput) => Promise<ApiResult<Device[]>>
  rename: (id: string, name: string) => Promise<ApiResult<Device[]>>
  remove: (id: string) => Promise<ApiResult<Device[]>>
  setRunning: (id: string, running: boolean) => Promise<ApiResult<Device[]>>
  setSelected: (id: string) => void
  /** 主进程 changed 推送的入口 */
  applyDevices: (devices: Device[]) => void
}

/**
 * 设备镜像 store——renderer 只持镜像发命令，事实源在主进程
 * （architecture 边界不变量）。命令成功后以 handler 返回的新列表为准；
 * changed 推送幂等覆盖（多窗口场景由推送兜底）。
 */
export const useDeviceStore = create<DeviceState>()((set) => ({
  devices: [],
  selectedId: null,
  loaded: false,
  load: async () => {
    const result = await toApiResult(window.api.devices.list())
    if (result.ok) {
      set((state) => ({
        devices: result.data,
        selectedId: normalizeSelection(result.data, state.selectedId),
        loaded: true
      }))
    } else {
      set({ loaded: true })
    }
  },
  create: async (input) => {
    const result = await toApiResult(window.api.devices.create(input))
    if (result.ok) {
      // 主进程把新设备追加在尾部，取尾即新设备
      const created = result.data[result.data.length - 1]
      set((state) => ({
        devices: result.data,
        selectedId: created ? created.id : normalizeSelection(result.data, state.selectedId)
      }))
    }
    return result
  },
  rename: async (id, name) => {
    const result = await toApiResult(window.api.devices.rename(id, name))
    if (result.ok) set({ devices: result.data })
    return result
  },
  remove: async (id) => {
    const result = await toApiResult(window.api.devices.remove(id))
    if (result.ok) {
      set((state) => ({
        devices: result.data,
        selectedId: normalizeSelection(result.data, state.selectedId)
      }))
    }
    return result
  },
  setRunning: async (id, running) => {
    const result = await toApiResult(window.api.devices.setRunning(id, running))
    if (result.ok) set({ devices: result.data })
    return result
  },
  setSelected: (id) => set({ selectedId: id }),
  applyDevices: (devices) =>
    set((state) => ({
      devices,
      selectedId: normalizeSelection(devices, state.selectedId)
    }))
}))
