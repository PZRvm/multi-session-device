import { BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import type {
  Device,
  DeviceAvailability,
  DeviceMeta,
  DeviceSnapshot,
  ReconcileReport,
  ReconciliationSummary,
  StoreHealth
} from '@shared/types'
import { bucketOfShared } from '@shared/deviceOrigin'
import { isSharedReadOnly } from '../emulator/sdkSource'
import { msg } from '../locale'
import { frameKindOf } from './environment'

// ---- 主进程是设备列表与运行状态的唯一事实源（architecture 边界不变量）----
// status/lastError/serial/runId 只活在这里的内存里，重启一律「停止」，不入盘。
// availability/storeHealth 同为内存派生（对账产物），随快照发布、不进 toMeta。

// 可重赋值的跨组共享状态：ESM let 导出不可外部赋值，统一走 Now()/set 访问器
// （单写方持有的 loadPromise/writeQueue/reconcilePromise/deleteFlights 等留在持有者文件）

let devices: Device[] = []
let revision = 0
let acceptingCommands = true

// ---- 对账状态（plan 2026-10-05-avd-reconciliation 设计 3）----

/** 当前库健康：error 时无可信列表；read-only 冻结一切元数据写入 */
let storeHealth: StoreHealth = { state: 'ok', issues: [] }
/** 坏/重复条目中可识别的 id（「元数据异常关联文件」） */
let suspectIds: string[] = []
/** 元数据提交代次（commitMetas 成功后 +1）——扫描过期判定 */
let metaRevision = 0
/** AVD 文件变更代次（create/delete 事务开始与结束 +1）——扫描过期判定 */
let avdEpoch = 0
let lastReport: ReconcileReport | null = null

// ---- 配置编辑域状态（plan 2026-10-08-device-config-edit）----

/** 同设备保存互斥（覆盖全部 await）：持有期间启动/删除/独立重命名/重复保存拒绝交错 */
export const editFlights = new Map<string, Promise<DeviceSnapshot>>()
/** 事务恢复无法裁决、冻结配置写入的目标（id → 中文原因；行内 lastError 反馈） */
export const frozenMessages = new Map<string, string>()

/** 投屏会话桥（ipc 层装配）：running 建流，stopped/beforeKill 释放流资源 */
export const streamBridge: {
  running?: (id: string, runId: string, serial: string) => void
  stopped?: (id: string) => void
  beforeKill?: (id: string, runId: string) => Promise<void>
} = {}

export function attachDeviceStreamBridge(bridge: typeof streamBridge): void {
  Object.assign(streamBridge, bridge)
}

/** 内存设备列表（元素可就地变更；整体替换走 setDevices——跨 await 的提交路径会重建数组） */
export const devicesNow = (): Device[] => devices
export const setDevices = (next: Device[]): void => {
  devices = next
}

export const revisionNow = (): number => revision

export const acceptingCommandsNow = (): boolean => acceptingCommands
export const setAcceptingCommands = (next: boolean): void => {
  acceptingCommands = next
}

export const storeHealthNow = (): StoreHealth => storeHealth
export const setStoreHealth = (next: StoreHealth): void => {
  storeHealth = next
}

export const suspectIdsNow = (): string[] => suspectIds
export const setSuspectIds = (next: string[]): void => {
  suspectIds = next
}

export const metaRevisionNow = (): number => metaRevision
export const bumpMetaRevision = (): void => {
  metaRevision += 1
}

export const avdEpochNow = (): number => avdEpoch
export const bumpAvdEpoch = (): void => {
  avdEpoch += 1
}

export const lastReportNow = (): ReconcileReport | null => lastReport
export const setLastReport = (next: ReconcileReport | null): void => {
  lastReport = next
}

export const checkingAvailability = (): DeviceAvailability => ({
  state: 'checking',
  issues: [],
  checkedAt: null
})

/** 创建/删除/回滚/保存中的 id：扫描时暂缓判孤立（保存中 config 半提交不是稳定目标） */
export const transientIdsNow = (): Set<string> =>
  new Set([
    ...devices
      .filter((device) => device.status === 'creating' || device.status === 'deleting')
      .map((device) => device.id),
    ...editFlights.keys()
  ])

/**
 * 以 metas 重建 devices：同 id 保留完整运行字段（status/lastError/serial/runId/
 * startedAt/availability），新 id 落 stopped + checking——首载/首建/提交三处共用
 * 单源（review P3：三段近重复收敛）。
 */
export const rebuildDevices = (metas: DeviceMeta[]): Device[] => {
  const runtimeById = new Map(devices.map((device) => [device.id, device]))
  return metas.map((meta) => {
    const runtime = runtimeById.get(meta.id)
    return runtime !== undefined
      ? {
          ...meta,
          frameKind: runtime.frameKind ?? frameKindOf(meta.profileId),
          status: runtime.status,
          lastError: runtime.lastError,
          cameraNotice: runtime.cameraNotice,
          serial: runtime.serial,
          runId: runtime.runId,
          startedAt: runtime.startedAt,
          availability: runtime.availability
        }
      : {
          ...meta,
          frameKind: frameKindOf(meta.profileId),
          status: 'stopped' as const,
          availability: checkingAvailability()
        }
  })
}

export const toMeta = (device: Device): DeviceMeta => ({
  id: device.id,
  name: device.name,
  profileId: device.profileId,
  profileLabel: device.profileLabel,
  imagePackageName: device.imagePackageName,
  apiDisplay: device.apiDisplay,
  formFactor: device.formFactor,
  screenSummary: device.screenSummary,
  advancedSettings: device.advancedSettings,
  snapshotReadyAt: device.snapshotReadyAt ?? null,
  ...(device.cutoutResetPending === true ? { cutoutResetPending: true } : {}),
  ...(device.imageSourceOrigin !== undefined
    ? { imageSourceOrigin: device.imageSourceOrigin }
    : {}),
  createdAt: device.createdAt
})

export const reconciliationSummaryNow = (): ReconciliationSummary => ({
  signature: lastReport?.signature ?? null,
  unavailableCount: devices.filter(
    (device) =>
      device.availability !== undefined &&
      device.availability.state !== 'valid' &&
      device.availability.state !== 'checking'
  ).length,
  orphanCount: lastReport?.orphanEntries.length ?? 0,
  scanError: lastReport?.scanError ?? null,
  storeState: storeHealth.state,
  pendingNotification: lastReport?.pendingNotification ?? false
})

export const snapshotNow = (): DeviceSnapshot => ({
  revision,
  devices: devices.map((device) => ({ ...device })),
  storeHealth,
  reconciliation: reconciliationSummaryNow(),
  // 活动来源桶（出身过滤视图）：切来源后的重查轮快照自然翻转到新桶
  sourceBucket: bucketOfShared(isSharedReadOnly())
})

export const broadcastChanged = (): void => {
  revision += 1
  const snapshot = snapshotNow()
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(IPC_CHANNELS.devicesChanged, snapshot)
  }
}

export const requireDevice = (id: string): Device => {
  const device = devices.find((entry) => entry.id === id)
  if (!device) throw new Error(msg('deviceNotFound', { id }))
  return device
}
