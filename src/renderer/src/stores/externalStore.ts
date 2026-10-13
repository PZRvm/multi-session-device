import { create } from 'zustand'
import type { ExternalDevice } from '@shared/types'

// 真机列表状态（plan 2026-10-13-real-device-usb-and-apk-install）：main 侧已 diff、
// 变化才推全量，这里直写无 revision；选中与 AVD 选择的互斥在 App 组合层裁决
// （点一边清另一边），store 不交叉引用 deviceStore。
interface ExternalStoreState {
  devices: ExternalDevice[]
  selectedId: string | null
  /** 推送入口：全量替换；选中设备消失（拔线/掉线）即清选中 */
  apply: (devices: ExternalDevice[]) => void
  select: (id: string | null) => void
}

export const useExternalStore = create<ExternalStoreState>((set) => ({
  devices: [],
  selectedId: null,
  apply: (devices) =>
    set((state) => ({
      devices,
      selectedId:
        state.selectedId !== null && devices.some((device) => device.id === state.selectedId)
          ? state.selectedId
          : null
    })),
  select: (id) => set({ selectedId: id })
}))
