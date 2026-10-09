import { app } from 'electron'
import { copyFile, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  CameraConfig,
  DeviceAdvancedSettings,
  DeviceFormFactor,
  DeviceMeta,
  DeviceMetaLegacy,
  DeviceScreenSummary,
  ImageVariant,
  StoreHealth,
  StoreHealthIssue
} from '@shared/types'
import { isStoredAdvancedSettings } from '@shared/settings-contract'

/**
 * 设备元数据 store：v1（apiLevel/variant 反推身份）与 v2（精确包身份 + 设置）
 * 显式双版本读取。读取结果是结构化诊断（typed）——只有 ENOENT 当首次空库；
 * 坏 JSON/未知版本/IO 失败为 error，坏条目/重复 id 为 read-only，均冻结写入、
 * 不把过滤结果写回原库（plan 2026-10-05-avd-reconciliation；issue
 * 2026-10-05-device-store-read-error-as-empty 的契约）。
 */

const STORE_VERSION = 2
const LEGACY_VERSION = 1
const IMAGE_VARIANTS: ImageVariant[] = ['aosp', 'google_apis', 'google_play']
const FORM_FACTORS: DeviceFormFactor[] = [
  'phone',
  'tablet',
  'wear',
  'desktop',
  'tv',
  'automotive',
  'unknown'
]

