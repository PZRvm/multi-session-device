import AdmZip from 'adm-zip'
import { XMLParser } from 'fast-xml-parser'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  DeviceFormFactor,
  DeviceFrameKind,
  DeviceProfile,
  DeviceScreenInfo
} from '@shared/types'

/**
 * 官方画像元数据：从 cmdline-tools 的 sdklib JAR 读七份设备 XML（结构化解析，
 * namespace 版本 1–10 差异靠 removeNSPrefix 按 localName 匹配），与 avdmanager
 * 输出按 id 关联成富画像。分类规则与数据源实证见
 * `__tests__/fixtures/README.md`（批次 1）。
 */

/**
 * sdklib JAR 内的画像资源（avdmanager list device 的元数据来源）。
 * impliedFormTag = 该源文件全部画像的隐含形态 tag：七份 XML 均不含 tag 元素
 * （fixture 实证），avdmanager 的 Tag 展示按源文件归类（wear.xml →
 * android-wear 等）；null = 通用文件（devices/nexus，形态按屏幕尺寸规则判）。
 * 新增形态专属 XML 只登记这一处——读取清单与隐含 tag 同表派生，不再两处维护
 * （修复轮 review P3）。
 */
const DEVICE_XML_SOURCES: ReadonlyArray<{ name: string; impliedFormTag: string | null }> = [
  { name: 'automotive', impliedFormTag: 'android-automotive' },
  { name: 'desktop', impliedFormTag: 'android-desktop' },
  { name: 'devices', impliedFormTag: null },
  { name: 'nexus', impliedFormTag: null },
  { name: 'tv', impliedFormTag: 'android-tv' },
  { name: 'wear', impliedFormTag: 'android-wear' },
  { name: 'xr', impliedFormTag: 'android-xr' }
]

/** 像素密度符号 → 逻辑 dpi（官方 density 定义） */
const DENSITY_SYMBOLS: Record<string, number> = {
  ldpi: 120,
  mdpi: 160,
  tvdpi: 213,
  hdpi: 240,
  xhdpi: 320,
  xxhdpi: 480,
  xxxhdpi: 640
}

/** RAM / 存储元素 unit 属性 → MiB 换算 */
const SIZE_UNITS: Record<string, number> = {
  KiB: 1 / 1024,
  MiB: 1,
  GiB: 1024
}

/** 特殊 tag id → 形态（优先于屏幕尺寸规则；-playstore/-distantdisplay 等后缀一并命中） */
const TAG_FORM_FACTORS: Array<[RegExp, DeviceFormFactor]> = [
  [/^(android-)?wear($|-)/i, 'wear'],
  [/^(android-)?tv($|-)/i, 'tv'],
  [/^(android-)?desktop($|-)/i, 'desktop'],
  [/^(android-)?automotive($|-)/i, 'automotive']
]

export const sdklibJarPathFor = (sdkRoot: string): string =>
  join(sdkRoot, 'cmdline-tools', 'latest', 'lib', 'sdklib', 'sdklib.core.jar')

/** XML 解析出的原始画像（未与 avdmanager 关联、未分类） */
export interface RawProfileMeta {
  id: string
  name: string
  manufacturer: string | null
  tagIds: string[]
  screen: DeviceScreenInfo
  foldable: boolean
  apiMin: number | null
  apiMax: number | null
  playSupported: boolean | null
  hasFrontCamera: boolean | null
  hasBackCamera: boolean | null
  ramMiB: number | null
}

const parser = new XMLParser({
  ignoreDeclaration: true,
  removeNSPrefix: true,
  // v5 起默认忽略属性——ram 的 unit 等属性必须显式开启
  ignoreAttributes: false,
  parseTagValue: false,
  trimValues: true
})

const toArray = <T>(value: unknown): T[] => {
  if (value === undefined || value === null) return []
  return Array.isArray(value) ? (value as T[]) : [value as T]
}

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null

