import { readFile, readdir, mkdir, cp, rm, stat } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { DeviceSkinOrientation, SkinImagePart } from '@shared/types'
import AdmZip from 'adm-zip'
import { SkinImageBudget, SKIN_IMAGE_MAX_BYTES } from './skinImageLimits'

/**
 * 机型皮肤域（plan 设计 6）：SDK 已装皮肤扫描、layout 解析、本地导入与
 * 官方资源获取在 skinSource；受控读取在 skinPresentation。
 * renderer geometry 使用此处的屏幕矩形作为渲染与输入的单一依据。
 */

/** 单方向的屏幕矩形与整框尺寸（CSS 无关的原始像素） */
export type SkinOrientation = DeviceSkinOrientation

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

  // 通过 part.name 定位 display，而非把装饰 part1 当成屏幕。
  const buildOrientation = (name: string): SkinOrientation | null => {
    const base = orientationFrom(layouts, name)
    if (base === null || base.frameWidth <= 0 || base.frameHeight <= 0) return null
    const orientation = findChild(layouts, name)!
    const references = orientation.children.filter((child) => /^part\d+$/.test(child.name))
    const deviceRef = references.find((part) => part.values.name === 'device')
    const displayRef = deviceRef
    if (displayRef === undefined) return null
    const rotation = intOf(displayRef, 'rotation') ?? 0
    if (![0, 1, 2, 3].includes(rotation)) return null
    const backgrounds: SkinImagePart[] = []
    let foregroundMask: string | undefined
    for (const part of references) {
      const definition = parts.children.find((entry) => entry.name === part.values.name)
      const background = definition ? findChild(definition, 'background') : undefined
      const mask = definition ? findChild(definition, 'foreground')?.values.mask : undefined
      if (mask !== undefined) foregroundMask = mask
      if (background?.values.image) {
        const turn = intOf(part, 'rotation') ?? 0
        if (![0, 1, 2, 3].includes(turn)) return null
        const bx = intOf(background, 'x') ?? 0
        const by = intOf(background, 'y') ?? 0
        backgrounds.push({
          file: background.values.image,
          x: (intOf(part, 'x') ?? 0) + (turn === 1 ? -by : turn === 2 ? -bx : turn === 3 ? by : bx),
          y: (intOf(part, 'y') ?? 0) + (turn === 1 ? bx : turn === 2 ? -by : turn === 3 ? -bx : by),
          rotation: turn
        })
      }
    }
    const width = rotation % 2 ? displayHeight : displayWidth
    const height = rotation % 2 ? displayWidth : displayHeight
    const rotatedX =
      rotation === 1
        ? -displayY - displayHeight
        : rotation === 2
          ? -displayX - displayWidth
          : rotation === 3
            ? displayY
            : displayX
    const rotatedY =
      rotation === 1
        ? displayX
        : rotation === 2
          ? -displayY - displayHeight
          : rotation === 3
            ? -displayX - displayWidth
            : displayY
    const x = (intOf(displayRef, 'x') ?? 0) + rotatedX
    const y = (intOf(displayRef, 'y') ?? 0) + rotatedY
    if (x < 0 || y < 0 || x + width > base.frameWidth || y + height > base.frameHeight) return null
    return {
      ...base,
      screenX: x,
      screenY: y,
      screenWidth: width,
      screenHeight: height,
      rotation,
      backgrounds,
      ...(foregroundMask === undefined ? {} : { foregroundMask })
    }
  }
  const portrait = buildOrientation('portrait')
  const landscape = buildOrientation('landscape')
  if (portrait === null && landscape === null) return null

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

/**
 * 可渲染素材清单（单一来源）：两方向 backgrounds + 前景遮罩去重。
 * skinPresentation 的受控读取与导入/扫描的可渲染性校验共用本口径——
 * 零清单的皮肤不进入可选清单（review P3：可入库≠可渲染的分叉）。
 */
export const renderableArtFiles = (layout: SkinLayout): string[] => [
  ...new Set(
    [layout.portrait, layout.landscape].flatMap((orientation) => [
      ...(orientation?.backgrounds?.map((image) => image.file) ?? []),
      ...(orientation?.foregroundMask ? [orientation.foregroundMask] : [])
    ])
  )
]

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
      // 零可渲染素材（无 background/foreground 引用）跳过：入库必被投屏拒绝
      if (layout === null || renderableArtFiles(layout).length === 0) continue
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
  readImage?: (path: string) => Promise<Buffer>
  readFile?: (path: string) => Promise<string>
  readdir?: (dir: string) => Promise<string[]>
  stat?: (path: string) => Promise<{ isDirectory: () => boolean }>
  cp?: (src: string, dest: string, options: { recursive: boolean }) => Promise<void>
  mkdir?: (dir: string, options: { recursive: boolean }) => Promise<void>
  rm?: (target: string, options: { recursive: boolean; force: boolean }) => Promise<void>
  extractZip?: (archivePath: string, targetDir: string) => void
}