/** 内部读取结果：error 不提供假成功空库；read-only 的 metas 只含合法且 id 唯一条目 */
export interface DeviceStoreReadResult {
  metas: DeviceMeta[]
  health: StoreHealth
  sourceVersion: 1 | 2 | null
  /** 坏/重复条目里可识别的 id（UUID 形态）——对账「元数据异常关联文件」用 */
  suspectIds: string[]
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** 包名各段拒分隔符与 `.`/`..` 逃逸（段内小数点如 android-36.1 合法） */
const isSafePackageSegment = (segment: string): boolean =>
  segment.length > 0 &&
  segment !== '.' &&
  segment !== '..' &&
  !segment.includes('/') &&
  !segment.includes('\\')

const isDeviceId = (value: unknown): value is string =>
  typeof value === 'string' && UUID_RE.test(value)

const errnoOf = (error: unknown): string | null =>
  typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : null

const isStoredScreenSummary = (value: unknown): value is DeviceScreenSummary => {
  if (typeof value !== 'object' || value === null) return false
  const summary = value as Record<string, unknown>
  return (
    (summary.widthPx === null || typeof summary.widthPx === 'number') &&
    (summary.heightPx === null || typeof summary.heightPx === 'number') &&
    (summary.diagonalInches === null || typeof summary.diagonalInches === 'number')
  )
}

/** 镜像变体闭集守卫——v1 记录校验用（devices 域 v2 入参不再消费） */
export function isImageVariant(value: unknown): value is ImageVariant {
  return IMAGE_VARIANTS.includes(value as ImageVariant)
}

function isDeviceMetaLegacy(value: unknown): value is DeviceMetaLegacy {
  if (typeof value !== 'object' || value === null) return false
  const meta = value as Record<string, unknown>
  // id 与 v2 同口径强制 UUID（review P2-4）：应用生成的旧记录恒为 randomUUID，
  // 非 UUID id 只会来自手改文件——按坏条目诊断，避免「写入落成 v2 后才整库冻结」级联
  return (
    isDeviceId(meta.id) &&
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

/** v2 条目完整校验：返回首个失败字段（诊断用）；通过返回 null */
function firstInvalidV2Field(meta: Record<string, unknown>): string | null {
  if (!isDeviceId(meta.id)) return 'id'
  if (typeof meta.name !== 'string' || meta.name.trim().length === 0 || meta.name.length > 50) {
    return 'name'
  }
  if (typeof meta.profileId !== 'string' || meta.profileId.length === 0) return 'profileId'
  if (typeof meta.profileLabel !== 'string' || meta.profileLabel.length === 0) return 'profileLabel'
  if (typeof meta.imagePackageName !== 'string') return 'imagePackageName'
  const segments = meta.imagePackageName.split(';')
  if (
    segments.length !== 4 ||
    segments[0] !== 'system-images' ||
    segments.slice(1).some((segment) => !isSafePackageSegment(segment))
  ) {
    return 'imagePackageName'
  }
  if (typeof meta.apiDisplay !== 'string' && meta.apiDisplay !== null) return 'apiDisplay'
  if (
    typeof meta.formFactor !== 'string' ||
    !FORM_FACTORS.includes(meta.formFactor as DeviceFormFactor)
  ) {
    return 'formFactor'
  }
  // screenSummary/advancedSettings 契约都是「对象或 null」——先放行 null，
  // 再校验对象形状（误把合法 v2 判坏 = plan 风险表头号）
  if (meta.screenSummary !== null && !isStoredScreenSummary(meta.screenSummary)) {
    return 'screenSummary'
  }
  if (meta.advancedSettings !== null && !isStoredAdvancedSettings(meta.advancedSettings)) {
    return 'advancedSettings'
  }
  if (meta.cutoutResetPending !== undefined && typeof meta.cutoutResetPending !== 'boolean') {
    return 'cutoutResetPending'
  }
  if (
    meta.snapshotReadyAt !== null &&
    (typeof meta.snapshotReadyAt !== 'number' ||
      !Number.isFinite(meta.snapshotReadyAt) ||
      meta.snapshotReadyAt < 0)
  ) {
    return 'snapshotReadyAt'
  }
  if (
    typeof meta.createdAt !== 'number' ||
    !Number.isFinite(meta.createdAt) ||
    meta.createdAt < 0
  ) {
    return 'createdAt'
  }
  return null
}

/** 载入投影（review P3）：只保留已知字段——顶层与嵌套未知键不进内存、不随写回盘 */
const projectCamera = (camera: CameraConfig): CameraConfig =>
  camera.mode === 'webcam'
    ? {
        mode: camera.mode,
        deviceId: camera.deviceId,
        ...(typeof camera.hostDeviceId === 'string' ? { hostDeviceId: camera.hostDeviceId } : {})
      }
    : { mode: camera.mode, deviceId: null }

const projectSettings = (settings: DeviceAdvancedSettings): DeviceAdvancedSettings => ({
  skinRef: settings.skinRef,
  frontCamera: projectCamera(settings.frontCamera),
  rearCamera: projectCamera(settings.rearCamera),
  networkSpeed: settings.networkSpeed,
  networkLatency: settings.networkLatency,
  orientation: settings.orientation,
  bootMode: settings.bootMode,
  internalStorageMiB: settings.internalStorageMiB,
  cpuCores: settings.cpuCores,
  graphics: settings.graphics,
  ramMiB: settings.ramMiB,
  vmHeapMiB: settings.vmHeapMiB,
  preferredAbi: settings.preferredAbi
})

const projectV2Meta = (meta: DeviceMeta): DeviceMeta => ({
  id: meta.id,
  name: meta.name,
  profileId: meta.profileId,
  profileLabel: meta.profileLabel,
  imagePackageName: meta.imagePackageName,
  apiDisplay: meta.apiDisplay,
  formFactor: meta.formFactor,
  screenSummary:
    meta.screenSummary === null
      ? null
      : {
          widthPx: meta.screenSummary.widthPx,
          heightPx: meta.screenSummary.heightPx,
          diagonalInches: meta.screenSummary.diagonalInches
        },
  advancedSettings: meta.advancedSettings === null ? null : projectSettings(meta.advancedSettings),
  snapshotReadyAt: meta.snapshotReadyAt ?? null,
  ...(meta.cutoutResetPending === true ? { cutoutResetPending: true } : {}),
  createdAt: meta.createdAt
})

interface DeviceStoreFile {
  version: number
  devices: unknown[]
}

/** 写保护状态：置位后 writeDeviceMetas 拒绝覆盖，直到受控重读成功或用户处理源文件 */
let writeProtection: string | null = null

/** 读取诊断（测试与上报用）：null = 正常（含首次无文件） */
export const storeWriteProtection = (): string | null => writeProtection

/** 生产侧再次武装写保护（重查发现外部元数据变化时维持冻结）；解除只走受控重读 */
export const armStoreProtection = (reason: string): void => {
  writeProtection = reason
}

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
  snapshotReadyAt: null,
  createdAt: legacy.createdAt
})

const errorHealth = (code: string, message: string): StoreHealth => ({
  state: 'error',
  issues: [{ code, message }]
})

/** errno 归因：只有 ENOENT 是首次使用；EACCES/EIO 等是读取失败（测试直接消费） */
export const classifyReadError = (error: unknown): { code: string; message: string } => {
  const errno =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code: unknown }).code)
      : null
  const detail = error instanceof Error ? error.message : String(error)
  if (errno === 'ENOENT') return { code: 'ENOENT', message: '文件不存在' }
  return {
    code: errno ?? 'read-failed',
    message: `devices.json 读取失败（${errno ?? '未知错误'}）：${detail}`
  }
}

