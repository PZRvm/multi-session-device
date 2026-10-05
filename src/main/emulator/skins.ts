import { execFileSync } from 'node:child_process'
import { readFile, readdir, mkdir, cp, rm, stat, writeFile } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import AdmZip from 'adm-zip'

/**
 * 机型皮肤域（plan 设计 6）：SDK 已装皮肤扫描、layout 解析、本地导入与
 * 受控下载（源与许可见 fixtures README 的批次 7 记录）。
 * 投屏几何（frameRect/screenRect 渲染与输入）依赖通用外框计划的几何基础，
 * 此处解析并保存完整结构，显示接入随姊妹计划落地。
 */

/** 单方向的屏幕矩形与整框尺寸（CSS 无关的原始像素） */
export interface SkinOrientation {
  frameWidth: number
  frameHeight: number
  /** 屏幕在整框内的偏移（portrait 无旋转的可靠情形；landscape 旋转待显示接入换算） */
  screenX: number | null
  screenY: number | null
  screenWidth: number
  screenHeight: number
  /** 部件旋转（landscape 常见 rotation 90） */
  rotation: number | null
}

export interface SkinLayout {
  portrait: SkinOrientation | null
  landscape: SkinOrientation | null
  /** 引用的素材文件（相对皮肤目录），导入核验用 */
  imageAssets: string[]
}

export interface SkinRecord {
  /** 皮肤 id：SDK 皮肤 = 目录名；导入/下载 = uuid */
  id: string
  /** 展示名（目录名） */
  name: string
  /** skinRef 写入 AVD config 的形态：sdk:<name> 或 imported:<id> */
  skinRef: string
  /** 皮肤目录绝对路径（config skin.path 用） */
  directory: string
  layout: SkinLayout
  source: 'sdk' | 'imported' | 'downloaded'
}

export interface SkinCatalogDeps {
  readdir?: (dir: string) => Promise<string[]>
  readFile?: (path: string) => Promise<string>
  stat?: (path: string) => Promise<{ isDirectory: () => boolean }>
}

const defaultDeps: Required<SkinCatalogDeps> = {
  readdir: (dir) => readdir(dir),
  readFile: (path) => readFile(path, 'utf8'),
  stat: async (path) => stat(path)
}

interface RawNode {
  name: string
  values: Record<string, string>
  children: RawNode[]
}

/**
 * 皮肤 layout 的块语法解析（像素级缩进无关，按花括号配对）：
 * `name {` 开块、`}` 关块、`key value` 属性行。注释（# 开头）忽略。
 */
const parseBlocks = (text: string): RawNode[] => {
  const root: RawNode = { name: '', values: {}, children: [] }
  const stack: RawNode[] = [root]
  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/#.*$/, '').trim()
    if (line.length === 0) continue
    if (line === '}') {
      stack.pop()
      continue
    }
    const open = line.match(/^([A-Za-z0-9_.:-]+)\s*\{$/)
    if (open !== null) {
      const node: RawNode = { name: open[1], values: {}, children: [] }
      stack[stack.length - 1]?.children.push(node)
      stack.push(node)
      continue
    }
    const pair = line.match(/^([A-Za-z0-9_.:-]+)\s+(.+)$/)
    if (pair !== null) {
      const current = stack[stack.length - 1]
      if (current !== undefined) current.values[pair[1]] = pair[2].trim()
    }
  }
  return root.children
}

const findChild = (node: RawNode, name: string): RawNode | undefined =>
  node.children.find((child) => child.name === name)

const intOf = (node: RawNode | undefined, key: string): number | null => {
  const raw = node?.values[key]
  if (raw === undefined) return null
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : null
}

const orientationFrom = (layoutsNode: RawNode, name: string): SkinOrientation | null => {
  const orientationNode = findChild(layoutsNode, name)
  if (orientationNode === undefined) return null
  const frameWidth = intOf(orientationNode, 'width')
  const frameHeight = intOf(orientationNode, 'height')
  if (frameWidth === null || frameHeight === null) return null
  // 屏幕尺寸与偏移由 buildOrientation 按 parts.device.display + part 摆位补齐
  const partNodes = orientationNode.children.filter((child) => /^part/.test(child.name))
  const rotation = partNodes.find((part) => part.values.rotation !== undefined)?.values.rotation
  const rotationDeg = rotation === undefined ? null : Number(rotation)
  return {
    frameWidth,
    frameHeight,
    screenX: null,
    screenY: null,
    screenWidth: 0,
    screenHeight: 0,
    rotation: rotationDeg !== null && Number.isFinite(rotationDeg) ? rotationDeg : null
  }
}

