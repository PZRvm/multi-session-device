import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { SdkComponentName, SdkProgress, SdkSnapshot } from '@shared/types'
import { msg } from '../locale'
import { androidUserHomeFor } from './androidUserHome'
import { makeResilientRename } from './fsWin'
import { netFetch } from './netFetch'
import { spawnCommand, tarBinFor } from './platformExec'

// 归位用容错 rename（fsWin）：win32 撞杀软句柄退避重试 + EXDEV 兜底；mac 恒为裸 rename
const renameResilient = makeResilientRename(process.platform)

// ---- 钉版下载源（升级 = 显式改这里 + 重跑真机集成）----
// 按平台查表（plan 2026-10-22-windows-sdk-bootstrap 设计 2）：win32 的 url/校验值
// 待 Windows 真机实测后填入——占位期间 bootstrapSdk 走到即抛错，禁止带占位值真跑。

const TEMURIN_JRE_URL =
  'https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.12.1%2B1/OpenJDK21U-jre_aarch64_mac_hotspot_21.0.12.1_1.tar.gz'
const TEMURIN_JRE_SHA256 = 'dec50fc6f9fcd4fe3ae8cabf5a5fa68f6afc48841f7698e468e9aa5d54beed84'
const CMDLINE_TOOLS_URL =
  'https://dl.google.com/android/repository/commandlinetools-mac_arm64-16111833_latest.zip'
const CMDLINE_TOOLS_SHA1 = 'ad03dc49bfacfd52c110b14104ea548b8a07e830'

const WINDOWS_SOURCE_PLACEHOLDER = 'TODO-windows'
const DARWIN_SOURCES: BootstrapSources = {
  jreUrl: TEMURIN_JRE_URL,
  jreSha256: TEMURIN_JRE_SHA256,
  cmdlineToolsUrl: CMDLINE_TOOLS_URL,
  cmdlineToolsSha1: CMDLINE_TOOLS_SHA1
}
const PENDING_SOURCES: BootstrapSources = {
  jreUrl: WINDOWS_SOURCE_PLACEHOLDER,
  jreSha256: WINDOWS_SOURCE_PLACEHOLDER,
  cmdlineToolsUrl: WINDOWS_SOURCE_PLACEHOLDER,
  cmdlineToolsSha1: WINDOWS_SOURCE_PLACEHOLDER
}
/** 按平台查表；未登记平台（如 linux）同样落到占位源——由 bootstrap 入口守卫显式拒绝，不静默回退 darwin（装错平台的二进制比显式失败更糟） */
const PINNED_SOURCES: Partial<Record<NodeJS.Platform, BootstrapSources>> = {
  darwin: DARWIN_SOURCES,
  win32: PENDING_SOURCES
}
const sourcesFor = (platform: NodeJS.Platform): BootstrapSources =>
  PINNED_SOURCES[platform] ?? PENDING_SOURCES
const isPinnedSourcePending = (sources: BootstrapSources): boolean =>
  Object.values(sources).some((value) => value === WINDOWS_SOURCE_PLACEHOLDER)

/** sdkmanager --licenses 的等效哈希（CI 惯例）；preview 授权 beta 镜像，一并写入 */
export const ANDROID_SDK_LICENSE_HASHES = [
  '24333f8a63b6825ea9c5514f83c2829b004d1fee',
  'd56f5187479451eabf01fb78af6dfcb131a6481e',
  '84831b9409646a918e30573bab4c9c91346d8abd'
]
const LICENSE_FILES: Record<string, string> = {
  'android-sdk-license': ANDROID_SDK_LICENSE_HASHES.slice(0, 2).join('\n'),
  'android-sdk-preview-license': ANDROID_SDK_LICENSE_HASHES[2]
}

/** bootstrap 交付的包（镜像不在此列——向导内按需下载） */
export const SDK_PACKAGES = ['platform-tools', 'emulator'] as const

/**
 * SDK 内特征路径（平台分支：win32 二进制带 .exe/.bat 后缀、JRE 无 macOS 的
 * Contents/Home 层——Temurin win zip 顶层即 jre 根；darwin 返回值与历史逐字节一致）
 */
