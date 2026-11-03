import type { DeviceMeta } from './types'

/** 设备出身来源桶（与 DeviceSnapshot.sourceBucket 同型；review P3-1 单源口径） */
export type SourceBucket = 'app-owned' | 'shared-studio'

/**
 * 出身读取：缺席（共享模式出现前的存量）回落 app-owned——main（跨桶守卫/级联/
 * 计数/快照桶）与 renderer（过滤视图）共用此单源，勿再各写 `?? 'app-owned'`。
 */
export const originOfMeta = (meta: Pick<DeviceMeta, 'imageSourceOrigin'>): SourceBucket =>
  meta.imageSourceOrigin ?? 'app-owned'

/** 活动来源桶：shared 只读态为 shared-studio，托管/自选为 app-owned */
export const bucketOfShared = (shared: boolean): SourceBucket =>
  shared ? 'shared-studio' : 'app-owned'