const numberOrNull = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

const boolFromText = (value: unknown): boolean | null => {
  const raw = text(value)
  if (raw === 'true') return true
  if (raw === 'false') return false
  return null
}

/** pixel-density 值（"420dpi"/"xhdpi"）→ 逻辑 dpi */
export const logicalDpiFromDensity = (value: unknown): number | null => {
  const raw = text(value)
  if (raw === null) return null
  const symbolic = DENSITY_SYMBOLS[raw.toLowerCase()]
  if (symbolic !== undefined) return symbolic
  const numeric = numberOrNull(raw.replace(/dpi$/i, ''))
  return numeric !== null && numeric > 0 ? numeric : null
}

/** api-level 文本（"14-" / "29-33" / "36" / "-1"）→ 范围；-1 与非法值为 null */
export const parseApiRange = (value: unknown): { min: number | null; max: number | null } => {
  const raw = text(value)
  if (raw === null) return { min: null, max: null }
  const match = raw.match(/^(\d+)(?:-(\d+)?)?$/)
  if (!match) return { min: null, max: null }
  const min = Number(match[1])
  const max = match[2] !== undefined && match[2] !== '' ? Number(match[2]) : null
  if (min < 0) return { min: null, max: null }
  return { min, max }
}

/** ram / internal-storage 元素（{ '@_unit': 'MiB', '#text': 512 }）→ MiB */
export const parseSizeToMiB = (value: unknown): number | null => {
  if (value === null || typeof value !== 'object') {
    const plain = numberOrNull(value)
    return plain !== null && plain > 0 ? plain : null
  }
  const record = value as Record<string, unknown>
  const amount = numberOrNull(record['#text'])
  if (amount === null || amount <= 0) return null
  const unit = text(record['@_unit']) ?? 'MiB'
  const factor = SIZE_UNITS[unit]
  if (factor === undefined) return null
  return amount * factor
}

/** 解析一份设备 XML（devices/1–10 任一 namespace 版本）为原始画像列表 */
export const parseDeviceXml = (xml: string): RawProfileMeta[] => {
  let parsed: unknown
  try {
    parsed = parser.parse(xml)
  } catch {
    return []
  }
  const devicesRoot = (parsed as Record<string, unknown>)?.devices as
    Record<string, unknown> | undefined
  const metas: RawProfileMeta[] = []
  for (const device of toArray<Record<string, unknown>>(devicesRoot?.device)) {
    const id = text(device.id)
    const name = text(device.name)
    if (id === null || name === null) continue

    const tagIds = toArray<Record<string, unknown>>(device.tag)
      .map((tag) => text(tag.id))
      .filter((tagId): tagId is string => tagId !== null)

    const screenNode = (device.hardware as Record<string, unknown> | undefined)?.screen as
      Record<string, unknown> | undefined
    const dimensions = screenNode?.dimensions as Record<string, unknown> | undefined
    const diagonalInches = numberOrNull(screenNode?.['diagonal-length'])

    const cameras = toArray<Record<string, unknown>>(
      (device.hardware as Record<string, unknown> | undefined)?.camera
    )
    const cameraLocations = new Set(
      cameras.map((camera) => text(camera.location)).filter((loc): loc is string => loc !== null)
    )

    const { min: apiMin, max: apiMax } = parseApiRange(
      (device.software as Record<string, unknown> | undefined)?.['api-level']
    )

    metas.push({
      id,
      name,
      manufacturer: text(device.manufacturer),
      tagIds,
      screen: {
        widthPx: numberOrNull(dimensions?.['x-dimension']),
        heightPx: numberOrNull(dimensions?.['y-dimension']),
        diagonalInches,
        logicalDpi: logicalDpiFromDensity(screenNode?.['pixel-density']),
        round: null
      },
      foldable: screenNode?.['foldable-region'] !== undefined,
      apiMin,
      apiMax,
      playSupported: boolFromText(device['playstore-enabled']),
      hasFrontCamera: cameraLocations.has('front') ? true : cameras.length > 0 ? false : null,
      hasBackCamera: cameraLocations.has('back') ? true : cameras.length > 0 ? false : null,
      ramMiB: parseSizeToMiB((device.hardware as Record<string, unknown> | undefined)?.ram)
    })
  }
  return metas
}

