import { app } from 'electron'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { DeviceMeta, ImageVariant } from '@shared/types'

const STORE_VERSION = 1
const IMAGE_VARIANTS: ImageVariant[] = ['aosp', 'google_apis', 'google_play']

/** 镜像变体闭集守卫——store 落盘校验与 devices 域入参校验共用 */
export function isImageVariant(value: unknown): value is ImageVariant {
  return IMAGE_VARIANTS.includes(value as ImageVariant)
}

/** 落盘条目守卫——手改/旧版本文件逐条容错：坏的丢、好的留 */
function isDeviceMeta(value: unknown): value is DeviceMeta {
  if (typeof value !== 'object' || value === null) return false
  const meta = value as Record<string, unknown>
  return (
    typeof meta.id === 'string' &&
    typeof meta.name === 'string' &&
    typeof meta.profileId === 'string' &&
    typeof meta.profileLabel === 'string' &&
    typeof meta.apiLevel === 'number' &&
    Number.isInteger(meta.apiLevel) &&
    isImageVariant(meta.variant) &&
    typeof meta.createdAt === 'number'
  )
}

interface DeviceStoreFile {
  version: number
  devices: DeviceMeta[]
}

function storePath(): string {
  return join(app.getPath('userData'), 'devices.json')
}

export async function readDeviceMetas(): Promise<DeviceMeta[]> {
  let raw: string
  try {
    raw = await readFile(storePath(), 'utf8')
  } catch {
    return [] // 无文件 = 首次启动
  }
  try {
    const parsed = JSON.parse(raw) as DeviceStoreFile
    if (!Array.isArray(parsed.devices)) return []
    return parsed.devices.filter(isDeviceMeta)
  } catch {
    // 损坏文件按空表起步；原文件留在原地，不被静默改写
    return []
  }
}

/** 实例元数据落盘唯一写入口（architecture 模块地图）：tmp 文件 + rename 原子替换 */
export async function writeDeviceMetas(metas: DeviceMeta[]): Promise<void> {
  const payload: DeviceStoreFile = { version: STORE_VERSION, devices: metas }
  const path = storePath()
  const tmp = `${path}.tmp`
  await writeFile(tmp, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  await rename(tmp, path)
}