const defaultImportDeps: Required<ImportedSkinDeps> = {
  readImage: (path) => readFile(path),
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

/** 资源限额（plan 设计 6「限制资源数量/体积」，review P3 补齐） */
const MAX_SKIN_FILES = 200
const MAX_SKIN_BYTES = 256 * 1024 * 1024
const MAX_SKIN_WALK_DEPTH = 4

/** 入库前核验文件数与总体积——超限中文拒绝，防止恶意/损坏压缩包撑爆磁盘 */
const assertSkinResourceLimits = async (
  dir: string,
  d: Required<ImportedSkinDeps>
): Promise<void> => {
  let files = 0
  let bytes = 0
  const walk = async (current: string, depth: number): Promise<void> => {
    if (depth > MAX_SKIN_WALK_DEPTH) return
    for (const entry of await d.readdir(current)) {
      const full = join(current, entry)
      const info = await d.stat(full)
      if (info.isDirectory()) {
        await walk(full, depth + 1)
      } else {
        files += 1
        const size = (info as { size?: number }).size
        if (typeof size === 'number') bytes += size
        if (files > MAX_SKIN_FILES) {
          throw new Error(`压缩包资源数超限（> ${MAX_SKIN_FILES} 个文件），导入拒绝`)
        }
        if (bytes > MAX_SKIN_BYTES) {
          throw new Error('压缩包体积超限（> 256 MB），导入拒绝')
        }
      }
    }
  }
  await walk(dir, 0)
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
    // 可渲染性前置校验（review P3）：零素材皮肤入库必被投屏拒绝，导入即拒
    if (renderableArtFiles(layout).length === 0) {
      throw new Error('皮肤没有可渲染的背景图片（layout 未引用背景/前景素材），导入拒绝')
    }
    // 素材引用核验 + 路径逃逸核验（词法 resolve + 禁 `..`/绝对引用 + 条目存在性；
    // adm-zip 解包不产符号链接，词法与 realpath 等效——review P3 措辞对齐）
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
    await assertSkinResourceLimits(skinDir, d)
    const budget = new SkinImageBudget()
    for (const asset of layout.imageAssets) {
      const path = join(skinDir, asset)
      const info = await d.stat(path)
      if (info.isDirectory() || (info as { size?: number }).size! > SKIN_IMAGE_MAX_BYTES)
        throw new Error(`素材 ${asset}：不是图片文件或体积超限`)
      budget.add(asset, await d.readImage(path))
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

/** 应用皮肤库扫描（导入/下载入库的皮肤）。PROVENANCE 溯源（review P2-4）：带来源记录的条目恢复 downloaded:<id> 身份与皮肤名，否则 imported:<id> */
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
  const readProvenance = async (dir: string): Promise<{ name: string | null } | null> => {
    let text: string
    try {
      text = await d.readFile(join(dir, 'PROVENANCE.txt'))
    } catch {
      return null
    }
    // 只认真实 PROVENANCE 形态（source: 行）——空串/损坏文件按 imported 处理
    if (!/^source: /m.test(text)) return null
    return { name: text.match(/^name: (.+)$/m)?.[1] ?? null }
  }
  const records: SkinRecord[] = []
  for (const id of ids) {
    const dir = join(root, id)
    try {
      if (!(await d.stat(dir)).isDirectory()) continue
      const layout = parseSkinLayout(await d.readFile(join(dir, 'layout')))
      // 零可渲染素材跳过：与 SDK 扫描/导入同口径，不进可选清单
      if (layout === null || renderableArtFiles(layout).length === 0) continue
      const provenance = await readProvenance(dir)
      records.push({
        id,
        name: provenance?.name ?? id.slice(0, 8),
        skinRef: provenance !== null ? `downloaded:${id}` : `imported:${id}`,
        directory: dir,
        layout,
        source: provenance !== null ? 'downloaded' : 'imported'
      })
    } catch {
      // 单个库条目损坏不影响其余
    }
  }
  return records
}
