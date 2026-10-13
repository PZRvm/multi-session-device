import { useState } from 'react'
import type { Device, NetworkState, NetworkTarget } from '@shared/types'
import { toApiResult } from '../api'
import { useDeviceStore } from '../stores/deviceStore'
import { useExternalStore } from '../stores/externalStore'
import { MAIN_COPY } from '@shared/i18n'
import { useCopy } from './useCopy'

/**
 * 网络开关组 renderer 侧（plan 2026-10-12）：态来自 store（设备为唯一事实源，
 * networkChanged 推送直写）；toggle busy 至读回确认；失败原生 dialog 展示错误
 * （主进程词条已含 stderr 详情）。读回为 null（命令成功但读暂不可用）不报错，
 * 等轮询 1s 内补推。
 *
 * 真机适配（plan 2026-10-13-real-device-toolbar-parity S4）：id 双源合并读——外部
 * 键（serial）存 externalStore（deviceStore 的 network 随 AVD 快照 prune 会清外部键），
 * AVD 键存 deviceStore；两源 id 不相交，?? 合并安全。写回按 externalStore 成员路由。
 */
const readNetworkState = (id: string): NetworkState | null =>
  useExternalStore.getState().network[id] ?? useDeviceStore.getState().network[id] ?? null

const applyNetworkStateRouted = (id: string, state: NetworkState): void => {
  if (useExternalStore.getState().devices.some((device) => device.id === id)) {
    useExternalStore.getState().applyNetworkState(id, state)
  } else {
    useDeviceStore.getState().applyNetworkState(id, state)
  }
}

export const useNetworkSwitch = (
  device: Pick<Device, 'id'>
): {
  state: NetworkState | null
  busyTarget: NetworkTarget | null
  toggle: (target: NetworkTarget) => Promise<void>
} => {
  const network = useDeviceStore((current) => current.network)
  const externalNetwork = useExternalStore((current) => current.network)
  const state = externalNetwork[device.id] ?? network[device.id] ?? null
  const [busyTarget, setBusyTarget] = useState<NetworkTarget | null>(null)
  const copy = useCopy(MAIN_COPY)

  const toggle = async (target: NetworkTarget): Promise<void> => {
    // store 实时读：闭包里的 state 可能落后于最近一次推送
    const current = readNetworkState(device.id)
    if (!current || busyTarget !== null) return
    setBusyTarget(target)
    const result = await toApiResult(window.api.network.set(device.id, target, !current[target]))
    setBusyTarget(null)
    if (result.ok) {
      if (result.data.state) {
        applyNetworkStateRouted(device.id, result.data.state)
      }
      return
    }
    await toApiResult(
      window.api.dialog.show({
        title: copy.networkToggleFailed,
        message: result.error,
        buttons: [copy.ok]
      })
    )
  }

  return { state, busyTarget, toggle }
}