/** 解析一份 layout 文本；结构不完整返回 null（明确报错不冒充成功导入） */
export const parseSkinLayout = (text: string): SkinLayout | null => {
  const roots = parseBlocks(text)
  const parts = roots.find((node) => node.name === 'parts')
  const layouts = roots.find((node) => node.name === 'layouts')
  if (parts === undefined || layouts === undefined) return null

  const device = findChild(parts, 'device')
  const display = device === undefined ? undefined : findChild(device, 'display')
  const displayWidth = intOf(display, 'width')
  const displayHeight = intOf(display, 'height')
  if (displayWidth === null || displayHeight === null || displayWidth <= 0 || displayHeight <= 0) {
    return null
  }
  const displayX = intOf(display, 'x') ?? 0
  const displayY = intOf(display, 'y') ?? 0

  // 整框尺寸以 layouts 方向块为准；屏幕偏移取第一个 part 摆位 + display 偏移
  const buildOrientation = (name: string): SkinOrientation | null => {
    const base = orientationFrom(layouts, name)
    if (base === null) return null
    const partNode = layouts.children
      .filter((child) => child.name === name)[0]
      ?.children.filter((child) => /^part/.test(child.name))[0]
    const partX = intOf(partNode, 'x') ?? 0
    const partY = intOf(partNode, 'y') ?? 0
    return {
      ...base,
      screenX: partX + displayX,
      screenY: partY + displayY,
      screenWidth: displayWidth,
      screenHeight: displayHeight
    }
  }
  const portrait = buildOrientation('portrait')
  if (portrait === null) return null
  const landscape = buildOrientation('landscape')

  const imageAssets: string[] = []
  for (const assetNode of parts.children.flatMap((group) =>
    group.children.filter(
      (child) => child.values.image !== undefined || child.values.mask !== undefined
    )
  )) {
    // background 的 image 与 foreground 的 mask 都是必须存在的素材文件
    for (const asset of [assetNode.values.image, assetNode.values.mask]) {
      if (asset !== undefined && !imageAssets.includes(asset)) imageAssets.push(asset)
    }
  }
  return { portrait, landscape, imageAssets }
}

/** 扫描 SDK skins 目录：合法 layout 的皮肤入库，坏目录跳过不拖垮 */
export const scanSdkSkins = async (
  sdkRoot: string,
  deps: SkinCatalogDeps = {}
): Promise<SkinRecord[]> => {
  const d = { ...defaultDeps, ...deps }
  const skinsRoot = join(sdkRoot, 'skins')
  let names: string[] = []
  try {
    names = await d.readdir(skinsRoot)
  } catch {
    return []
  }
  const records: SkinRecord[] = []
  for (const name of names) {
    const dir = join(skinsRoot, name)
    try {
      if (!(await d.stat(dir)).isDirectory()) continue
      const layout = parseSkinLayout(await d.readFile(join(dir, 'layout')))
      if (layout === null) continue
      records.push({
        id: name,
        name,
        skinRef: `sdk:${name}`,
        directory: dir,
        layout,
        source: 'sdk'
      })
    } catch {
      // 单个皮肤损坏不影响其余
    }
  }
  return records
}

/** 应用自有皮肤库目录（userData/device-skins） */
export const importedSkinsRoot = (userData: string): string => join(userData, 'device-skins')

export interface ImportedSkinDeps {
  readFile?: (path: string) => Promise<string>
  readdir?: (dir: string) => Promise<string[]>
  stat?: (path: string) => Promise<{ isDirectory: () => boolean }>
  cp?: (src: string, dest: string, options: { recursive: boolean }) => Promise<void>
  mkdir?: (dir: string, options: { recursive: boolean }) => Promise<void>
  rm?: (target: string, options: { recursive: boolean; force: boolean }) => Promise<void>
  extractZip?: (archivePath: string, targetDir: string) => void
}