/**
 * 双版本 typed 读取。ok = 合法 v1/v2 或文件不存在；read-only = 坏条目/重复 id
 * （metas 只含合法唯一条目）；error = 坏 JSON/非法顶层/未知版本/权限 IO 失败。
 * 只有 ok 会解除写保护——这是生产侧唯一解除入口。
 */
export async function readDeviceStore(): Promise<DeviceStoreReadResult> {
  const path = storePath()
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (error) {
    const { code, message } = classifyReadError(error)
    if (code === 'ENOENT') {
      writeProtection = null
      return { metas: [], health: { state: 'ok', issues: [] }, sourceVersion: null, suspectIds: [] }
    }
    writeProtection = message
    return {
      metas: [],
      health: errorHealth(code, message),
      sourceVersion: null,
      suspectIds: []
    }
  }

  const finish = (
    metas: DeviceMeta[],
    health: StoreHealth,
    sourceVersion: 1 | 2 | null,
    suspectIds: string[]
  ): DeviceStoreReadResult => {
    if (health.state === 'ok') writeProtection = null
    else {
      const reason =
        health.issues.length > 0
          ? `devices.json 异常（${health.issues.map((issue) => issue.message).join('；')}），已停止写入（原文件保留在 ${path}）`
          : `devices.json 异常，已停止写入（原文件保留在 ${path}）`
      writeProtection = reason
    }
    return { metas, health, sourceVersion, suspectIds }
  }

  let parsed: DeviceStoreFile
  try {
    parsed = JSON.parse(raw) as DeviceStoreFile
  } catch {
    return finish([], errorHealth('invalid-json', 'devices.json 不是合法 JSON'), null, [])
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return finish([], errorHealth('invalid-top-level', 'devices.json 顶层不是对象'), null, [])
  }
  if (!Array.isArray(parsed.devices)) {
    // 版本可辨即如实上报（review P3——sourceVersion 口径一致）
    return finish(
      [],
      errorHealth('missing-devices-array', 'devices.json 缺少 devices 数组'),
      parsed.version === STORE_VERSION || parsed.version === LEGACY_VERSION ? parsed.version : null,
      []
    )
  }
  if (parsed.version === STORE_VERSION) {
    const [valid, health, , suspectIds] = collectEntries(parsed.devices, 'v2')
    // 载入投影（review P3）：未知顶层/嵌套键不进内存、不随写回盘
    return finish(valid as DeviceMeta[], health, 2, suspectIds)
  }
  if (parsed.version === LEGACY_VERSION) {
    const [valid, health, , suspectIds] = collectEntries(parsed.devices, 'v1')
    return finish((valid as DeviceMetaLegacy[]).map(legacyToV2), health, 1, suspectIds)
  }
  return finish(
    [],
    errorHealth('unknown-version', `devices.json 版本未知（${String(parsed.version)}）`),
    null,
    []
  )
}

/**
 * 条目级收集：合法且 id 唯一的原始条目保留（v2 = DeviceMeta 形状，v1 = legacy 形状，
 * 由调用方决定是否派生），坏条目/重复 id 逐项诊断并排除。
 */
