import { readdir, stat } from 'node:fs/promises'
import { netFetch } from './netFetch'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { XMLParser } from 'fast-xml-parser'
import type {
  ImageApiVersion,
  ImageCatalogResult,
  ImageEntry,
  ImageRevision,
  ImageService
} from '@shared/types'
import { hostImageAbi } from '@shared/compatibility'
import { msg } from '../locale'

/**
 * 系统镜像目录：六个官方 sys-img manifest（结构化解析）+ 本地 package.xml /
 * source.properties 核验合并。packageName 是唯一身份键——API 小版本（36.1）、
 * 扩展平台（35x=ext15）、16KB（ps16k）、Preview（canary）互不混淆。
 * 数据源实证见 `__tests__/fixtures/`（manifests/ + system-images/）。
 */

const MANIFEST_BASE = 'https://dl.google.com/android/repository/sys-img'

/** 官方 sys-img manifest 源（2026-10 实测存在；wear/tv/automotive 独立成源） */
export const MANIFEST_SOURCES = [
  'android',
  'google_apis',
  'google_apis_playstore',
  'android-wear',
  'android-tv',
  'android-automotive'
] as const

export type ManifestSource = (typeof MANIFEST_SOURCES)[number]

/** type-details tag id → 服务类别；未列出的进 featureTags */
const TAG_SERVICES: Record<string, ImageService> = {
  default: 'aosp',
  google_apis: 'google_apis',
  google_apis_playstore: 'google_play',
  'android-wear': 'wear',
  'android-tv': 'tv',
  'android-automotive': 'automotive'
}

const SERVICE_ORDER: ImageService[] = [
  'google_play',
  'google_apis',
  'aosp',
  'wear',
  'tv',
  'automotive'
]

const parser = new XMLParser({
  ignoreDeclaration: true,
  removeNSPrefix: true,
  // v5 起默认忽略属性——包身份（@_path）与版本（@_ref）都在属性上，必须显式开启
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

const intOrNull = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isInteger(parsed)) return parsed
  }
  return null
}

/**
 * api-level 文本 → 结构化版本。"36"→36；"36.1"→36.1；
 * "35x"→android-35-ext15 的扩展平台（major 35，minor null，靠 platformSegment 区分）。
 */
export const parseApiVersion = (
  apiLevelText: string | null
): { major: number | null; minor: number | null } => {
  const dot = apiLevelText?.match(/^(\d+)\.(\d+)$/)
  if (dot) return { major: Number(dot[1]), minor: Number(dot[2]) }
  const plain = apiLevelText?.match(/^(\d+)$/)
  if (plain) return { major: Number(plain[1]), minor: null }
  const ext = apiLevelText?.match(/^(\d+)x$/)
  if (ext) return { major: Number(ext[1]), minor: null }
  return { major: null, minor: null }
}

/** tag id 列表 → 服务类别 + 特征标签 */
export const classifyTags = (
  tagIds: string[]
): { services: ImageService[]; featureTags: string[] } => {
  const services: ImageService[] = []
  const featureTags: string[] = []
  for (const tagId of tagIds) {
    const service = TAG_SERVICES[tagId]
    if (service !== undefined && !services.includes(service)) services.push(service)
    else if (service === undefined) featureTags.push(tagId)
  }
  services.sort((a, b) => SERVICE_ORDER.indexOf(a) - SERVICE_ORDER.indexOf(b))
  return { services, featureTags }
}

const parseRevision = (node: unknown): ImageRevision | null => {
  const record = node as Record<string, unknown> | undefined
  const major = intOrNull(record?.major)
  if (major === null) return null
  return { major, minor: intOrNull(record?.minor), micro: intOrNull(record?.micro) }
}

/** 包名四段拆解：system-images;<平台>;<tag 目录段>;<abi> */
export const splitPackageName = (
  packageName: string
): { platformSegment: string; tagSegment: string; abi: string } | null => {
  const parts = packageName.split(';')
  if (parts.length !== 4 || parts[0] !== 'system-images') return null
  const [, platformSegment, tagSegment, abi] = parts
  if (!platformSegment || !tagSegment || !abi) return null
  return { platformSegment, tagSegment, abi }
}