export const sdkPaths = (
  root: string,
  platform: NodeJS.Platform = process.platform
): {
  root: string
  jreHome: string
  javaBin: string
  cmdlineToolsMarker: string
  sdkmanagerBin: string
  avdmanagerBin: string
  adbBin: string
  emulatorBin: string
  licensesDir: string
} => {
  const win = platform === 'win32'
  const jreHome = win ? join(root, 'jre') : join(root, 'jre', 'Contents', 'Home')
  const toolsBin = join(root, 'cmdline-tools', 'latest', 'bin')
  return {
    root,
    jreHome,
    javaBin: join(jreHome, 'bin', win ? 'java.exe' : 'java'),
    cmdlineToolsMarker: join(toolsBin, win ? 'sdkmanager.bat' : 'sdkmanager'),
    sdkmanagerBin: join(toolsBin, win ? 'sdkmanager.bat' : 'sdkmanager'),
    avdmanagerBin: join(toolsBin, win ? 'avdmanager.bat' : 'avdmanager'),
    adbBin: join(root, 'platform-tools', win ? 'adb.exe' : 'adb'),
    emulatorBin: join(root, 'emulator', win ? 'emulator.exe' : 'emulator'),
    licensesDir: join(root, 'licenses')
  }
}

/** 解析 source.properties 的 Pkg.Revision */
const readPkgRevision = async (sourcePropertiesPath: string): Promise<string | undefined> => {
  try {
    const raw = await readFile(sourcePropertiesPath, 'utf8')
    for (const line of raw.split('\n')) {
      const [key, value] = line.split('=')
      if (key?.trim() === 'Pkg.Revision') return value?.trim()
    }
  } catch {
    return undefined
  }
  return undefined
}

const exists = async (path: string): Promise<boolean> => {
  try {
    await readFile(path)
    return true
  } catch {
    // readFile 对目录会抛 EISDIR——目录型探测单独走
    return false
  }
}

const dirExists = async (path: string): Promise<boolean> => {
  try {
    await readdir(path)
    return true
  } catch {
    return false
  }
}

export async function detectSdk(
  root: string,
  platform: NodeJS.Platform = process.platform
): Promise<SdkSnapshot> {
  const paths = sdkPaths(root, platform)
  const [jrePresent, cmdlineToolsPresent, adbPresent, emulatorPresent] = await Promise.all([
    exists(paths.javaBin),
    exists(paths.cmdlineToolsMarker),
    exists(paths.adbBin),
    exists(paths.emulatorBin)
  ])
  const [cmdlineToolsVersion, platformToolsVersion, emulatorVersion] = await Promise.all([
    cmdlineToolsPresent
      ? readPkgRevision(join(root, 'cmdline-tools', 'latest', 'source.properties'))
      : undefined,
    adbPresent ? readPkgRevision(join(root, 'platform-tools', 'source.properties')) : undefined,
    emulatorPresent ? readPkgRevision(join(root, 'emulator', 'source.properties')) : undefined
  ])
  const licensed =
    (await exists(join(paths.licensesDir, 'android-sdk-license'))) &&
    (await exists(join(paths.licensesDir, 'android-sdk-preview-license')))
  return {
    root,
    jre: { present: jrePresent },
    cmdlineTools: { present: cmdlineToolsPresent, version: cmdlineToolsVersion },
    platformTools: { present: adbPresent, version: platformToolsVersion },
    emulator: { present: emulatorPresent, version: emulatorVersion },
    licensed
  }
}

/** 缺什么按什么顺序补：许可 → JRE → cmdline-tools → sdkmanager 装两包 */
export function planBootstrap(snapshot: SdkSnapshot): SdkComponentName[] {
  const steps: SdkComponentName[] = []
  if (!snapshot.licensed) steps.push('licenses')
  if (!snapshot.jre.present) steps.push('jre')
  if (!snapshot.cmdlineTools.present) steps.push('cmdline-tools')
  if (!snapshot.platformTools.present) steps.push('platform-tools')
  if (!snapshot.emulator.present) steps.push('emulator')
  return steps
}

export async function writeLicenseFiles(
  root: string,
  files: Record<string, string> = LICENSE_FILES
): Promise<void> {
  const paths = sdkPaths(root)
  await mkdir(paths.licensesDir, { recursive: true })
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(paths.licensesDir, name), `${content}\n`, 'utf8')
  }
}

