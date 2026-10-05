import { app } from 'electron'
import { copyFile, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { DeviceMeta, DeviceMetaLegacy, ImageVariant } from '@shared/types'

/**
 * 设备元数据 store：v1（apiLevel/variant 反推身份）与 v2（精确包身份 + 设置）
 * 显式双版本读取。未知版本或损坏文件触发写保护——停止写入并报告，
 * 不当空库覆盖（issue 2026-10-05-device-store-read-error-as-empty 的契约）。
 */

const STORE_VERSION = 2
const LEGACY_VERSION = 1
const IMAGE_VARIANTS: ImageVariant[] = ['aosp', 'google_apis', 'google_play']

/** 镜像变体闭集守卫——v1 记录校验用（devices 域 v2 入参不再消费） */
export function isImageVariant(value: unknown): value is ImageVariant {
  return IMAGE_VARIANTS.includes(value as ImageVariant)
}

function isDeviceMetaLegacy(value: unknown): value is DeviceMetaLegacy {
  if (typeof value !== 'object' || value === null) return false
  const meta = value as Record<string, unknown>
  return (
    typeof meta.id === 'string' &&
    typeof meta.name === 'string' &&
    typeof meta.profileId === 'string' &&
    typeof meta.profileLabel === 'string' &&
    typeof meta.apiLevel === 'number' &&
    Number.isInteger(meta.apiLevel) &&
    meta.apiLevel >= 1 &&
    meta.apiLevel <= 100 &&
    isImageVariant(meta.variant) &&
    typeof meta.createdAt === 'number'
  )
}

/** v2 条目守卫——手改/损坏文件逐条容错：坏的丢、好的留 */
function isDeviceMetaV2(value: unknown): value is DeviceMeta {
  if (typeof value !== 'object' || value === null) return false
  const meta = value as Record<string, unknown>
  return (
    typeof meta.id === 'string' &&
    typeof meta.name === 'string' &&
    typeof meta.profileId === 'string' &&
    typeof meta.profileLabel === 'string' &&
    typeof meta.imagePackageName === 'string' &&
    meta.imagePackageName.startsWith('system-images;') &&
    (typeof meta.apiDisplay === 'string' || meta.apiDisplay === null) &&
    typeof meta.formFactor === 'string' &&
    typeof meta.createdAt === 'number'
  )
}

interface DeviceStoreFile {
  version: number
  devices: unknown[]
}

/** 写保护状态：置位后 writeDeviceMetas 拒绝覆盖，直到用户处理源文件 */
let writeProtection: string | null = null

/** 读取诊断（测试与上报用）：null = 正常（含首次无文件） */
export const storeWriteProtection = (): string | null => writeProtection

function storePath(): string {
  return join(app.getPath('userData'), 'devices.json')
}

function backupPath(): string {
  return `${storePath()}.v1-backup`
}

/** v1 → v2 派生：旧三变体闭集反推包名（arm64 是 v1 时代唯一 ABI），形态不猜 */
const legacyToV2 = (legacy: DeviceMetaLegacy): DeviceMeta => ({
  id: legacy.id,
  name: legacy.name,
  profileId: legacy.profileId,
  profileLabel: legacy.profileLabel,
  imagePackageName: `system-images;android-${legacy.apiLevel};${
    legacy.variant === 'aosp'
      ? 'default'
      : legacy.variant === 'google_play'
        ? 'google_apis_playstore'
        : 'google_apis'
  };arm64-v8a`,
  apiDisplay: String(legacy.apiLevel),
  formFactor: 'unknown',
  screenSummary: null,
  advancedSettings: null,
  createdAt: legacy.createdAt
})

export async function readDeviceMetas(): Promise<DeviceMeta[]> {
  let raw: string
  const path = storePath()
  try {
    raw = await readFile(path, 'utf8')
  } catch {
    return [] // 无文件 = 首次启动
  }
  let parsed: DeviceStoreFile
  try {
    parsed = JSON.parse(raw) as DeviceStoreFile
  } catch {
    writeProtection = `devices.json 不是合法 JSON，已停止写入（原文件保留在 ${path}）`
    return []
  }
  if (!Array.isArray(parsed.devices)) {
    writeProtection = 'devices.json 缺少 devices 数组，已停止写入'
    return []
  }
  if (parsed.version === STORE_VERSION) {
    return parsed.devices.filter(isDeviceMetaV2)
  }
  if (parsed.version === LEGACY_VERSION) {
    // 只对成功读取且逐条校验通过的旧记录派生；坏条目丢弃但不阻断整体
    return parsed.devices.filter(isDeviceMetaLegacy).map(legacyToV2)
  }
  writeProtection = `devices.json 版本未知（${String(parsed.version)}），已停止写入`
  return []
}

/** 实例元数据落盘唯一写入口（architecture 模块地图）：tmp + rename 原子替换 */
export async function writeDeviceMetas(metas: DeviceMeta[]): Promise<void> {
  if (writeProtection !== null) {
    throw new Error(`元数据文件已写保护：${writeProtection}`)
  }
  const path = storePath()
  // 首次以 v2 覆盖 v1 文件前留备份（一次性；备份已存在不重复）
  try {
    await stat(path)
    const current = JSON.parse((await readFile(path, 'utf8')) as string) as DeviceStoreFile
    if (current.version === LEGACY_VERSION) {
      try {
        await stat(backupPath())
      } catch {
        await copyFile(path, backupPath())
      }
    }
  } catch {
    // 无文件或读不了当前版本头——正常写入路径（首建）
  }
  const payload: DeviceStoreFile = { version: STORE_VERSION, devices: metas }
  const tmp = `${path}.tmp`
  await writeFile(tmp, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  try {
    await rename(tmp, path)
  } catch (error) {
    throw new Error(
      `元数据写入失败（${error instanceof Error ? error.message : String(error)}）；临时文件保留在 ${tmp}`
    )
  }
}

/** 测试接缝：重置模块级写保护 */
export const resetStoreProtection = (): void => {
  writeProtection = null
}
