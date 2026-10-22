import { createHash } from 'node:crypto'
import { netFetch } from './netFetch'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readdir, rename, rm, stat, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { execFile } from 'node:child_process'
import { XMLParser } from 'fast-xml-parser'
import { splitPackageName } from './catalog'
import { msg } from '../locale'

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

/** 用户显式取消——与错误分流（取消不是失败，plan 2026-10-06-download-cancel 设计 2） */
export class CancelledError extends Error {
  constructor() {
    super(msg('dlCancelled'))
    this.name = 'CancelledError'
  }
}

/** 镜像 zip 解压命令（平台分支，导出供单测钉形态）：mac 用 unzip，win32 用自带 tar.exe */
export const extractZipCommand = (
  platform: NodeJS.Platform,
  zipPath: string,
  targetDir: string
): { command: string; args: string[] } =>
  platform === 'win32'
    ? { command: 'tar.exe', args: ['-xf', zipPath, '-C', targetDir] }
    : { command: 'unzip', args: ['-q', zipPath, '-d', targetDir] }

export interface DownloaderDeps {
  /** 拉起下载流；默认 fetch（挂 signal，中断即时）。totalBytes 优先 Content-Length，缺省回退 manifest size */
  openUrl?: (
    url: string,
    signal?: AbortSignal
  ) => Promise<{ stream: AsyncIterable<Uint8Array>; totalBytes: number | null }>
  now?: () => number
  /** sha1（默认流式读文件；接缝供单测注入固定值） */
  sha1Of?: (path: string) => Promise<string>
  /** 解压 zip 到目录（默认系统 unzip，异步 + signal 可中断——execFileSync 阻塞 main 已退役） */
  extractZip?: (zipPath: string, targetDir: string, signal?: AbortSignal) => Promise<void>
  pathExists?: (path: string) => Promise<boolean>
  makeDir?: (dir: string) => Promise<void>
  moveDir?: (from: string, to: string) => Promise<void>
  removePath?: (path: string) => Promise<void>
  /** 读 package.xml（身份核验）；接缝供单测注入 */
  readFile?: (path: string) => Promise<string>
  readDir?: (dir: string) => Promise<string[]>
  writeFile?: (path: string, data: string) => Promise<void>
  /** 下载字节落盘 sink；接缝供单测注入可控写错误（review P1） */
  createSink?: (path: string) => ChunkSink
}

/**
 * 下载字节落盘抽象：错误从创建起就被监听（未监听的流错误 = uncaught
 * exception 会崩 main），drain 等待与错误竞争——出错时 reject 而非挂死。
 */
export interface ChunkSink {
  write: (chunk: Uint8Array) => boolean
  /** 结束写入并等待落盘完成；出错 reject */
  finish: () => Promise<void>
  destroy: () => void
  /** 等待缓冲排空（背压）；出错 reject */
  waitDrain: () => Promise<void>
}

/**
 * 平台化解压器工厂（review P3-2 接缝）：默认实现按 process.platform 选命令，
 * 平台可注入——win32 分支在 mac 上可测（以 ENOENT 证实解析到 tar.exe）。
 * 镜像 zip 的 system.img 解压后常 ≥2GB——adm-zip 会整条目分配 Buffer 撞 2^31
 * 上限（真机实测 android-21 即 2147483648 字节）；系统解压器原生支持 zip64 与
 * 大条目：macOS 用自带 unzip，win32 用自带 tar.exe（bsdtar，官方支持解 zip；
 * Expand-Archive 有 2GB 上限不可用）。异步 execFile + signal：取消时 kill
 * 子进程立即返回（execFileSync 阻塞 main 且不可中断——取消 plan 顺带退役）
 */
export const makeExtractZip =
  (platform: NodeJS.Platform): NonNullable<DownloaderDeps['extractZip']> =>
  (zipPath, targetDir, signal) =>
    new Promise<void>((resolve, reject) => {
      const { command, args } = extractZipCommand(platform, zipPath, targetDir)
      execFile(command, args, { signal, windowsHide: true }, (error) => {
        if (signal?.aborted) reject(new CancelledError())
        else if (error === null) resolve()
        else reject(new Error(msg('dlUnzipFailed', { message: error.message })))
      })
    })