interface RawRemotePackage {
  packageName: string
  displayName: string | null
  apiLevelText: string | null
  codename: string | null
  extensionLevel: number | null
  baseExtension: boolean | null
  tagIds: string[]
  abi: string
  channel: number | null
  revision: ImageRevision | null
  sizeBytes: number | null
  /** zip 相对路径（相对 sys-img/<source>/；无 archive 时 null） */
  zipUrl: string | null
  zipSha1: string | null
}

/** 解析一份 sys-img manifest（namespace 变体由 removeNSPrefix 吸收） */
export const parseSysImgManifest = (xml: string): RawRemotePackage[] => {
  let parsed: unknown
  try {
    parsed = parser.parse(xml)
  } catch {
    return []
  }
  const repository = (parsed as Record<string, unknown>)?.['sdk-sys-img'] as
    Record<string, unknown> | undefined
  const packages: RawRemotePackage[] = []
  for (const pkg of toArray<Record<string, unknown>>(repository?.remotePackage)) {
    const packageName = text(pkg['@_path'])
    if (packageName === null || !packageName.startsWith('system-images;')) continue
    const details = pkg['type-details'] as Record<string, unknown> | undefined
    const tagIds = toArray<Record<string, unknown>>(details?.tag)
      .map((tag) => text(tag.id))
      .filter((id): id is string => id !== null)
    const abi = text(details?.abi)
    if (abi === null) continue
    const archives = (pkg.archives as Record<string, unknown> | undefined)?.archive
    const firstArchive = toArray<Record<string, unknown>>(archives)[0]
    const complete = firstArchive?.complete as Record<string, unknown> | undefined
    const sizeNode = complete?.size
    // checksum 节点带 type 属性：fast-xml-parser 可能为 { '@_type': 'sha1', '#text': 值 }
    const checksumNode = complete?.checksum
    const checksumText =
      typeof checksumNode === 'string'
        ? checksumNode
        : text((checksumNode as Record<string, unknown> | undefined)?.['#text'])
    packages.push({
      packageName,
      displayName: text(pkg['display-name']),
      apiLevelText: text(details?.['api-level']),
      codename: text(details?.codename),
      extensionLevel: intOrNull(details?.['extension-level']),
      baseExtension:
        typeof details?.['base-extension'] === 'string'
          ? details['base-extension'] === 'true'
          : details?.['base-extension'] === true
            ? true
            : null,
      tagIds,
      abi,
      channel: intOrNull(
        (pkg.channelRef as Record<string, unknown> | undefined)?.['@_ref']
          ?.toString()
          .match(/channel-(\d+)/)?.[1]
      ),
      revision: parseRevision(pkg.revision),
      sizeBytes: intOrNull(sizeNode),
      zipUrl: text(complete?.url),
      zipSha1: checksumText
    })
  }
  return packages
}

const remotePackageToEntry = (pkg: RawRemotePackage): ImageEntry => {
  const parts = splitPackageName(pkg.packageName)
  const platformSegment = parts?.platformSegment ?? ''
  const { major, minor } = parseApiVersion(pkg.apiLevelText)
  const { services, featureTags } = classifyTags(pkg.tagIds)
  return {
    packageName: pkg.packageName,
    displayName: pkg.displayName ?? pkg.packageName,
    api: {
      platformSegment,
      major,
      minor,
      codename: pkg.codename,
      extensionLevel: pkg.extensionLevel,
      baseExtension: pkg.baseExtension
    },
    services,
    featureTags,
    tagIds: pkg.tagIds,
    abi: pkg.abi,
    channel: pkg.channel,
    revision: pkg.revision,
    sizeBytes: pkg.sizeBytes,
    // 相对 url 由 fetchImageCatalog 按 manifest 源拼绝对地址
    zipUrl: pkg.zipUrl,
    zipSha1: pkg.zipSha1,
    installed: false,
    source: 'remote+local'
  }
}

