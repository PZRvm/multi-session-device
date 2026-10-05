import { readFile as fsReadFile, stat } from 'node:fs/promises'
import { inflateRawSync } from 'node:zlib'
import { join } from 'node:path'
import type { DeviceFrameKind } from '@shared/types'

/**
 * SDK 画像元数据 → 设备外观类别（phone/tablet）。
 *
 * 数据源是 cmdline-tools JAR 内 com/android/sdklib/devices/{devices,nexus}.xml——
 * avdmanager list device 的无标签来源（automotive/tv/wear/desktop/xr 各文件带标签，
 * profiles.ts 已过滤，此处同样不读）。JAR 即 ZIP：EOCD → 中央目录 → 本地头定位
 * 条目，deflate 用 node:zlib 原生解，不引依赖、不起子进程。
 *
 * 判型（plan 2026-10-05-device-frame-and-canvas）：折叠设备（foldable-region /
 * change-orientation-on-fold）一律手机；非折叠且物理对角线 ≥7 英寸为平板；其余
 * 手机；对角线缺失不入表（按 generic 兜底）。不按名称含 Tablet 或视频分辨率猜。
 */

/** 平板最小物理对角线（英寸） */
export const TABLET_MIN_DIAGONAL = 7

export interface DeviceEntryHint {
  /** avdmanager 的画像 id：XML `<id>` 缺席时用 `<name>`（与 avdmanager 行为一致） */
  key: string
  diagonalInches: number | null
  foldable: boolean
}

const EOCD_SIGNATURE = 0x06054b50
const CENTRAL_SIGNATURE = 0x02014b50
const LOCAL_SIGNATURE = 0x04034b50

/** 读 ZIP 单个条目；条目不存在或 JAR 结构异常返回 null（ EOCD 只扫尾部 64KB，注释超长属异常档案） */
export function readZipEntry(archive: Buffer, entryName: string): Buffer | null {
  const scanStart = Math.max(0, archive.length - 65_536)
  let eocd = -1
  for (let i = archive.length - 22; i >= scanStart; i -= 1) {
    if (archive.readUInt32LE(i) === EOCD_SIGNATURE) {
      eocd = i
      break
    }
  }
  if (eocd < 0) return null
  const entryCount = archive.readUInt16LE(eocd + 10)
  let offset = archive.readUInt32LE(eocd + 16)
  for (let entry = 0; entry < entryCount; entry += 1) {
    if (offset + 46 > archive.length || archive.readUInt32LE(offset) !== CENTRAL_SIGNATURE) {
      return null
    }
    const method = archive.readUInt16LE(offset + 10)
    const compressedSize = archive.readUInt32LE(offset + 20)
    const nameLength = archive.readUInt16LE(offset + 28)
    const extraLength = archive.readUInt16LE(offset + 30)
    const commentLength = archive.readUInt16LE(offset + 32)
    const localOffset = archive.readUInt32LE(offset + 42)
    const name = archive.subarray(offset + 46, offset + 46 + nameLength).toString('utf8')
    if (name === entryName) {
      if (
        localOffset + 30 > archive.length ||
        archive.readUInt32LE(localOffset) !== LOCAL_SIGNATURE
      ) {
        return null
      }
      // 数据偏移以本地头自身的 name/extra 长度为准（中央目录的 extra 可能不同步）
      const localNameLength = archive.readUInt16LE(localOffset + 26)
      const localExtraLength = archive.readUInt16LE(localOffset + 28)
      const dataStart = localOffset + 30 + localNameLength + localExtraLength
      const data = archive.subarray(dataStart, dataStart + compressedSize)
      if (method === 0) return data
      if (method === 8) {
        try {
          return inflateRawSync(data)
        } catch {
          return null
        }
      }
      return null
    }
    offset += 46 + nameLength + extraLength + commentLength
  }
  return null
}

/** `<d:device>` 块（命名空间前缀任意、开闭同前缀；组 2 含冒号，闭合标签按它回引）；捕获组 3 为块体 */
const DEVICE_BLOCK = /<(([\w.-]+:)?device(?:\s[^>]*)?>)([\s\S]*?)<\/\2?device>/g

/** 取子元素文本（localName 为代码内常量，无需转义） */
const tagText = (block: string, localName: string): string | null => {
  const match = block.match(new RegExp(`<(?:[\\w.-]+:)?${localName}(?:\\s[^>]*)?>([^<]*)<`))
  return match ? match[1].trim() : null
}