/** sdkmanager 进度行解析：`[===  12%] Doing...` → 12 */
export const parseSdkManagerPercent = (line: string): number | undefined => {
  const match = line.match(/\b(\d{1,3})\s*%/)
  if (!match) return undefined
  const value = Number(match[1])
  return value >= 0 && value <= 100 ? value : undefined
}

export interface BootstrapSources {
  jreUrl: string
  jreSha256: string
  cmdlineToolsUrl: string
  cmdlineToolsSha1: string
}

export interface BootstrapDeps {
  /** 平台接缝（默认 process.platform；单测注入 win32 走 Windows 分支） */
  platform?: NodeJS.Platform
  /** 钉版下载源（默认按平台查内置表；测试注入假源） */
  sources?: BootstrapSources
  /** 下载器接缝：默认全局 fetch */
  fetcher?: (url: string) => Promise<Buffer>
  /** 解压接缝：默认系统 bsdtar（macOS 自带，zip/tar.gz 通吃）；dest 必须已存在 */
  unpacker?: (archive: Buffer, dest: string) => Promise<void>
  /** sdkmanager 接缝：默认真实 spawn；实现负责进度回调 */
  runner?: (root: string, packages: string[], onPercent: (percent: number) => void) => Promise<void>
}

const defaultFetcher = async (url: string): Promise<Buffer> => {
  // netFetch：系统代理下的引导下载（issue 2026-10-09）；接缝注入不变
  const response = await netFetch(url)
  if (!response.ok) throw new Error(msg('downloadHttpFailed', { status: response.status, url }))
  return Buffer.from(await response.arrayBuffer())
}

const verifyChecksum = (buffer: Buffer, expected: string, algorithm: 'sha256' | 'sha1'): void => {
  const actual = createHash(algorithm).update(buffer).digest('hex')
  if (actual !== expected) {
    throw new Error(
      msg('checksumMismatch', {
        algorithm,
        expected: expected.slice(0, 16),
        actual: actual.slice(0, 16)
      })
    )
  }
}

// bsdtar 对 zip 需要可寻址输入——先落临时文件再解压（macOS 自带 tar 即 bsdtar，zip/tar.gz 通吃）
const defaultUnpacker = async (archive: Buffer, dest: string): Promise<void> => {
  const archivePath = join(dest, '.archive.bin')
  await writeFile(archivePath, archive)
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawnCommand({}, tarBinFor(), ['-xf', archivePath, '-C', dest], {
        stdio: ['ignore', 'ignore', 'pipe']
      })
      const stderr: Buffer[] = []
      child.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk))
      child.on('error', reject)
      child.on('close', (code) => {
        if (code === 0) resolve()
        else {
          reject(
            new Error(
              msg('sdkExtractFailed', {
                code: String(code),
                tail: Buffer.concat(stderr).toString('utf8').slice(-400)
              })
            )
          )
        }
      })
    })
  } finally {
    await rm(archivePath, { force: true })
  }
}

/** sdkmanager 跑包（镜像下载复用）：进度行解析为 0-100 */
export async function runSdkManagerPackages(
  root: string,
  packages: string[],
  onPercent: (percent: number) => void
): Promise<void> {
  // 注意：sdkmanager 在非 TTY 管道下 stdout 全缓冲，且新版非交互无进度行——
  // 镜像下载已改走 manifest 直连（downloader.ts，plan 2026-10-06-download-progress-zero），
  // 此执行体的 onPercent 对镜像包不会收到中间值；仅 bootstrap 等场景继续使用。
  return defaultRunner(root, packages, onPercent)
}

/** 卸载有界超时：本地卸载通常秒级，3 分钟足够覆盖首次 JVM 慢启动 */
const UNINSTALL_TIMEOUT_MS = 180_000

export interface UninstallDeps {
  /** 执行器接缝：默认 spawn sdkmanager --uninstall；单测注入固定结果或错误 */
  runner?: (sdkmanagerBin: string, args: string[], env: NodeJS.ProcessEnv) => Promise<void>
  /** 有界超时（默认 180s；对注入 runner 同样生效——超时只拒绝，不 kill 注入进程） */
  timeoutMs?: number
}

/**
 * 卸载单个已装包（plan 2026-10-06-image-uninstall）：官方 `--uninstall` 路径，
 * env 与安装一致。卸载后的落盘复核由调用方（IPC 守卫链）负责——此处只管进程。
 * 超时双保险：默认 runner 内部计时器负责 kill 真实子进程；包装层 race 对
 * 注入 runner 也强制有界（review 遗留项）。
 */