const defaultImportDeps: Required<ImportedSkinDeps> = {
  readFile: (path) => readFile(path, 'utf8'),
  readdir: (dir) => readdir(dir),
  stat: async (path) => stat(path),
  cp: (src, dest, options) => cp(src, dest, options),
  mkdir: async (dir, options) => {
    await mkdir(dir, options)
  },
  rm: async (target, options) => {
    await rm(target, options)
  },
  extractZip: (archivePath, targetDir) => {
    new AdmZip(archivePath).extractAllTo(targetDir, true)
  }
}

/**
 * 从 zip 压缩包导入皮肤：解包到临时目录 → layout 解析核验 → 素材引用与
 * 路径逃逸核验（realpath 必须落在解包目录内）→ 原子复制进应用皮肤库。
 * 任一核验失败抛中文错误并清理临时目录——不用通用外框冒充成功导入。
 */
export const importSkinArchive = async (
  archivePath: string,
  userData: string,
  deps: ImportedSkinDeps = {}
): Promise<SkinRecord> => {
  const d = { ...defaultImportDeps, ...deps }
  const staging = join(userData, 'device-skins-staging', randomUUID())
  await d.mkdir(staging, { recursive: true })
  try {
    d.extractZip(archivePath, staging)
    // 压缩包可能带一层目录：找到含 layout 的根
    let skinDir = staging
    for (let depth = 0; depth < 3; depth += 1) {
      const entries = await d.readdir(skinDir)
      if (entries.includes('layout')) break
      const directories: string[] = []
      for (const entry of entries) {
        const full = join(skinDir, entry)
        if ((await d.stat(full)).isDirectory()) directories.push(full)
      }
      if (directories.length !== 1) {
        throw new Error('压缩包结构不合法：未找到皮肤 layout 文件（应包含一个皮肤目录）')
      }
      skinDir = directories[0]
    }
    const layout = parseSkinLayout(await d.readFile(join(skinDir, 'layout')))
    if (layout === null) {
      throw new Error('皮肤 layout 不完整（缺 parts/layouts 或屏幕尺寸），导入拒绝')
    }
    // 素材引用核验 + 路径逃逸核验（引用不得越出皮肤目录）
    const skinRootResolved = resolve(skinDir)
    const entries = await d.readdir(skinDir)
    for (const asset of layout.imageAssets) {
      if (asset.includes('..') || asset.startsWith('/')) {
        throw new Error(`素材引用越界（${asset}），导入拒绝`)
      }
      if (!entries.includes(asset)) {
        throw new Error(`素材缺失（${asset}），导入拒绝`)
      }
      const assetResolved = resolve(dirname(join(skinDir, 'layout')), asset)
      if (!assetResolved.startsWith(skinRootResolved)) {
        throw new Error(`素材路径逃逸（${asset}），导入拒绝`)
      }
    }
    const id = randomUUID()
    const name = `imported-${id.slice(0, 8)}`
    const target = join(importedSkinsRoot(userData), id)
    await d.mkdir(target, { recursive: true })
    await d.cp(skinDir, target, { recursive: true })
    return {
      id,
      name,
      skinRef: `imported:${id}`,
      directory: target,
      layout,
      source: 'imported'
    }
  } finally {
    await d.rm(staging, { recursive: true, force: true }).then(
      () => undefined,
      () => undefined
    )
  }
}

/**
 * 受控下载源（plan 设计 6：至少一种实际可用的官方或明确许可来源）。
 * 2026-10-05 核实结论：AOSP platform/sdk 的 emulator/skins 只有 assets/dynamic
 * 两个子目录（具体机型皮肤不存在）；机型皮肤的唯一官方分发渠道是 emulator
 * SDK 包内的 skins/ 目录（用户 SDK 已随包装载）；Samsung OEM 页面为动态
 * 页面、无固定包 URL 与校验值。因此当前无已核实的独立下载源——数组保持
 * 空配置，核实到固定源后登记 { id, label, license, ref, archiveUrl }。
 */
export const SKIN_DOWNLOAD_SOURCES: Array<{
  id: string
  label: string
  license: string
  ref: string
  archiveUrl: (skinName: string) => string
}> = []

export interface DownloadSkinDeps extends ImportedSkinDeps {
  fetcher?: (url: string) => Promise<ArrayBuffer>
  extractTarGz?: (archivePath: Buffer, targetDir: string) => void
  writeFile?: (path: string, data: string) => Promise<void>
}