/**
 * 形态分类（plan 设计 1）：
 * 特殊标签决定 Wear/TV/Desktop/Automotive；无特殊标签、默认屏幕 ≥7 英寸且
 * 非折叠才是 Tablet，其余有屏幕数据者为 Phone；无屏幕数据或未知标签 → unknown。
 */
export const classifyFormFactor = (meta: {
  tagIds: string[]
  diagonalInches: number | null
  foldable: boolean
}): DeviceFormFactor => {
  let hasTag = false
  for (const tagId of meta.tagIds) {
    hasTag = true
    for (const [pattern, formFactor] of TAG_FORM_FACTORS) {
      if (pattern.test(tagId)) return formFactor
    }
  }
  if (hasTag) return 'unknown'
  if (meta.diagonalInches !== null) {
    if (meta.diagonalInches >= 7 && !meta.foldable) return 'tablet'
    return 'phone'
  }
  return 'unknown'
}

/** avdmanager list device 的单条定义（id/Name/OEM/Tag 四字段） */
export interface AvdDeviceEntry {
  id: string
  name: string
  oem: string | null
  tagId: string | null
}

/** avdmanager 条目缺屏幕数据，只能按 tag 归类 */
const classifyAvdEntry = (entry: AvdDeviceEntry): DeviceFormFactor =>
  entry.tagId === null
    ? 'unknown'
    : classifyFormFactor({ tagIds: [entry.tagId], diagonalInches: null, foldable: false })

const metaToProfile = (meta: RawProfileMeta, creatable: boolean): DeviceProfile => {
  const formFactor = classifyFormFactor({
    tagIds: meta.tagIds,
    diagonalInches: meta.screen.diagonalInches,
    foldable: meta.foldable
  })
  const round =
    formFactor === 'wear'
      ? /round|circle/i.test(meta.id)
        ? true
        : /square/i.test(meta.id)
          ? false
          : null
      : null
  return {
    id: meta.id,
    name: meta.name,
    manufacturer: meta.manufacturer,
    tagIds: meta.tagIds,
    formFactor,
    screen: { ...meta.screen, round },
    foldable: meta.foldable,
    apiMin: meta.apiMin,
    apiMax: meta.apiMax,
    playSupported: meta.playSupported,
    deprecated: false,
    hasFrontCamera: meta.hasFrontCamera,
    hasBackCamera: meta.hasBackCamera,
    ramMiB: meta.ramMiB,
    creatable
  }
}

const avdEntryToProfile = (entry: AvdDeviceEntry): DeviceProfile => ({
  id: entry.id,
  name: entry.name,
  manufacturer: entry.oem,
  tagIds: entry.tagId === null ? [] : [entry.tagId],
  formFactor: classifyAvdEntry(entry),
  screen: { widthPx: null, heightPx: null, diagonalInches: null, logicalDpi: null, round: null },
  foldable: false,
  apiMin: null,
  apiMax: null,
  playSupported: null,
  deprecated: false,
  hasFrontCamera: null,
  hasBackCamera: null,
  ramMiB: null,
  creatable: true
})

/**
 * 关联合并：XML 提供元数据、avdmanager 提供可创建性真值。
 * 双方都有 → 富元数据 + creatable；仅 XML → 富元数据 + 不可创建（展示已知信息）；
 * 仅 avdmanager → 按 OEM/Tag 推导的贫元数据（其余 null，不猜）。按名称排序。
 */