/** 结构化 API 降序比较（major → minor → extensionLevel → 平台段字典序兜底） */
export const compareApiVersions = (a: ImageApiVersion, b: ImageApiVersion): number => {
  if (a.major !== b.major) return (b.major ?? -1) - (a.major ?? -1)
  if (a.minor !== b.minor) return (b.minor ?? -1) - (a.minor ?? -1)
  if (a.extensionLevel !== b.extensionLevel)
    return (b.extensionLevel ?? -1) - (a.extensionLevel ?? -1)
  return b.platformSegment.localeCompare(a.platformSegment)
}

export interface LocalImageRecord {
  packageName: string
  displayName: string | null
  apiLevelText: string | null
  extensionLevel: number | null
  tagIds: string[]
  abi: string
  revision: ImageRevision | null
  /** 安装核验：package.xml + source.properties + system.img 全部通过 */
  verified: boolean
}

const readLocalPackageXml = (xml: string): LocalImageRecord | null => {
  let parsed: unknown
  try {
    parsed = parser.parse(xml)
  } catch {
    return null
  }
  const repository = (parsed as Record<string, unknown>)?.repository as
    Record<string, unknown> | undefined
  const local = repository?.localPackage as Record<string, unknown> | undefined
  const packageName = text(local?.['@_path'])
  const parts = packageName === null ? null : splitPackageName(packageName)
  if (parts === null || packageName === null) return null
  const details = local?.['type-details'] as Record<string, unknown> | undefined
  const tagIds = toArray<Record<string, unknown>>(details?.tag)
    .map((tag) => text(tag.id))
    .filter((id): id is string => id !== null)
  return {
    packageName,
    displayName: text(local?.['display-name']),
    apiLevelText: text(details?.['api-level']),
    extensionLevel: intOrNull(details?.['extension-level']),
    tagIds,
    abi: parts.abi,
    revision: parseRevision(local?.revision),
    verified: false
  }
}

export interface LocalScanDeps {
  readdir?: (dir: string) => Promise<string[]>
  readFile?: (path: string) => Promise<string>
  exists?: (path: string) => Promise<boolean>
}

const defaultDeps: Required<LocalScanDeps> = {
  readdir: (dir) => readdir(dir),
  readFile: (path) => readFile(path, 'utf8'),
  exists: async (path) => {
    try {
      await stat(path)
      return true
    } catch {
      return false
    }
  }
}

/**
 * 扫描本地 system-images 目录并逐包核验安装完整性：
 * package.xml 可解析且身份匹配 + system.img 存在；半安装/空目录不算 installed。
 */
export const scanLocalImages = async (
  sdkRoot: string,
  deps: LocalScanDeps = {}
): Promise<Map<string, LocalImageRecord>> => {
  const d = { ...defaultDeps, ...deps }
  const result = new Map<string, LocalImageRecord>()
  const root = join(sdkRoot, 'system-images')
  let platforms: string[]
  try {
    platforms = await d.readdir(root)
  } catch {
    return result
  }
  // 点前缀目录/文件是下载器的临时物与备份（.install-bak/.unzipping 等），
  // 不属于清单语义——含 package.xml 也不读（review P2 修复）
  const visible = (names: string[]): string[] => names.filter((name) => !name.startsWith('.'))
  const listDir = async (dir: string): Promise<string[]> => {
    try {
      return visible(await d.readdir(dir))
    } catch {
      return []
    }
  }
  for (const platform of visible(platforms)) {
    const tagDirs = await listDir(join(root, platform))
    for (const tagDir of tagDirs) {
      const abis = await listDir(join(root, platform, tagDir))
      for (const abi of abis) {
        const dir = join(root, platform, tagDir, abi)
        try {
          const record = readLocalPackageXml(await d.readFile(join(dir, 'package.xml')))
          if (record === null) continue
          const hasSystemImage = await d.exists(join(dir, 'system.img'))
          const hasSourceProps = await d.exists(join(dir, 'source.properties'))
          record.verified = hasSystemImage && hasSourceProps
          if (!result.has(record.packageName)) result.set(record.packageName, record)
        } catch {
          // 单目录损坏不拖垮整体扫描
        }
      }
    }
  }
  return result
}

