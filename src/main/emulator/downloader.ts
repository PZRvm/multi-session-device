import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readdir, rename, rm, stat, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { once } from 'node:events'
import { execFileSync } from 'node:child_process'
import { XMLParser } from 'fast-xml-parser'
import { splitPackageName } from './catalog'

/**
 * 镜像直连下载（plan 2026-10-06-download-progress-zero）：官方 CLI 两代都
 * 没有机器可读进度流（管道全缓冲 + 新版无进度行），因此绕过 sdkmanager——
 * manifest 的 archives.complete 带 zip 绝对地址、精确字节数与 sha1，直接
 * 流式下载得到真实进度；校验通过后解压落位并按三件套核验（package.xml +
 * source.properties + system.img），失败回滚本次落位。下载互斥、进度推送
 * 与失败广播由 IPC 层（emulator/index.ts）持有，本模块只管字节到核验。
 */

const PROGRESS_MIN_DELTA_PERCENT = 1
const PROGRESS_MIN_INTERVAL_MS = 500

export interface DownloaderDeps {
  /** 拉起下载流；默认 fetch。totalBytes 优先 Content-Length，缺省回退 manifest size */
  openUrl?: (
    url: string
  ) => Promise<{ stream: AsyncIterable<Uint8Array>; totalBytes: number | null }>
  now?: () => number
  /** sha1（默认流式读文件；接缝供单测注入固定值） */
  sha1Of?: (path: string) => Promise<string>
  /** 解压 zip 到目录（默认 adm-zip） */
  extractZip?: (zipPath: string, targetDir: string) => Promise<void>
  pathExists?: (path: string) => Promise<boolean>
  makeDir?: (dir: string) => Promise<void>
  moveDir?: (from: string, to: string) => Promise<void>
  removePath?: (path: string) => Promise<void>
  /** 读 package.xml（身份核验）；接缝供单测注入 */
  readFile?: (path: string) => Promise<string>
  readDir?: (dir: string) => Promise<string[]>
  writeFile?: (path: string, data: string) => Promise<void>
}

const defaultDeps: Required<DownloaderDeps> = {
  openUrl: async (url) => {
    const response = await fetch(url)
    if (!response.ok || response.body === null) {
      throw new Error(`下载源响应 HTTP ${response.status}`)
    }
    const lengthHeader = response.headers.get('content-length')
    const totalBytes = lengthHeader === null ? null : Number(lengthHeader)
    const stream = response.body as unknown as AsyncIterable<Uint8Array>
    return {
      stream,
      totalBytes: totalBytes !== null && Number.isFinite(totalBytes) ? totalBytes : null
    }
  },
  now: () => Date.now(),
  sha1Of: (path) =>
    new Promise((resolve, reject) => {
      const hash = createHash('sha1')
      createReadStream(path)
        .on('data', (chunk) => hash.update(chunk))
        .on('error', reject)
        .on('end', () => resolve(hash.digest('hex')))
    }),
  extractZip: async (zipPath, targetDir) => {
    // 镜像 zip 的 system.img 解压后常 ≥2GB——adm-zip 会整条目分配 Buffer 撞
    // 2^31 上限（真机实测 android-21 即 2147483648 字节）；系统 unzip 原生
    // 支持 zip64 与大条目（macOS/Linux 自带；与皮肤下载的系统 tar 同策略）
    execFileSync('unzip', ['-q', zipPath, '-d', targetDir], { stdio: ['ignore', 'ignore', 'pipe'] })
  },
  pathExists: async (path) => {
    try {
      await stat(path)
      return true
    } catch {
      return false
    }
  },
  makeDir: async (dir: string): Promise<void> => {
    await mkdir(dir, { recursive: true })
  },
  moveDir: (from, to) => rename(from, to),
  removePath: async (path: string): Promise<void> => {
    await rm(path, { recursive: true, force: true })
  },
  readFile: (path) => readFile(path, 'utf8'),
  readDir: (dir) => readdir(dir),
  writeFile: async (path: string, data: string): Promise<void> => {
    const { writeFile: write } = await import('node:fs/promises')
    await write(path, data, 'utf8')
  }
}

/** 需要外部提供的包描述（IPC 层从可信目录取出 ImageEntry；元数据用于生成 package.xml） */
export interface DownloadTarget {
  packageName: string
  zipUrl: string | null
  zipSha1: string | null
  sizeBytes: number | null
  displayName: string
  apiLevelText: string
  extensionLevel: number | null
  tagIds: string[]
  abi: string
  revision: { major: number; minor: number | null; micro: number | null } | null
}

const safeToken = (packageName: string): string => packageName.replace(/[;/:]/g, '_')
const tempZipPath = (sdkRoot: string, packageName: string): string =>
  join(sdkRoot, 'system-images', `.${safeToken(packageName)}.downloading.zip`)
const tempUnzipPath = (sdkRoot: string, packageName: string): string =>
  join(sdkRoot, 'system-images', `.${safeToken(packageName)}.unzipping`)