/** 默认依赖集合（导出供 default extractZip 等真实子进程行为做单测） */
export const defaultDeps: Required<DownloaderDeps> = {
  openUrl: async (url, signal) => {
    // netFetch：镜像 zip 下载走系统代理（issue 2026-10-09）；流式 body 兼容
    const response = await netFetch(url, { signal })
    if (!response.ok || response.body === null) {
      throw new Error(msg('dlHttpStatus', { status: response.status }))
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
  extractZip: makeExtractZip(process.platform),
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
  createSink: (path: string): ChunkSink => {
    const output = createWriteStream(path)
    // 常驻 error 监听：任何时点的写错误都被记录（无监听的流错误会以
    // uncaught exception 崩掉 main——review P1），后续 write 短路抛出
    let firstError: Error | null = null
    output.on('error', (error: Error) => {
      if (firstError === null) firstError = error
    })
    return {
      write: (chunk) => {
        if (firstError !== null) throw firstError
        return output.write(chunk)
      },
      finish: () =>
        new Promise<void>((resolve, reject) => {
          output.once('error', reject)
          output.end(() => {
            output.off('error', reject)
            if (firstError !== null) reject(firstError)
            else resolve()
          })
        }),
      destroy: () => output.destroy(),
      waitDrain: () =>
        new Promise<void>((resolve, reject) => {
          if (firstError !== null) {
            reject(firstError)
            return
          }
          output.once('error', reject)
          output.once('drain', () => {
            output.off('error', reject)
            resolve()
          })
        })
    }
  },
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
  deps: DownloaderDeps = {},
  signal?: AbortSignal
): Promise<string> => {
  if (target.zipUrl === null) {
    throw new Error(msg('dlNoZipUrl'))
  }
  const d = { ...defaultDeps, ...deps }
  const throwIfCancelled = (): void => {
    if (signal?.aborted) throw new CancelledError()
  }
  throwIfCancelled()
  const zipPath = tempZipPath(sdkRoot, target.packageName)
  await d.makeDir(join(sdkRoot, 'system-images'))
  const { stream, totalBytes } = await d.openUrl(target.zipUrl, signal)
  const expectedTotal = totalBytes ?? target.sizeBytes

  let received = 0
  let lastPercent = 0
  let lastPushAt = 0
  const sink = d.createSink(zipPath)
  try {
    for await (const chunk of stream) {
      throwIfCancelled()
      // 写流背压：缓冲满时等 drain（与写错误竞争——出错 reject 而非挂死，
      // 2GB 级包也不会全攒内存）；写已出错时 write 直接抛（review P1 修复）
      if (!sink.write(chunk)) await sink.waitDrain()
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
    await sink.finish()
    // 下载完成后的取消（sha1/返回前）也必须走 catch 的清理域——此前检查点
    // 在 try 外，这条路径会残留 .downloading.zip（review P1-1）
    throwIfCancelled()
  } catch (error) {
    sink.destroy()
    await d.removePath(zipPath).catch(() => undefined)
    throw error
  }

  if (target.zipSha1 !== null) {
    const actual = await d.sha1Of(zipPath)
    if (actual !== target.zipSha1) {
      await d.removePath(zipPath).catch(() => undefined)
      throw new Error(
        msg('dlIntegrityFailed', {
          expected: target.zipSha1.slice(0, 8),
          actual: actual.slice(0, 8)
        })
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
        '    <revision>',
        `      <major>${target.revision.major}</major>`,
        ...(target.revision.minor !== null
          ? [`      <minor>${target.revision.minor}</minor>`]
          : []),
        ...(target.revision.micro !== null
          ? [`      <micro>${target.revision.micro}</micro>`]
          : []),
        '    </revision>'
      ]
    : ['    <revision>', '      <major>1</major>', '    </revision>']
  const tagBlocks = target.tagIds.map((tagId) =>
    [
      '    <tag>',
      `      <id>${xmlEscape(tagId)}</id>`,
      `      <display>${xmlEscape(({ default: 'Default', google_apis: 'Google APIs', google_apis_playstore: 'Google Play' } as Record<string, string>)[tagId] ?? tagId)}</display>`,
      '    </tag>'
    ].join('\n')
  )
  // 元素顺序对齐官方 repo XSD 的 xs:sequence（type-details → revision →
  // display-name；本仓解析不敏感，但 avdmanager/Studio 等严格工具按序读——review P2）
  const lines = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<ns2:repository xmlns:ns2="http://schemas.android.com/repository/android/common/02" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:sysimg="http://schemas.android.com/sdk/android/repo/sys-img2/05">',
    `  <localPackage path="${xmlEscape(target.packageName)}" obsolete="false">`,
    '    <type-details xsi:type="sysimg:sysImgDetailsType">',
    `      <api-level>${xmlEscape(target.apiLevelText)}</api-level>`,
    ...(target.extensionLevel !== null
      ? [`      <extension-level>${target.extensionLevel}</extension-level>`]
      : []),
    ...tagBlocks,
    `      <abi>${xmlEscape(target.abi)}</abi>`,
    `      <abis>${xmlEscape(target.abi)}</abis>`,
    '    </type-details>',
    ...revisionLines,
    '    <display-name>' + xmlEscape(target.displayName) + '</display-name>',
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
  deps: DownloaderDeps = {},
  signal?: AbortSignal
): Promise<void> => {
  const d = { ...defaultDeps, ...deps }
  const throwIfCancelled = (): void => {
    if (signal?.aborted) throw new CancelledError()
  }
  const parts = splitPackageName(target.packageName)
  if (parts === null) throw new Error(msg('dlInvalidPackage', { packageName: target.packageName }))
  const unzipDir = tempUnzipPath(sdkRoot, target.packageName)
  const destDir = join(sdkRoot, 'system-images', parts.platformSegment, parts.tagSegment, parts.abi)
  const backupDir = `${destDir}.install-bak`

  await d.removePath(unzipDir).catch(() => undefined)
  await d.makeDir(unzipDir)
  try {
    throwIfCancelled()
    await d.extractZip(zipPath, unzipDir, signal)
    // 解压（可能被 signal kill 中断）后、动目标目录前的最后检查点——
    // 取消只清临时物，不进入「备份-落位-核验」事务段
    throwIfCancelled()
    const sourceDir = await locateContentRoot(unzipDir, d)
    if (sourceDir === null) {
      throw new Error(msg('dlLayoutMismatch'))
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
        throw new Error(msg('dlVerifyFailedRolledBack'))
      }
      // 成功：清备份与临时物
      if (backedUp) await d.removePath(backupDir).catch(() => undefined)
    } catch (error) {
      // 回滚本次落位并恢复备份；回滚失败不吞（review P3，对齐设备创建事务的
      // 「主错误 + 残留路径」标准）——不虚报「已回滚」
      const rollbackErrors: string[] = []
      await d.removePath(destDir).catch((rollback: unknown) => {
        rollbackErrors.push(rollback instanceof Error ? rollback.message : String(rollback))
      })
      if (backedUp) {
        await d.moveDir(backupDir, destDir).catch((rollback: unknown) => {
          rollbackErrors.push(rollback instanceof Error ? rollback.message : String(rollback))
        })
      }
      if (rollbackErrors.length > 0) {
        const main = error instanceof Error ? error.message : String(error)
        throw new Error(
          msg('dlRollbackIncomplete', {
            main,
            errors: rollbackErrors.join('；'),
            dest: destDir,
            backup: backupDir
          })
        )
      }
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
 * 取消（signal 中断）不是失败：清理完成后返回 'canceled'，不抛错——调用方
 * 据此走取消广播而非错误路径（plan download-cancel 设计 2）。
 */
export const downloadImagePackage = async (
  sdkRoot: string,
  target: DownloadTarget,
  onPercent: (percent: number) => void,
  deps: DownloaderDeps = {},
  signal?: AbortSignal
): Promise<'installed' | 'canceled'> => {
  let zipPath: string
  try {
    zipPath = await downloadImageZip(sdkRoot, target, onPercent, deps, signal)
    await installImageZip(sdkRoot, target, zipPath, deps, signal)
  } catch (error) {
    // 取消的两种错误形态：自检点抛 CancelledError；fetch/execFile 的 signal
    // 中断抛原生 AbortError（真机实证 fetch 层直达此处）——signal 已中止
    // 时的 AbortError 一律按取消分流，不进失败路径
    if (error instanceof CancelledError) return 'canceled'
    if (signal?.aborted === true && error instanceof Error && error.name === 'AbortError') {
      return 'canceled'
    }
    throw error
  }
  onPercent(100)
  return 'installed'
}