/** 单镜像核验的故障归因（对账用）：缺失/权限/身份矛盾分开，不降格为布尔 */
export type LocalImageFault =
  | 'missing-dir'
  | 'unreadable-dir'
  | 'missing-package-xml'
  | 'unreadable-package-xml'
  | 'invalid-package-xml'
  | 'symlinked-file'
  | 'identity-mismatch'
  | 'missing-source-properties'
  | 'missing-system-img'

export interface LocalImageCheck {
  /** package.xml 可解析时的实际身份；fault 为 null 时必有值 */
  packageName: string | null
  /** package.xml 声明的 ABI（身份段拆解；解析失败为 null） */
  abi: string | null
  fault: LocalImageFault | null
  faultMessage: string | null
}

const errnoOf = (error: unknown): string | null =>
  typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : null

/** 单包核验的 package.xml 读取上限（不可信输入，防内存放大；review P3） */
const MAX_PACKAGE_XML_BYTES = 256 * 1024

/**
 * 带诊断的单包核验（plan 2026-10-05-avd-reconciliation 设计 4）：按目录核验
 * package.xml 身份、source.properties 与 system.img。与 scanLocalImages 的布尔
 * verified 不同——缺失/权限/损坏分开归因，供 AVD 健康检查区分「镜像没了」和
 * 「读不了」。只读这三个受检文件（symlink 一律按故障上报，不追随目标），
 * 不读镜像内容、不拉远端清单。
 */
export const checkLocalImage = async (
  imageDir: string,
  dirIdentity: { platformSegment: string; tagSegment: string; abi: string } | null,
  deps: LocalScanDeps & {
    lstat?: (path: string) => Promise<{ isSymbolicLink(): boolean; size?: number }>
  } = {}
): Promise<LocalImageCheck> => {
  const d = { ...defaultDeps, ...deps }
  try {
    await d.readdir(imageDir)
  } catch (error) {
    const errno = errnoOf(error)
    return errno === 'ENOENT'
      ? {
          packageName: null,
          abi: null,
          fault: 'missing-dir',
          faultMessage: msg('catDirMissing', { dir: imageDir })
        }
      : {
          packageName: null,
          abi: null,
          fault: 'unreadable-dir',
          faultMessage: msg('catDirUnreadable', {
            errno: errno ?? msg('unknownError'),
            dir: imageDir
          })
        }
  }
  // 受检文件不追随 symlink（目标可能逃出 SDK 根）
  if (d.lstat !== undefined) {
    for (const name of ['package.xml', 'source.properties', 'system.img']) {
      try {
        const info = await d.lstat(join(imageDir, name))
        if (info.isSymbolicLink()) {
          return {
            packageName: null,
            abi: null,
            fault: 'symlinked-file',
            faultMessage: msg('catFileIsSymlink', { name })
          }
        }
        // package.xml 是不可信输入，读取前量尺寸（review P3：无界读取 → 内存放大）
        if (
          name === 'package.xml' &&
          typeof info.size === 'number' &&
          info.size > MAX_PACKAGE_XML_BYTES
        ) {
          return {
            packageName: null,
            abi: null,
            fault: 'invalid-package-xml',
            faultMessage: msg('catPackageXmlTooLarge', { max: MAX_PACKAGE_XML_BYTES / 1024 })
          }
        }
      } catch {
        // lstat 失败交给后续存在性检查归因
      }
    }
  }
  let xml: string
  try {
    xml = await d.readFile(join(imageDir, 'package.xml'))
  } catch (error) {
    const errno = errnoOf(error)
    return {
      packageName: null,
      abi: null,
      fault: errno === 'ENOENT' ? 'missing-package-xml' : 'unreadable-package-xml',
      faultMessage:
        errno === 'ENOENT'
          ? msg('catMissingPackageXml', { dir: imageDir })
          : msg('catPackageXmlUnreadable', { errno: errno ?? msg('unknownError'), dir: imageDir })
    }
  }
  // 尺寸预检后仍可能被换大（TOCTOU）：读后再核一次长度
  if (xml.length > MAX_PACKAGE_XML_BYTES) {
    return {
      packageName: null,
      abi: null,
      fault: 'invalid-package-xml',
      faultMessage: msg('catPackageXmlTooLarge', { max: MAX_PACKAGE_XML_BYTES / 1024 })
    }
  }
  const record = readLocalPackageXml(xml)
  if (record === null) {
    return {
      packageName: null,
      abi: null,
      fault: 'invalid-package-xml',
      faultMessage: msg('catPackageXmlNoIdentity', { dir: imageDir })
    }
  }
  if (dirIdentity !== null) {
    const expected = `system-images;${dirIdentity.platformSegment};${dirIdentity.tagSegment};${dirIdentity.abi}`
    if (record.packageName !== expected) {
      return {
        packageName: record.packageName,
        abi: record.abi,
        fault: 'identity-mismatch',
        faultMessage: msg('catIdentityMismatch', { record: record.packageName, expected })
      }
    }
  }
  if (!(await d.exists(join(imageDir, 'source.properties')))) {
    return {
      packageName: record.packageName,
      abi: record.abi,
      fault: 'missing-source-properties',
      faultMessage: msg('catMissingSourceProps', { dir: imageDir })
    }
  }
  if (!(await d.exists(join(imageDir, 'system.img')))) {
    return {
      packageName: record.packageName,
      abi: record.abi,
      fault: 'missing-system-img',
      faultMessage: msg('catMissingSystemImg', { dir: imageDir })
    }
  }
  return { packageName: record.packageName, abi: record.abi, fault: null, faultMessage: null }
}

