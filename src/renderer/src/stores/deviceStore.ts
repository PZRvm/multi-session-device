import { create } from 'zustand'
import type {
  CreateDeviceInput,
  CreateDeviceResult,
  Device,
  DeviceSnapshot,
  NetworkState,
  ReconciliationSummary,
  StoreHealth
} from '@shared/types'
import { toApiResult, type ApiResult } from '../api'

/** 选中态维护：选中设备消失（删除/推送覆盖）时回落到首台，列表空则清空 */
const normalizeSelection = (devices: Device[], selectedId: string | null): string | null => {
  if (selectedId !== null && devices.some((device) => device.id === selectedId)) return selectedId
  return devices[0]?.id ?? null
}

/** 网络态键清理：快照里消失的设备删键；无过期键时返回原引用（避免无谓重渲染） */
const pruneNetwork = (
  devices: Device[],
  network: Record<string, NetworkState>
): Record<string, NetworkState> => {
  const ids = new Set(devices.map((device) => device.id))
  const stale = Object.keys(network).filter((id) => !ids.has(id))
  if (stale.length === 0) return network
  const next: Record<string, NetworkState> = {}
  for (const [id, state] of Object.entries(network)) {
    if (ids.has(id)) next[id] = state
  }
  return next
}

const OK_STORE_HEALTH: StoreHealth = { state: 'ok', issues: [] }
const EMPTY_SUMMARY: ReconciliationSummary = {
  signature: null,
  unavailableCount: 0,
  orphanCount: 0,
  storeState: 'ok',
  pendingNotification: false
}

interface DeviceState {
  devices: Device[]
  selectedId: string | null
  /** 已应用的最大快照代次——较旧 revision 的推送/响应一律忽略 */
  revision: number
  /** 首次 list 拉取是否已落定（成败都算落定，避免空库时永远 loading） */
  loaded: boolean
  /** 首次/重试 list 的失败原因；与「空库」分开（读取失败不是还没有设备） */
  loadError: string | null
  storeHealth: StoreHealth
  reconciliation: ReconciliationSummary
  /** 活动来源桶（出身过滤视图谓词依赖，plan 2026-10-12-device-list-origin-view-filter） */
  sourceBucket: 'app-owned' | 'shared-studio'
  /** 设备网络态（plan 2026-10-12）：deviceId → 最新读回；设备是唯一事实源 */
  network: Record<string, NetworkState>
  load: () => Promise<void>
  /** 人工重查（重新检查）：成功时应用合并快照，失败返回错误 */
  reconcile: () => Promise<ApiResult<DeviceSnapshot>>
  create: (input: CreateDeviceInput) => Promise<ApiResult<CreateDeviceResult>>
  rename: (id: string, name: string) => Promise<ApiResult<DeviceSnapshot>>
  remove: (id: string) => Promise<ApiResult<DeviceSnapshot>>
  start: (id: string) => Promise<ApiResult<DeviceSnapshot>>
  stop: (id: string) => Promise<ApiResult<DeviceSnapshot>>
  cancelStart: (id: string) => Promise<ApiResult<DeviceSnapshot>>
  setSelected: (id: string) => void
  /** 主进程 changed 推送与命令响应共用的快照入口（按 revision 幂等） */
  applySnapshot: (snapshot: DeviceSnapshot) => void
  /** 网络态变化入口：networkChanged 推送与 networkSet 读回共用（直写键） */
  applyNetworkState: (deviceId: string, state: NetworkState) => void
  /** 网络态批量入口：networkGet 快照（renderer 刷新后恢复初值，review P3-1）；合并后按当前设备表剪枝 */
  applyNetworkStates: (batch: Record<string, NetworkState>) => void
}

export const useDeviceStore = create<DeviceState>()((set, get) => {
  /** 命令响应走同一 revision 守卫：旧 invoke 结果不得覆盖新推送 */
  const apply = (snapshot: DeviceSnapshot): void => {
    if (snapshot.revision < get().revision) return
    set((state) => ({
      devices: snapshot.devices,
      revision: snapshot.revision,
      selectedId: normalizeSelection(snapshot.devices, state.selectedId),
      storeHealth: snapshot.storeHealth ?? state.storeHealth,
      reconciliation: snapshot.reconciliation ?? state.reconciliation,
      sourceBucket: snapshot.sourceBucket ?? state.sourceBucket,
      network: pruneNetwork(snapshot.devices, state.network)
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
    loadError: null,
    storeHealth: OK_STORE_HEALTH,
    reconciliation: EMPTY_SUMMARY,
    sourceBucket: 'app-owned',
    network: {},
    load: async () => {
      const result = await toApiResult(window.api.devices.list())
      if (result.ok) {
        apply(result.data)
        set({ loaded: true, loadError: null })
      } else {
        set({ loaded: true, loadError: result.error })
      }
    },
    reconcile: async () => {
      const result = await toApiResult(window.api.devices.reconcile())
      if (result.ok) apply(result.data.snapshot)
      return result.ok ? { ok: true, data: result.data.snapshot } : result
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
    applySnapshot: apply,
    applyNetworkState: (deviceId, state) =>
      set((current) => ({ network: { ...current.network, [deviceId]: state } })),
    applyNetworkStates: (batch) =>
      set((current) => ({
        network: pruneNetwork(current.devices, { ...current.network, ...batch })
      }))
  }
})