export const mergeProfiles = (
  avdEntries: AvdDeviceEntry[],
  metas: RawProfileMeta[]
): DeviceProfile[] => {
  const avdById = new Map(avdEntries.map((entry) => [entry.id, entry]))
  const profiles = new Map<string, DeviceProfile>()
  for (const meta of metas) {
    // XML 与 avdmanager 的 tag 互补（wear/tv 等只在 avdmanager 侧带 Tag），合并后再分类
    const avd = avdById.get(meta.id)
    const tagIds =
      avd?.tagId && !meta.tagIds.includes(avd.tagId) ? [...meta.tagIds, avd.tagId] : meta.tagIds
    profiles.set(meta.id, metaToProfile({ ...meta, tagIds }, avd !== undefined))
  }
  for (const entry of avdEntries) {
    if (!profiles.has(entry.id)) profiles.set(entry.id, avdEntryToProfile(entry))
  }
  return [...profiles.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))
}

/** 按源文件名补隐含形态 tag（纯函数，不改入参；通用文件或未登记名原样返回） */
export const withImpliedFormTag = (xmlName: string, metas: RawProfileMeta[]): RawProfileMeta[] => {
  const implied = DEVICE_XML_SOURCES.find((source) => source.name === xmlName)?.impliedFormTag
  if (implied === null || implied === undefined) return metas
  return metas.map((meta) =>
    meta.tagIds.includes(implied) ? meta : { ...meta, tagIds: [...meta.tagIds, implied] }
  )
}

/** 读取 sdklib JAR 内全部画像 XML；JAR 缺失/不可读返回空数组（降级为 avd-only 贫元数据） */
export const readJarProfileMetas = (jarPath: string): RawProfileMeta[] => {
  let zip: AdmZip
  try {
    zip = new AdmZip(jarPath)
  } catch {
    return []
  }
  const metas: RawProfileMeta[] = []
  for (const source of DEVICE_XML_SOURCES) {
    const entry = zip.getEntry(`com/android/sdklib/devices/${source.name}.xml`)
    if (entry === null) continue
    try {
      metas.push(
        ...withImpliedFormTag(source.name, parseDeviceXml(entry.getData().toString('utf8')))
      )
    } catch {
      // 单份损坏不拖垮其余文件
    }
  }
  return metas
}

/** JAR 指纹（mtime+size），画像缓存的失效键 */
export const jarFingerprint = async (jarPath: string): Promise<string> => {
  try {
    const info = await stat(jarPath)
    return `${info.size}-${info.mtimeMs}`
  } catch {
    return 'missing'
  }
}

/**
 * 外观索引（投屏外框消费）：profileId → phone/tablet/generic。分类走本模块
 * 单一规则（classifyFormFactor——外框 plan「不得维护两份分类规则」），非手机/
 * 平板形态与未命中一律 generic 兜底。JAR 缺失/解析失败收敛为空索引不抛
 * （readJarProfileMetas 全兜底）。签名沿用外框支原契（async + sdkRoot），
 * devices 域与既有测试 mock 不变。
 */
export interface FrameKindIndex {
  lookup: (profileId: string) => DeviceFrameKind
  entries: number
}

export const loadFrameKindIndex = async (
  sdkRoot: string,
  deps: { readMetas?: (jarPath: string) => RawProfileMeta[] } = {}
): Promise<FrameKindIndex> => {
  const readMetas = deps.readMetas ?? readJarProfileMetas
  const metas = readMetas(sdklibJarPathFor(sdkRoot))
  const index = new Map<string, DeviceFrameKind>()
  for (const meta of metas) {
    const form = classifyFormFactor({
      tagIds: meta.tagIds,
      diagonalInches: meta.screen.diagonalInches,
      foldable: meta.foldable
    })
    index.set(meta.id, form === 'phone' ? 'phone' : form === 'tablet' ? 'tablet' : 'generic')
  }
  return { lookup: (profileId) => index.get(profileId) ?? 'generic', entries: index.size }
}