/**
 * 流式下载镜像 zip 到临时文件：真实百分比 = 已收字节 ÷ 总字节（总字节取
 * Content-Length，缺省回退 manifest size，两者皆无则只推 0 与 99 两档）。
 * 字节收满封顶 99——100% 保留给全链路（校验+落位+核验）成功之后。
 */
export const downloadImageZip = async (
  sdkRoot: string,
  target: DownloadTarget,
  onPercent: (percent: number) => void,
  deps: DownloaderDeps = {}
): Promise<string> => {
  if (target.zipUrl === null) {
    throw new Error('该包在 manifest 中没有可下载的 zip 地址，不支持应用内下载')
  }
  const d = { ...defaultDeps, ...deps }
  const zipPath = tempZipPath(sdkRoot, target.packageName)
  await d.makeDir(join(sdkRoot, 'system-images'))
  const { stream, totalBytes } = await d.openUrl(target.zipUrl)
  const expectedTotal = totalBytes ?? target.sizeBytes

  let received = 0
  let lastPercent = 0
  let lastPushAt = 0
  const output = createWriteStream(zipPath)
  try {
    for await (const chunk of stream) {
      // 写流背压：缓冲满时等 drain，避免 2GB 级包全攒在内存
      if (!output.write(chunk)) await once(output, 'drain')
      received += chunk.byteLength
      if (expectedTotal !== null && expectedTotal > 0) {
        const percent = Math.min(99, Math.floor((received / expectedTotal) * 100))
        const at = d.now()
        if (
          percent > lastPercent + PROGRESS_MIN_DELTA_PERCENT ||
          (percent > lastPercent && at - lastPushAt >= PROGRESS_MIN_INTERVAL_MS)
        ) {
          lastPercent = percent
          lastPushAt = at
          onPercent(percent)
        }
      }
    }
    await new Promise<void>((resolve, reject) => {
      output.end(() => resolve())
      output.on('error', reject)
    })
  } catch (error) {
    output.destroy()
    await d.removePath(zipPath).catch(() => undefined)
    throw error
  }

  if (target.zipSha1 !== null) {
    const actual = await d.sha1Of(zipPath)
    if (actual !== target.zipSha1) {
      await d.removePath(zipPath).catch(() => undefined)
      throw new Error(
        `镜像完整性校验失败（sha1 不符，期望 ${target.zipSha1.slice(0, 8)}… 实得 ${actual.slice(0, 8)}…），已删除损坏文件，请重试`
      )
    }
  }
  return zipPath
}

const identityParser = new XMLParser({
  ignoreDeclaration: true,
  removeNSPrefix: true,
  ignoreAttributes: false,
  parseTagValue: false,
  trimValues: true
})

/** 单包三件套核验：目录内 package.xml 身份匹配 + source.properties + system.img */
export const verifyPackageInstall = async (
  sdkRoot: string,
  packageName: string,
  deps: DownloaderDeps = {}
): Promise<boolean> => {
  const d = { ...defaultDeps, ...deps }
  const parts = splitPackageName(packageName)
  if (parts === null) return false
  const dir = join(sdkRoot, 'system-images', parts.platformSegment, parts.tagSegment, parts.abi)
  if (!(await d.pathExists(join(dir, 'package.xml')))) return false
  if (!(await d.pathExists(join(dir, 'source.properties')))) return false
  if (!(await d.pathExists(join(dir, 'system.img')))) return false
  try {
    const read = deps.readFile ?? defaultDeps.readFile
    const parsed = identityParser.parse(await read(join(dir, 'package.xml'))) as {
      repository?: { localPackage?: { '@_path'?: unknown } }
    }
    return parsed.repository?.localPackage?.['@_path'] === packageName
  } catch {
    return false
  }
}

/** 解压目录内定位包内容根：system.img 所在目录（深度 ≤3，兼容 <abi>/ 与 <platform>/<tag>/<abi>/ 两种 zip 布局） */
const locateContentRoot = async (
  unzipDir: string,
  d: Required<DownloaderDeps>
): Promise<string | null> => {
  const tryDir = async (dir: string): Promise<string | null> =>
    (await d.pathExists(join(dir, 'system.img'))) ? dir : null
  const level1 = await d.readDir(unzipDir)
  for (const entry of level1) {
    const dir = join(unzipDir, entry)
    const hit = await tryDir(dir)
    if (hit !== null) return hit
    // 深度 2/3（platform/tag/abi 树形态）
    for (const e2 of await d.readDir(dir)) {
      const dir2 = join(dir, e2)
      const hit2 = await tryDir(dir2)
      if (hit2 !== null) return hit2
      for (const e3 of await d.readDir(dir2)) {
        const dir3 = join(dir2, e3)
        const hit3 = await tryDir(dir3)
        if (hit3 !== null) return hit3
      }
    }
  }
  return null
}