const localRecordToEntry = (record: LocalImageRecord): ImageEntry => {
  const parts = splitPackageName(record.packageName)
  const platformSegment = parts?.platformSegment ?? ''
  const { major, minor } = parseApiVersion(record.apiLevelText)
  const { services, featureTags } = classifyTags(record.tagIds)
  return {
    packageName: record.packageName,
    displayName: record.displayName ?? record.packageName,
    api: {
      platformSegment,
      major,
      minor,
      codename: null,
      extensionLevel: record.extensionLevel,
      baseExtension: null
    },
    services,
    featureTags,
    tagIds: record.tagIds,
    abi: record.abi,
    channel: null,
    revision: record.revision,
    sizeBytes: null,
    zipUrl: null,
    zipSha1: null,
    installed: record.verified,
    source: 'local-only'
  }
}

export interface ImageCatalogDeps extends LocalScanDeps {
  fetcher?: (url: string) => Promise<string>
  /** 平台接缝（默认 process.platform）：win32 下目录按宿主 ABI 过滤（plan 2026-10-22-windows-emulator-env 设计 1） */
  platform?: NodeJS.Platform
}

/** win32 目录过滤：合并结果只留宿主 ABI 镜像（x86_64）；其余平台原样返回。
 *  过滤在 mergeCatalog 之后单点做——同时覆盖远端 manifest 与本地扫描两个来源；
 *  scanLocalImages 本体不过滤（磁盘事实扫描器），政策留在目录装配与创建守卫两道口。 */
const filterByHostAbi = (images: ImageEntry[], platform: NodeJS.Platform): ImageEntry[] =>
  platform === 'win32' ? images.filter((entry) => entry.abi === hostImageAbi(platform)) : images