export async function uninstallSdkManagerPackage(
  root: string,
  packageName: string,
  deps: UninstallDeps = {}
): Promise<void> {
  const paths = sdkPaths(root)
  const timeoutMs = deps.timeoutMs ?? UNINSTALL_TIMEOUT_MS
  const run =
    deps.runner ??
    ((bin: string, args: string[], env: NodeJS.ProcessEnv): Promise<void> =>
      new Promise((resolve, reject) => {
        const child = spawnCommand({}, bin, args, { env, stdio: ['ignore', 'pipe', 'pipe'] })
        // stdout 也收：sdkmanager 偶尔把错误写 stdout（review P3）
        const output: Buffer[] = []
        child.stdout?.on('data', (chunk: Buffer) => output.push(chunk))
        child.stderr?.on('data', (chunk: Buffer) => output.push(chunk))
        // 有界超时：sdkmanager 挂死不再永久占住删除互斥（review P3）
        const timer = setTimeout(() => {
          child.kill('SIGTERM')
          reject(
            new Error(
              msg('sdkUninstallTimeoutKilled', { pkg: packageName, seconds: timeoutMs / 1000 })
            )
          )
        }, timeoutMs)
        child.on('error', (error) => {
          clearTimeout(timer)
          reject(error)
        })
        child.on('close', (code) => {
          clearTimeout(timer)
          if (code === 0) return resolve()
          reject(
            new Error(
              msg('sdkUninstallFailed', {
                pkg: packageName,
                code: String(code),
                tail: Buffer.concat(output).toString('utf8').slice(-500)
              })
            )
          )
        })
      }))
  const runPromise = Promise.resolve(
    run(paths.sdkmanagerBin, ['--sdk_root', root, '--uninstall', packageName], sdkManagerEnv(root))
  )
  // 超时赢时 runPromise 的迟到拒绝不再冒泡为 unhandled
  runPromise.catch(() => undefined)
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(msg('sdkUninstallTimeout', { pkg: packageName, seconds: timeoutMs / 1000 }))
        ),
      timeoutMs
    )
  })
  try {
    await Promise.race([runPromise, timeout])
  } finally {
    clearTimeout(timer)
  }
}

/** 默认 sdkmanager：stdout 逐行喂给 onPercent（进度行重复出现，取最后一次即可） */
const defaultRunner = async (
  root: string,
  packages: string[],
  onPercent: (percent: number) => void
): Promise<void> => {
  const paths = sdkPaths(root)
  await new Promise<void>((resolve, reject) => {
    const child = spawnCommand({}, paths.sdkmanagerBin, ['--sdk_root', root, ...packages], {
      env: sdkManagerEnv(root),
      stdio: ['ignore', 'pipe', 'pipe']
    })
    const stderr: Buffer[] = []
    child.stdout?.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString('utf8').split('\r')) {
        const percent = parseSdkManagerPercent(line)
        if (percent !== undefined) onPercent(percent)
      }
    })
    child.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk))
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve()
      else {
        reject(
          new Error(
            msg('sdkInstallFailed', {
              packages: packages.join(' '),
              code: String(code),
              tail: Buffer.concat(stderr).toString('utf8').slice(-500)
            })
          )
        )
      }
    })
  })
}

const sdkManagerEnv = (root: string): NodeJS.ProcessEnv => {
  const paths = sdkPaths(root)
  return {
    ...process.env,
    JAVA_HOME: paths.jreHome,
    ANDROID_SDK_ROOT: root,
    ANDROID_HOME: root,
    // android-user 恒定应用数据目录（issue 2026-10-11 问题三）——不随 SDK 根
    ANDROID_USER_HOME: androidUserHomeFor(),
    ANDROID_PREFS_ROOT: androidUserHomeFor()
  }
}

/**
 * bootstrap 编排：缺什么补什么（顺序 = planBootstrap）。
 * 每一步先落 .tmp 再原子改名，失败清走临时目录，不留半个组件。
 */
