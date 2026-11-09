import type { WirelessRecoveryState } from '@shared/wirelessRecovery'
import { create } from 'zustand'
import type { ExternalDevice, NetworkState } from '@shared/types'

// 真机列表状态（plan 2026-10-13-real-device-usb-and-apk-install）：main 侧已 diff、
// 变化才推全量，这里直写无 revision；选中与 AVD 选择的互斥在 App 组合层裁决
// （点一边清另一边），store 不交叉引用 deviceStore。
// 网络态（plan 2026-10-13-real-device-toolbar-parity S4）放本 store 而非 deviceStore——
// 后者的 network 随 AVD 快照 prune，外部键（serial）会被清掉。
interface ExternalStoreState {
  recovery: WirelessRecoveryState
  applyRecovery: (recovery: WirelessRecoveryState) => void
  devices: ExternalDevice[]
  selectedId: string | null
  /** 真机网络态（main 1s 轮询推送直写；设备消失时随 apply prune） */
  network: Record<string, NetworkState>
  /** 推送入口：全量替换；选中设备消失（拔线/掉线）即清选中、网络态只留健在设备 */
  apply: (devices: ExternalDevice[]) => void
  applyNetworkState: (id: string, state: NetworkState) => void
  select: (id: string | null) => void
  /** 整单重排（plan 2026-11-09）：乐观换序 + 单次 IPC，应答与推送全量替换收敛 */
  reorder: (ids: string[]) => void
}

export const useExternalStore = create<ExternalStoreState>((set, get) => ({
  recovery: { phase: 'idle', blocked: [] },
  applyRecovery: (recovery) => set({ recovery }),
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
  /** 网络态直写；只接受当前在场设备（review P3-3——拔线后在途 toggle 的迟到读回
   *  不得复活死键，等下次全量 apply 自然清理） */
  applyNetworkState: (id, entry) =>
    set((current) =>
      current.devices.some((device) => device.id === id)
        ? { network: { ...current.network, [id]: entry } }
        : current
    ),
  select: (id) => set({ selectedId: id }),
  reorder: (ids) => {
    const prev = get().devices
    // 乐观换序：仅当 ids 与当前设备集相等（防御拔线竞态）；选中态不动
    const byId = new Map(prev.map((device) => [device.id, device]))
    if (ids.length === prev.length && ids.every((id) => byId.has(id))) {
      set({ devices: ids.map((id) => byId.get(id)!) })
    }
    void window.api.devices
      .reorderExternal(ids)
      .then((devices) => get().apply(devices))
      .catch(() => {
        // 失败重拉收敛（track 帧也会带最新序，双保险）
        void window.api.devices
          .listExternal()
          .then((devices) => get().apply(devices))
          .catch(() => undefined)
      })
  }
}))