/** 子元素是否存在（只认元素名，`<d:skin>pixel_fold</d:skin>` 这类内容含 fold 不误判） */
const hasElement = (block: string, localName: string): boolean =>
  new RegExp(`<(?:[\\w.-]+:)?${localName}[\\s/>]`).test(block)

export function parseDeviceFrameXml(xml: string): DeviceEntryHint[] {
  const hints: DeviceEntryHint[] = []
  for (const match of xml.matchAll(DEVICE_BLOCK)) {
    const block = match[3]
    const key = (tagText(block, 'id') ?? tagText(block, 'name') ?? '').trim()
    if (!key) continue
    const diagonalText = tagText(block, 'diagonal-length')
    const diagonal = diagonalText === null ? NaN : Number.parseFloat(diagonalText)
    hints.push({
      key,
      diagonalInches: Number.isFinite(diagonal) ? diagonal : null,
      foldable:
        hasElement(block, 'foldable-region') || hasElement(block, 'change-orientation-on-fold')
    })
  }
  return hints
}

/** 判型纯函数：折叠 → 手机；对角线缺失 → null（generic 兜底） */
export function classifyFrameKind(hint: DeviceEntryHint): DeviceFrameKind | null {
  if (hint.foldable) return 'phone'
  if (hint.diagonalInches === null) return null
  return hint.diagonalInches >= TABLET_MIN_DIAGONAL ? 'tablet' : 'phone'
}

export interface FrameKindIndex {
  lookup(profileId: string): DeviceFrameKind
  /** 已判型条目数（诊断用：0 = SDK 缺失或解析失败） */
  readonly entries: number
}

export interface ProfileMetadataDeps {
  statFile?: (path: string) => Promise<{ mtimeMs: number; size: number } | null>
  readFile?: (path: string) => Promise<Buffer>
}

const DEVICE_XML_ENTRIES = [
  'com/android/sdklib/devices/devices.xml',
  'com/android/sdklib/devices/nexus.xml'
] as const

/** 候选 JAR 按优先级排列；首个含目标 XML 的生效（重复条目同值，后读不冲突） */
export const sdklibJarCandidates = (sdkRoot: string): string[] => [
  join(sdkRoot, 'cmdline-tools', 'latest', 'lib', 'sdklib', 'sdklib.core.jar'),
  join(sdkRoot, 'cmdline-tools', 'latest', 'lib', 'sdklib', 'tools.sdklib.jar')
]

const defaultStatFile = async (path: string): Promise<{ mtimeMs: number; size: number } | null> => {
  try {
    const info = await stat(path)
    return { mtimeMs: info.mtimeMs, size: info.size }
  } catch {
    return null
  }
}

const defaultReadFile = (path: string): Promise<Buffer> => fsReadFile(path)

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

// 模块级缓存：key 为候选 JAR 的 mtime+size 快照，SDK 更新（JAR 被替换）自动失效
let cached: { key: string; index: FrameKindIndex } | null = null

/**
 * 载入画像外观索引。任何失败（SDK 缺失、JAR 损坏、XML 不识别）都收敛为空索引——
 * 外观提示绝不阻塞启停/投屏；错误打日志可诊断。
 */
export async function loadFrameKindIndex(
  sdkRoot: string,
  deps: ProfileMetadataDeps = {}
): Promise<FrameKindIndex> {
  const statFile = deps.statFile ?? defaultStatFile
  const readFile = deps.readFile ?? defaultReadFile
  const jars = sdklibJarCandidates(sdkRoot)
  const stats = await Promise.all(jars.map((jar) => statFile(jar)))
  const key = JSON.stringify(stats.map((info) => (info ? [info.mtimeMs, info.size] : null)))
  if (cached && cached.key === key) return cached.index

  const kinds = new Map<string, DeviceFrameKind>()
  for (const [index, jar] of jars.entries()) {
    if (!stats[index]) continue
    try {
      const archive = await readFile(jar)
      for (const entry of DEVICE_XML_ENTRIES) {
        const xml = readZipEntry(archive, entry)?.toString('utf8')
        if (!xml) continue
        for (const hint of parseDeviceFrameXml(xml)) {
          const kind = classifyFrameKind(hint)
          if (kind) kinds.set(hint.key, kind)
        }
      }
    } catch (error) {
      console.log(`[profile-metadata] 画像元数据读取失败（${jar}）：${messageOf(error)}`)
    }
  }
  const index: FrameKindIndex = {
    lookup: (profileId) => kinds.get(profileId) ?? 'generic',
    entries: kinds.size
  }
  cached = { key, index }
  return index
}
