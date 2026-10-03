import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { ImageEntry, ImageVariant } from '@shared/types'

/**
 * 系统镜像清单：Google 公开 repository manifest（sys-img/<变体目录>/sys-img2-3.xml），
 * 只取 stable（channel-0）× arm64-v8a；已装状态以 SDK 根目录特征探测。
 * （sdkmanager --list 需要网络 + Java 且无体积字段，manifest 直读更快更省。）
 */

const MANIFEST_BASE = 'https://dl.google.com/android/repository/sys-img'

/** 应用类型 ImageVariant ↔ manifest/目录命名互转 */
export const VARIANT_DIRS: Record<ImageVariant, { manifest: string; tag: string }> = {
  aosp: { manifest: 'android', tag: 'default' },
  google_apis: { manifest: 'google_apis', tag: 'google_apis' },
  google_play: { manifest: 'google_apis_playstore', tag: 'google_apis_playstore' }
}

const VARIANTS: ImageVariant[] = ['aosp', 'google_apis', 'google_play']

/** API 版本窗口：清单只展示最近 N 个版本，防止列表无限膨胀 */
export const API_WINDOW = 5

interface RawManifestEntry {
  packageName: string
  apiLevel: number
  tag: string
  abi: string
  sizeBytes: number
  channel: number
}

/**
 * 解析 manifest XML 里的 sysImg 条目。Google 的 XML 结构稳定：
 * remotePackage[path] > type-details(sysImgDetailsType){api-level,tag.id,abi} + archives>archive>complete{size} + channelRef
 */
export const parseSysImgManifest = (xml: string, variant: ImageVariant): RawManifestEntry[] => {
  const entries: RawManifestEntry[] = []
  const packageBlocks = xml.matchAll(/<remotePackage path="([^"]+)">([\s\S]*?)<\/remotePackage>/g)
  for (const block of packageBlocks) {
    const packageName = block[1]
    const body = block[2]
    if (!packageName.startsWith('system-images;')) continue
    const apiLevel = Number(body.match(/<api-level>(\d+)<\/api-level>/)?.[1])
    const tag = body.match(/<tag>\s*<id>([^<]+)<\/id>/)?.[1]
    const abi = body.match(/<abi>([^<]+)<\/abi>/)?.[1]
    const sizeBytes = Number(body.match(/<complete>\s*<size>(\d+)<\/size>/)?.[1])
    const channel = Number(body.match(/<channelRef ref="channel-(\d+)"/)?.[1] ?? '0')
    if (!Number.isInteger(apiLevel) || !tag || !abi || !Number.isInteger(sizeBytes)) continue
    if (tag !== VARIANT_DIRS[variant].tag) continue
    entries.push({ packageName, apiLevel, tag, abi, sizeBytes, channel })
  }
  return entries
}

export interface ImageCatalogDeps {
  fetcher?: (url: string) => Promise<string>
}

/** 拉取并解析三份 manifest → 未装配状态的镜像目录（API 降序 × 变体固定序） */
export async function fetchImageCatalog(deps: ImageCatalogDeps = {}): Promise<ImageEntry[]> {
  const fetcher =
    deps.fetcher ??
    (async (url: string): Promise<string> => {
      const response = await fetch(url)
      if (!response.ok) throw new Error(`镜像清单拉取失败：HTTP ${response.status}（${url}）`)
      return response.text()
    })

  const raw = await Promise.all(
    VARIANTS.map(async (variant) => {
      const xml = await fetcher(`${MANIFEST_BASE}/${VARIANT_DIRS[variant].manifest}/sys-img2-3.xml`)
      return parseSysImgManifest(xml, variant)
    })
  )
  const flat = raw.flat().filter((entry) => entry.channel === 0 && entry.abi === 'arm64-v8a')

  // API 窗口：只保留最近 N 个版本
  const apiLevels = [...new Set(flat.map((entry) => entry.apiLevel))].sort((a, b) => b - a)
  const window = new Set(apiLevels.slice(0, API_WINDOW))

  return flat
    .filter((entry) => window.has(entry.apiLevel))
    .map((entry) => ({
      packageName: entry.packageName,
      apiLevel: entry.apiLevel,
      variant: VARIANTS.find((name) => VARIANT_DIRS[name].tag === entry.tag) as ImageVariant,
      abi: 'arm64-v8a' as const,
      installed: false,
      sizeBytes: entry.sizeBytes
    }))
    .sort(
      (a, b) => b.apiLevel - a.apiLevel || VARIANTS.indexOf(a.variant) - VARIANTS.indexOf(b.variant)
    )
}

/** 已装探测：<sdkRoot>/system-images/android-<api>/<tag 目录>/arm64-v8a 存在且非空 */
export const isImageInstalled = async (sdkRoot: string, entry: ImageEntry): Promise<boolean> => {
  const dir = join(
    sdkRoot,
    'system-images',
    `android-${entry.apiLevel}`,
    VARIANT_DIRS[entry.variant].tag,
    'arm64-v8a'
  )
  try {
    const files = await readdir(dir)
    return files.length > 0
  } catch {
    return false
  }
}

/** 给目录打已装标记（SDK 根就绪后调用） */
export async function markInstalled(sdkRoot: string, entries: ImageEntry[]): Promise<void> {
  for (const entry of entries) {
    entry.installed = await isImageInstalled(sdkRoot, entry)
  }
}

/** 组合：manifest 目录 + 已装标记（devices 域与向导共用） */
export async function listImagesWithState(
  sdkRoot: string,
  deps: ImageCatalogDeps = {}
): Promise<ImageEntry[]> {
  const entries = await fetchImageCatalog(deps)
  await markInstalled(sdkRoot, entries)
  return entries
}

/** 由 apiLevel × variant 反推包名（创建时校验镜像已装用） */
export const packageNameFor = (apiLevel: number, variant: ImageVariant): string =>
  `system-images;android-${apiLevel};${VARIANT_DIRS[variant].tag};arm64-v8a`

/** 按包名直接探测已装状态（devices 创建守卫用，免拉 manifest） */
export const isPackageNameInstalled = async (
  sdkRoot: string,
  packageName: string
): Promise<boolean> => {
  const [, api, tag, abi] = packageName.split(';')
  if (!api || !tag || !abi) return false
  try {
    const files = await readdir(join(sdkRoot, 'system-images', api, tag, abi))
    return files.length > 0
  } catch {
    return false
  }
}
