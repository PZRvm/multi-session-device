import { create } from 'zustand'
import type { CreateDeviceInput, CreateDeviceResult, Device, DeviceSnapshot } from '@shared/types'
import { toApiResult, type ApiResult } from '../api'

/** 选中态维护：选中设备消失（删除/推送覆盖）时回落到首台，列表空则清空 */
const normalizeSelection = (devices: Device[], selectedId: string | null): string | null => {
  if (selectedId !== null && devices.some((device) => device.id === selectedId)) return selectedId
  return devices[0]?.id ?? null
}

interface DeviceState {
  devices: Device[]
  selectedId: string | null
  /** 已应用的最大快照代次——较旧 revision 的推送/响应一律忽略 */
  revision: number
  /** 首次 list 拉取是否已落定（成败都算落定，避免空库时永远 loading） */
  loaded: boolean
  load: () => Promise<void>
  create: (input: CreateDeviceInput) => Promise<ApiResult<CreateDeviceResult>>
  rename: (id: string, name: string) => Promise<ApiResult<DeviceSnapshot>>
  remove: (id: string) => Promise<ApiResult<DeviceSnapshot>>
  start: (id: string) => Promise<ApiResult<DeviceSnapshot>>
  stop: (id: string) => Promise<ApiResult<DeviceSnapshot>>
  cancelStart: (id: string) => Promise<ApiResult<DeviceSnapshot>>
  setSelected: (id: string) => void
  /** 主进程 changed 推送与命令响应共用的快照入口（按 revision 幂等） */
  applySnapshot: (snapshot: DeviceSnapshot) => void
}

export const useDeviceStore = create<DeviceState>()((set, get) => {
  /** 命令响应走同一 revision 守卫：旧 invoke 结果不得覆盖新推送 */
  const apply = (snapshot: DeviceSnapshot): void => {
    if (snapshot.revision < get().revision) return
    set((state) => ({
      devices: snapshot.devices,
      revision: snapshot.revision,
      selectedId: normalizeSelection(snapshot.devices, state.selectedId)
    }))
  }

  const runCommand = async (
    call: () => Promise<DeviceSnapshot>
  ): Promise<ApiResult<DeviceSnapshot>> => {
    const result = await toApiResult(call())
    if (result.ok) apply(result.data)
    return result
  }

  return {
    devices: [],
    selectedId: null,
    revision: -1,
    loaded: false,
    load: async () => {
      const result = await toApiResult(window.api.devices.list())
      if (result.ok) {
        apply(result.data)
        set({ loaded: true })
      } else {
        set({ loaded: true })
      }
    },
    create: async (input) => {
      const result = await toApiResult(window.api.devices.create(input))
      if (result.ok) {
        apply(result.data.snapshot)
        set({ selectedId: result.data.createdId })
      }
      return result
    },
    rename: (id, name) => runCommand(() => window.api.devices.rename(id, name)),
    remove: (id) => runCommand(() => window.api.devices.remove(id)),
    start: (id) => runCommand(() => window.api.devices.start(id)),
    stop: (id) => runCommand(() => window.api.devices.stop(id)),
    cancelStart: (id) => runCommand(() => window.api.devices.cancelStart(id)),
    setSelected: (id) => set({ selectedId: id }),
    applySnapshot: apply
  }
})