const xmlEscape = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * 生成 package.xml（zip 不带——sdkmanager 是从 repo 元数据生成的，直连下载
 * 自行补齐；结构与本机 fixture android-36.1-playstore-package.xml 对齐，
 * catalog 的本地扫描与三件套核验都消费该文件）。
 */
export const buildPackageXml = (target: DownloadTarget): string => {
  const revisionLines = target.revision
    ? [
        '  <revision>',
        `    <major>${target.revision.major}</major>`,
        ...(target.revision.minor !== null ? [`    <minor>${target.revision.minor}</minor>`] : []),
        ...(target.revision.micro !== null ? [`    <micro>${target.revision.micro}</micro>`] : []),
        '  </revision>'
      ]
    : ['  <revision>', '    <major>1</major>', '  </revision>']
  const tagBlocks = target.tagIds.map((tagId) =>
    ['    <tag>', `      <id>${xmlEscape(tagId)}</id>`, '    </tag>'].join('\n')
  )
  const lines = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<ns2:repository xmlns:ns2="http://schemas.android.com/repository/android/common/02">',
    `  <localPackage path="${xmlEscape(target.packageName)}" obsolete="false">`,
    '    <display-name>' + xmlEscape(target.displayName) + '</display-name>',
    ...revisionLines,
    '    <type-details>',
    `      <api-level>${xmlEscape(target.apiLevelText)}</api-level>`,
    ...(target.extensionLevel !== null
      ? [`      <extension-level>${target.extensionLevel}</extension-level>`]
      : []),
    ...tagBlocks,
    `      <abi>${xmlEscape(target.abi)}</abi>`,
    '    </type-details>',
    '  </localPackage>',
    '</ns2:repository>',
    ''
  ]
  return lines.join('\n')
}

/**
 * 解压落位 + package.xml 生成 + 三件套核验 + 失败回滚：zip 解到临时目录 →
 * 定位包内容根（system.img 所在目录；zip 首层即 <abi>/，真机实证见 fixtures
 * README）→ 生成 package.xml → rename 落位到包名推导路径（已存在先挪 .bak，
 * 核验通过删备份、失败恢复）。
 */
export const installImageZip = async (
  sdkRoot: string,
  target: DownloadTarget,
  zipPath: string,
  deps: DownloaderDeps = {}
): Promise<void> => {
  const d = { ...defaultDeps, ...deps }
  const parts = splitPackageName(target.packageName)
  if (parts === null) throw new Error(`非法包名：${target.packageName}`)
  const unzipDir = tempUnzipPath(sdkRoot, target.packageName)
  const destDir = join(sdkRoot, 'system-images', parts.platformSegment, parts.tagSegment, parts.abi)
  const backupDir = `${destDir}.install-bak`

  await d.removePath(unzipDir).catch(() => undefined)
  await d.makeDir(unzipDir)
  try {
    await d.extractZip(zipPath, unzipDir)
    const sourceDir = await locateContentRoot(unzipDir, d)
    if (sourceDir === null) {
      throw new Error('压缩包布局与预期不符（未找到 system.img 所在目录），拒绝落位')
    }
    // zip 不带 package.xml——从 manifest 元数据生成（身份+API+tag+abi）
    await d.writeFile(join(sourceDir, 'package.xml'), buildPackageXml(target))

    await d.makeDir(dirname(destDir))
    let backedUp = false
    if (await d.pathExists(destDir)) {
      await d.removePath(backupDir).catch(() => undefined)
      await d.moveDir(destDir, backupDir)
      backedUp = true
    }
    try {
      await d.moveDir(sourceDir, destDir)
      if (!(await verifyPackageInstall(sdkRoot, target.packageName, deps))) {
        throw new Error(
          '安装核验失败（package.xml/source.properties/system.img 不齐或身份不符），已回滚'
        )
      }
      // 成功：清备份与临时物
      if (backedUp) await d.removePath(backupDir).catch(() => undefined)
    } catch (error) {
      // 回滚本次落位并恢复备份
      await d.removePath(destDir).catch(() => undefined)
      if (backedUp) await d.moveDir(backupDir, destDir).catch(() => undefined)
      throw error
    }
  } finally {
    await d.removePath(unzipDir).catch(() => undefined)
    await d.removePath(zipPath).catch(() => undefined)
  }
}

/**
 * 组合入口（sdk:download-image 执行体）：下载 → sha1 校验 → 落位 → 核验。
 * 100% 只在全链路成功后推送——renderer 收到即重拉清单，此时三件套已就绪。
 */
export const downloadImagePackage = async (
  sdkRoot: string,
  target: DownloadTarget,
  onPercent: (percent: number) => void,
  deps: DownloaderDeps = {}
): Promise<void> => {
  const zipPath = await downloadImageZip(sdkRoot, target, onPercent, deps)
  await installImageZip(sdkRoot, target, zipPath, deps)
  onPercent(100)
}