export async function bootstrapSdk(
  root: string,
  deps: BootstrapDeps = {},
  onProgress: (progress: SdkProgress) => void = () => {}
): Promise<SdkSnapshot> {
  const fetcher = deps.fetcher ?? defaultFetcher
  const unpacker = deps.unpacker ?? defaultUnpacker
  const runner = deps.runner ?? defaultRunner
  const platform = deps.platform ?? process.platform
  const sources = deps.sources ?? sourcesFor(platform)
  // win32 钉版值待真机实测（见文件头注释）——占位期间显式拒绝，防止带占位值真跑
  if (isPinnedSourcePending(sources)) {
    throw new Error(msg('sdkWindowsSourcePending'))
  }

  const snapshot = await detectSdk(root, platform)
  const steps = planBootstrap(snapshot)
  if (steps.length === 0) {
    onProgress({ stage: 'done', percent: 100, message: msg('sdkAlreadyReady') })
    return snapshot
  }

  await mkdir(root, { recursive: true })
  await mkdir(androidUserHomeFor(), { recursive: true })

  if (steps.includes('licenses')) {
    onProgress({ stage: 'licenses', message: msg('sdkStepLicense') })
    await writeLicenseFiles(root)
  }

  if (steps.includes('jre')) {
    onProgress({ stage: 'jre', message: msg('sdkStepDownloadJre') })
    const archive = await fetcher(sources.jreUrl)
    verifyChecksum(archive, sources.jreSha256, 'sha256')
    const tmp = join(root, '.tmp-jre')
    await rm(tmp, { recursive: true, force: true })
    await mkdir(tmp, { recursive: true })
    try {
      onProgress({ stage: 'jre', message: msg('sdkStepExtractJre') })
      await unpacker(archive, tmp)
      // Temurin 布局随平台：mac tar 解出 <version>-jre/Contents/…（归位 Contents 到
      // <root>/jre/Contents）；win zip 顶层 <version>-jre/ 即 jre 根（无 Contents 层）
      const children = await readdir(tmp)
      const top = children.find((name) => !name.startsWith('.'))
      if (!top) throw new Error(msg('jreArchiveNoTopDir'))
      await rm(join(root, 'jre'), { recursive: true, force: true })
      if (platform === 'win32') {
        await renameResilient(join(tmp, top), join(root, 'jre'))
      } else {
        await mkdir(join(root, 'jre'), { recursive: true })
        await renameResilient(join(tmp, top, 'Contents'), join(root, 'jre', 'Contents'))
      }
    } finally {
      await rm(tmp, { recursive: true, force: true })
    }
  }

  if (steps.includes('cmdline-tools')) {
    onProgress({ stage: 'cmdline-tools', message: msg('sdkStepDownloadCmdline') })
    const archive = await fetcher(sources.cmdlineToolsUrl)
    verifyChecksum(archive, sources.cmdlineToolsSha1, 'sha1')
    const tmp = join(root, '.tmp-cmdline-tools')
    await rm(tmp, { recursive: true, force: true })
    await mkdir(tmp, { recursive: true })
    try {
      onProgress({ stage: 'cmdline-tools', message: msg('sdkStepExtractCmdline') })
      await unpacker(archive, tmp)
      await rm(join(root, 'cmdline-tools'), { recursive: true, force: true })
      const children = await readdir(tmp)
      if (children.includes('cmdline-tools')) {
        // 官方 zip 自带顶层 cmdline-tools/——归位为 cmdline-tools/latest
        await mkdir(join(root, 'cmdline-tools'), { recursive: true })
        await renameResilient(join(tmp, 'cmdline-tools'), join(root, 'cmdline-tools', 'latest'))
      } else {
        await renameResilient(tmp, join(root, 'cmdline-tools', 'latest'))
      }
    } finally {
      await rm(tmp, { recursive: true, force: true })
    }
  }

  const missingPackages = SDK_PACKAGES.filter((name) => {
    if (name === 'platform-tools') return !snapshot.platformTools.present
    return !snapshot.emulator.present
  })
  for (const pkg of missingPackages) {
    onProgress({
      stage: pkg as SdkComponentName,
      percent: 0,
      message: msg('sdkStepInstall', { pkg })
    })
    await runner(root, [pkg], (percent) => {
      onProgress({
        stage: pkg as SdkComponentName,
        percent,
        message: msg('sdkStepInstall', { pkg })
      })
    })
  }

  const done = await detectSdk(root, platform)
  onProgress({ stage: 'done', percent: 100, message: msg('sdkStepDone') })
  return done
}

/** 目录级组件探测（detectSdk 之外的补充探测：镜像目录等） */
export const dirPresent = dirExists