function collectEntries(
  entries: unknown[],
  kind: 'v1' | 'v2'
): [unknown[], StoreHealth, 1 | 2, string[]] {
  const issues: StoreHealthIssue[] = []
  const suspectIds: string[] = []
  const seen = new Map<string, number>()
  const duplicateIndexes = new Set<number>()
  const valid: unknown[] = []

  entries.forEach((entry, index) => {
    const record =
      typeof entry === 'object' && entry !== null ? (entry as Record<string, unknown>) : null
    const id = record !== null && isDeviceId(record.id) ? record.id : null
    if (id !== null && seen.has(id)) {
      duplicateIndexes.add(index)
      duplicateIndexes.add(seen.get(id)!)
      return
    }
    if (id !== null) seen.set(id, index)
  })

  entries.forEach((entry, index) => {
    if (duplicateIndexes.has(index)) {
      const record =
        typeof entry === 'object' && entry !== null ? (entry as Record<string, unknown>) : null
      const id = record !== null && isDeviceId(record.id) ? record.id : null
      if (id !== null && !suspectIds.includes(id)) suspectIds.push(id)
      issues.push({
        code: 'duplicate-id',
        entryIndex: index,
        message: `第 ${index + 1} 条 id 重复（${id ?? '无法识别'}），该 id 的全部条目未载入`
      })
      return
    }
    const record =
      typeof entry === 'object' && entry !== null ? (entry as Record<string, unknown>) : null
    const field =
      kind === 'v2'
        ? record !== null
          ? firstInvalidV2Field(record)
          : 'entry'
        : isDeviceMetaLegacy(entry)
          ? null
          : 'entry'
    if (field !== null) {
      const id = record !== null && isDeviceId(record.id) ? record.id : null
      if (id !== null && !suspectIds.includes(id)) suspectIds.push(id)
      issues.push({
        code: 'invalid-entry',
        entryIndex: index,
        message:
          kind === 'v2'
            ? `第 ${index + 1} 条记录字段不合法（${field}），未载入`
            : `第 ${index + 1} 条旧记录不合法，未载入`
      })
      return
    }
    // v1 走 legacy 形状（派生时重建全字段，天然无未知键）；v2 原样入列，
    // 由 readDeviceStore 统一做白名单投影
    valid.push(kind === 'v2' ? projectV2Meta(entry as DeviceMeta) : entry)
  })

  const health: StoreHealth =
    issues.length > 0 ? { state: 'read-only', issues } : { state: 'ok', issues: [] }
  return [valid, health, kind === 'v2' ? 2 : 1, suspectIds]
}

/** 实例元数据落盘唯一写入口（architecture 模块地图）：tmp + rename 原子替换 */
export async function writeDeviceMetas(metas: DeviceMeta[]): Promise<void> {
  if (writeProtection !== null) {
    throw new Error(`元数据文件已写保护：${writeProtection}`)
  }
  const path = storePath()
  // 首次以 v2 覆盖 v1 文件前留备份（一次性；备份已存在不重复）。
  // 现存文件读不了/解析不了 → 中止写入拒绝盲覆盖；备份复制失败同样中止（review P3）
  let existing: string | null = null
  try {
    existing = await readFile(path, 'utf8')
  } catch (error) {
    if (errnoOf(error) !== 'ENOENT') {
      throw new Error(
        `元数据写入中止：现有 devices.json 读取失败（${errnoOf(error) ?? '未知错误'}），原文件保留`
      )
    }
  }
  if (existing !== null) {
    let current: DeviceStoreFile
    try {
      current = JSON.parse(existing) as DeviceStoreFile
    } catch {
      throw new Error('元数据写入中止：现有 devices.json 无法解析，拒绝盲覆盖（原文件保留）')
    }
    if (current.version === LEGACY_VERSION) {
      try {
        await stat(backupPath())
      } catch {
        try {
          await copyFile(path, backupPath())
        } catch (error) {
          throw new Error(
            `v1 备份失败（${error instanceof Error ? error.message : String(error)}），已中止写入（原文件保留）`
          )
        }
      }
    }
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

/** 测试接缝：重置模块级写保护（生产解除只能由受控重读 readDeviceStore 成功执行） */
export const resetStoreProtection = (): void => {
  writeProtection = null
}