/**
 * 下载 AOSP 单皮肤 tar.gz → 解包核验 → 入库。progress 回调按字节流转发。
 * （tar.gz 解包在 Electron 主进程走系统 tar；注入接缝供单测。）
 */
export const downloadSkin = async (
  skinName: string,
  userData: string,
  onProgress: (percent: number) => void,
  deps: DownloadSkinDeps = {}
): Promise<SkinRecord> => {
  const source = SKIN_DOWNLOAD_SOURCES[0]
  if (source === undefined) {
    throw new Error('暂无已核实的官方皮肤下载源（详见 skins.ts 核实记录），导入本地压缩包可用')
  }
  const fetcher =
    deps.fetcher ??
    (async (url: string): Promise<ArrayBuffer> => {
      const response = await fetch(url)
      if (!response.ok) throw new Error(`皮肤源响应 HTTP ${response.status}`)
      return response.arrayBuffer()
    })
  onProgress(5)
  const archive = Buffer.from(await fetcher(source.archiveUrl(skinName)))
  onProgress(60)
  const staging = join(userData, 'device-skins-staging', randomUUID())
  await (deps.mkdir ?? mkdir)(staging, { recursive: true })
  try {
    const extract =
      deps.extractTarGz ??
      ((archivePath: Buffer, targetDir: string): void => {
        // macOS/Linux 系统 tar（-z 自动识别 gzip）
        execFileSync('tar', ['-xzf', '-', '-C', targetDir], {
          input: archivePath,
          stdio: ['pipe', 'ignore', 'pipe']
        })
      })
    extract(archive, staging)
    onProgress(80)
    const layout = parseSkinLayout(
      await (deps.readFile ?? defaultImportDeps.readFile)(join(staging, 'layout'))
    )
    if (layout === null) {
      throw new Error(`下载的皮肤 ${skinName} layout 不完整，来源核验失败`)
    }
    const entries = await (deps.readdir ?? defaultImportDeps.readdir)(staging)
    for (const asset of layout.imageAssets) {
      if (asset.includes('..') || asset.startsWith('/') || !entries.includes(asset)) {
        throw new Error(`下载的皮肤素材核验失败（${asset}）`)
      }
    }
    const id = randomUUID()
    const target = join(importedSkinsRoot(userData), id)
    await (deps.mkdir ?? mkdir)(target, { recursive: true })
    await (deps.cp ?? defaultImportDeps.cp)(staging, target, { recursive: true })
    // 来源与许可记录（plan：记录来源、版本、许可）
    await (deps.writeFile ?? ((path: string, data: string) => writeFile(path, data, 'utf8')))(
      join(target, 'PROVENANCE.txt'),
      `source: ${source.id}\nurl: ${source.archiveUrl(skinName)}\nref: ${source.ref}\nlicense: ${source.license}\nimportedAt: ${new Date().toISOString()}\n`
    )
    onProgress(100)
    return {
      id,
      name: skinName,
      skinRef: `downloaded:${id}`,
      directory: target,
      layout,
      source: 'downloaded'
    }
  } finally {
    await (deps.rm ?? defaultImportDeps.rm)(staging, { recursive: true, force: true }).catch(
      () => undefined
    )
  }
}

/** 应用皮肤库扫描（导入/下载入库的皮肤） */
export const scanImportedSkins = async (
  userData: string,
  deps: SkinCatalogDeps = {}
): Promise<SkinRecord[]> => {
  const d = { ...defaultDeps, ...deps }
  const root = importedSkinsRoot(userData)
  let ids: string[] = []
  try {
    ids = await d.readdir(root)
  } catch {
    return []
  }
  const records: SkinRecord[] = []
  for (const id of ids) {
    const dir = join(root, id)
    try {
      if (!(await d.stat(dir)).isDirectory()) continue
      const layout = parseSkinLayout(await d.readFile(join(dir, 'layout')))
      if (layout === null) continue
      records.push({
        id,
        name: id.slice(0, 8),
        skinRef: `imported:${id}`,
        directory: dir,
        layout,
        source: 'imported'
      })
    } catch {
      // 单个库条目损坏不影响其余
    }
  }
  return records
}
