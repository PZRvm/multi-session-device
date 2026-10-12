import type { Device, DeviceStatus } from '@shared/types'

/** 活动来源桶（与 DeviceSnapshot.sourceBucket 同型） */
export type SourceBucket = 'app-owned' | 'shared-studio'

/** 出身读取：缺席（存量）回落 app-owned（plan 2026-10-12-device-list-source-aware 轴 2） */
export const originOf = (device: Device): SourceBucket => device.imageSourceOrigin ?? 'app-owned'

/** 过渡态：starting/running/stopping 豁免出身过滤（跨桶运行设备必须可见可停） */
export const isTransientStatus = (status: DeviceStatus): boolean =>
  status === 'starting' || status === 'running' || status === 'stopping'

export interface OriginViewSplit {
  /** 当前视图平铺：本桶出身 + 全部过渡态设备 */
  active: Device[]
  /** 折叠区：另一桶且非过渡态设备 */
  folded: Device[]
}

/**
 * 出身过滤视图（plan 2026-10-12-device-list-origin-view-filter）：按当前来源桶
 * 一分为二。DeviceListPane 与 App 汇总条口径共用同一谓词（轴 2——两侧单源）。
 */
export const splitByOriginView = (
  devices: Device[],
  sourceBucket: SourceBucket
): OriginViewSplit => {
  const active: Device[] = []
  const folded: Device[] = []
  for (const device of devices) {
    if (originOf(device) === sourceBucket || isTransientStatus(device.status)) active.push(device)
    else folded.push(device)
  }
  return { active, folded }
}