/** 合并远端与本地：同包身份只保留一条，安装状态取本地核验，本地独有条目补齐 */
export const mergeCatalog = (
  remote: ImageEntry[],
  local: Map<string, LocalImageRecord>
): ImageEntry[] => {
  const merged = new Map<string, ImageEntry>()
  for (const entry of remote) {
    merged.set(entry.packageName, entry)
  }
  for (const [packageName, record] of local) {
    const remoteEntry = merged.get(packageName)
    if (remoteEntry === undefined) {
      merged.set(packageName, localRecordToEntry(record))
    } else {
      remoteEntry.installed = record.verified
    }
  }
  return [...merged.values()].sort(
    (a, b) =>
      compareApiVersions(a.api, b.api) ||
      b.services.length - a.services.length ||
      a.abi.localeCompare(b.abi) ||
      a.packageName.localeCompare(b.packageName)
  )
}

/** 拉取六源 manifest + 本地核验合并；部分源失败保留其余并给警告。
 *  localOnly（共享只读态，plan 2026-10-12）：跳过远程目录只做本地核验——离线可用。 */
export async function fetchImageCatalog(
  sdkRoot: string,
  deps: ImageCatalogDeps = {},
  options: { localOnly?: boolean } = {}
): Promise<ImageCatalogResult> {
  if (options.localOnly === true) {
    const local = await scanLocalImages(sdkRoot, deps)
    return {
      images: filterByHostAbi(mergeCatalog([], local), deps.platform ?? process.platform),
      sourceWarnings: [],
      offline: false,
      fetchedAt: Date.now(),
      activeDownload: null,
      activeUninstall: null
    }
  }
  const fetcher =
    deps.fetcher ??
    (async (url: string): Promise<string> => {
      // netFetch：manifest 拉取走系统代理（issue 2026-10-09）
      const response = await netFetch(url)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return response.text()
    })

  const settled = await Promise.allSettled(
    MANIFEST_SOURCES.map(async (source) => {
      const xml = await fetcher(`${MANIFEST_BASE}/${source}/sys-img2-3.xml`)
      return parseSysImgManifest(xml).map((pkg) => {
        const entry = remotePackageToEntry(pkg)
        // manifest url 是相对路径，基址即该源 manifest 所在目录（实测 200，见 plan 排查记录）
        if (pkg.zipUrl !== null) entry.zipUrl = `${MANIFEST_BASE}/${source}/${pkg.zipUrl}`
        return entry
      })
    })
  )

  const images: ImageEntry[] = []
  const sourceWarnings: string[] = []
  for (let i = 0; i < settled.length; i++) {
    const outcome = settled[i]
    if (outcome.status === 'fulfilled') images.push(...outcome.value)
    else {
      const reason =
        outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason)
      sourceWarnings.push(`${MANIFEST_SOURCES[i]}：${reason}`)
    }
  }

  const local = await scanLocalImages(sdkRoot, deps)
  const merged = filterByHostAbi(mergeCatalog(images, local), deps.platform ?? process.platform)

  return {
    images: merged,
    sourceWarnings,
    offline: settled.every((outcome) => outcome.status === 'rejected'),
    fetchedAt: Date.now(),
    // 实时下载/卸载任务由 IPC 层（sdk:images handler）按当前状态合并，清单本体恒 null
    activeDownload: null,
    activeUninstall: null
  }
}

/** 组合入口（devices 域与向导共用）：保留旧名，语义为 fetchImageCatalog */
export async function listImagesWithState(
  sdkRoot: string,
  deps: ImageCatalogDeps = {},
  options: { localOnly?: boolean } = {}
): Promise<ImageCatalogResult> {
  return fetchImageCatalog(sdkRoot, deps, options)
}

/** 按包名核验完整安装（创建守卫用，免拉 manifest） */
export const isPackageNameInstalled = async (
  sdkRoot: string,
  packageName: string,
  deps: LocalScanDeps = {}
): Promise<boolean> => {
  const parts = splitPackageName(packageName)
  if (parts === null) return false
  const local = await scanLocalImages(sdkRoot, deps)
  return local.get(packageName)?.verified === true
}
