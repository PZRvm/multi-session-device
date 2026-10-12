import type { Device, DeviceStatus } from '@shared/types'
import { originOfMeta, type SourceBucket } from '@shared/deviceOrigin'

// 出身/桶口径单源在 @shared/deviceOrigin（review P3-1）；此处只保留视图概念
export type { SourceBucket }

/** 出身读取（单源别名）：缺席（存量）回落 app-owned */
export const originOf = originOfMeta

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
