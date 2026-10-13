import { create } from 'zustand'
import type { ExternalDevice, NetworkState } from '@shared/types'

// 真机列表状态（plan 2026-10-13-real-device-usb-and-apk-install）：main 侧已 diff、
// 变化才推全量，这里直写无 revision；选中与 AVD 选择的互斥在 App 组合层裁决
// （点一边清另一边），store 不交叉引用 deviceStore。
// 网络态（plan 2026-10-13-real-device-toolbar-parity S4）放本 store 而非 deviceStore——
// 后者的 network 随 AVD 快照 prune，外部键（serial）会被清掉。
interface ExternalStoreState {
  devices: ExternalDevice[]
  selectedId: string | null
  /** 真机网络态（main 1s 轮询推送直写；设备消失时随 apply prune） */
  network: Record<string, NetworkState>
  /** 推送入口：全量替换；选中设备消失（拔线/掉线）即清选中、网络态只留健在设备 */
  apply: (devices: ExternalDevice[]) => void
  applyNetworkState: (id: string, state: NetworkState) => void
  select: (id: string | null) => void
}

export const useExternalStore = create<ExternalStoreState>((set) => ({
  devices: [],
  selectedId: null,
  network: {},
  apply: (devices) =>
    set((state) => {
      const alive = new Set(devices.map((device) => device.id))
      const network: Record<string, NetworkState> = {}
      for (const [id, entry] of Object.entries(state.network)) {
        if (alive.has(id)) network[id] = entry
      }
      return {
        devices,
        network,
        selectedId:
          state.selectedId !== null && devices.some((device) => device.id === state.selectedId)
            ? state.selectedId
            : null
      }
    }),
  applyNetworkState: (id, entry) =>
    set((current) => ({ network: { ...current.network, [id]: entry } })),
  select: (id) => set({ selectedId: id })
}))
