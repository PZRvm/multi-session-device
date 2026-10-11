import { spawn } from 'node:child_process'
import { access, readdir, readFile, realpath } from 'node:fs/promises'
import { constants } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { StudioSdkDetection } from '@shared/types'

/**
 * Android Studio / SDK 检测链（plan 2026-10-11-sdk-source-switching §5，
 * 调研 think-report 20261009022552 方案 A+B）：候选链逐级核验后才采纳——
 * Studio 配置文件 → 环境变量 → 平台默认目录 → PATH 上 adb 反推。
 * 结果区分两层：studioFound（Studio 本体在场——驱动共享选项禁用态）与
 * sdkCandidate（SDK 路径定位成功）。全部 IO 经接缝注入，可单测。
 * 一期 macOS：/Applications 扫描 + mdfind 兜底；Windows 分支真机验证滞后属已知约束。
 */

export type SdkCandidateSource = NonNullable<StudioSdkDetection['candidateSource']>

export interface StudioDetectDeps {
  /** 目录列举接缝（默认 fs/promises.readdir；缺失目录抛错由默认实现转空表） */
  listDir?: (path: string) => Promise<string[]>
  /** 文件读接缝（默认 fs/promises.readFile utf8） */
  readFile?: (path: string) => Promise<string>
  /** 文件存在接缝（默认 access F_OK） */
  fileExists?: (path: string) => Promise<boolean>
  /** 主目录（默认 os.homedir） */
  homedir?: () => string
  /** 环境变量（默认 process.env） */
  env?: Record<string, string | undefined>
  /** Spotlight 兜底（默认 spawn mdfind 带 3s 超时；Studio 目录扫描无果才用） */
  mdfind?: (query: string) => Promise<string[]>
  /** PATH 上 adb 反推（默认扫 PATH 各目录；返回 adb 绝对路径或 null） */
  adbOnPath?: () => Promise<string | null>
}

const defaultListDir = async (path: string): Promise<string[]> => {
  try {
    return await readdir(path)
  } catch {
    return []
  }
}

const defaultFileExists = async (path: string): Promise<boolean> => {
  try {
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}

const MDFIND_TIMEOUT_MS = 3_000

const defaultMdfind = (query: string): Promise<string[]> =>
  new Promise((resolve) => {
    const child = spawn('mdfind', [query], { stdio: ['ignore', 'pipe', 'ignore'] })
    const out: Buffer[] = []
    const timer = setTimeout(() => child.kill('SIGKILL'), MDFIND_TIMEOUT_MS)
    child.stdout?.on('data', (chunk: Buffer) => out.push(chunk))
    const finish = (): void => {
      clearTimeout(timer)
      resolve(
        Buffer.concat(out)
          .toString('utf8')
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line.length > 0)
      )
    }
    child.on('error', finish)
    child.on('close', finish)
  })

const defaultAdbOnPath = async (
  deps: Pick<StudioDetectDeps, 'env' | 'fileExists'>
): Promise<string | null> => {
  const pathValue = deps.env?.PATH ?? process.env.PATH ?? ''
  for (const dir of pathValue.split(':')) {
    if (dir.length === 0) continue
    const candidate = join(dir, 'adb')
    if (await defaultFileExists(candidate)) return candidate
  }
  return null
}

/** SDK 根核验：platform-tools 或 licenses 在场（研究既定口径） */
const looksLikeSdkRoot = async (
  path: string,
  fileExists: (path: string) => Promise<boolean>
): Promise<boolean> =>
  (await fileExists(join(path, 'platform-tools', 'adb'))) ||
  (await fileExists(join(path, 'licenses', 'android-sdk-license')))

const STUDIO_APP_RE = /^Android Studio[^/]*\.app$/i

/** Studio 应用目录扫描（/Applications 与 ~/Applications；名字序取首个匹配） */
const scanStudioApps = async (
  listDir: (path: string) => Promise<string[]>,
  home: string
): Promise<string[]> => {
  const found: string[] = []
  for (const base of ['/Applications', join(home, 'Applications')]) {
    const names = await listDir(base)
    const hit = names
      .filter((name) => STUDIO_APP_RE.test(name))
      .sort()
      .map((name) => join(base, name))
    found.push(...hit)
  }
  return found
}

/** 配置目录按版本号降序（AndroidStudio2024.3 > AndroidStudio2023.2 > 残留旧版） */
const newestConfigFirst = (names: string[]): string[] =>
  [...names].sort((a, b) => {
    const versionOf = (name: string): number[] =>
      (name.match(/\d+(\.\d+)*/g) ?? []).map((part) => Number.parseFloat(part))
    const va = versionOf(a)
    const vb = versionOf(b)
    for (let i = 0; i < Math.max(va.length, vb.length); i += 1) {
      const diff = (vb[i] ?? -1) - (va[i] ?? -1)
      if (diff !== 0) return diff
    }
    return b.localeCompare(a)
  })

const OPTIONS_FILE_CAP = 40
/** 配置值「像 SDK 路径」的形状过滤（末段含 sdk 或名为 android）；候选最终仍经核验才采纳 */
const SDK_PATHISH_RE = /(?:^|[/\\])(?:[^/\\]*sdk[^/\\]*|android)$/i

/** 从 options/*.xml 提取候选 SDK 路径：value/path 属性值 → 宏展开 → 形状过滤 */
const extractConfigCandidates = (xml: string, home: string): string[] => {
  const values = [...xml.matchAll(/(?:value|path|home)="([^"]*)"/g)].map((match) => match[1])
  const expanded = values.map((value) => value.replaceAll('$USER_HOME$', home))
  return expanded.filter((value) => value.startsWith('/') && SDK_PATHISH_RE.test(value))
}

/** 检测链主体（接缝注入；纯函数风格——不碰缓存） */
export async function detectStudioAndSdk(deps: StudioDetectDeps = {}): Promise<StudioSdkDetection> {
  const listDir = deps.listDir ?? defaultListDir
  const readFileFn = deps.readFile ?? ((path: string) => readFile(path, 'utf8'))
  const fileExists = deps.fileExists ?? defaultFileExists
  const home = (deps.homedir ?? homedir)()
  const env = deps.env ?? process.env
  const defaultSdkPath = join(home, 'Library', 'Android', 'sdk')

  // ---- Studio 本体：目录扫描 → mdfind 兜底 ----
  const appCandidates = await scanStudioApps(listDir, home)
  let studioAppPath: string | null = appCandidates[0] ?? null
  if (studioAppPath === null) {
    const mdfind = deps.mdfind ?? defaultMdfind
    try {
      const hits = await mdfind('kMDItemCFBundleIdentifier="com.google.android.studio*"')
      studioAppPath = hits.find((line) => line.endsWith('.app')) ?? null
    } catch {
      studioAppPath = null
    }
  }
  const studioFound = studioAppPath !== null
  const jbrHome =
    studioAppPath !== null ? join(studioAppPath, 'Contents', 'jbr', 'Contents', 'Home') : null
  const jbrReady = jbrHome !== null && (await fileExists(join(jbrHome, 'bin', 'java')))

  // ---- SDK 候选链：逐级核验，采纳首个通过者 ----
  const verify = async (path: string | undefined): Promise<string | null> =>
    path !== undefined && path.length > 0 && (await looksLikeSdkRoot(path, fileExists))
      ? path
      : null

  // 1) Studio 配置文件（改过路径的首选线索；字段随版本漂移——提取后仍核验）
  let sdkCandidate = null as string | null
  let candidateSource: SdkCandidateSource | null = null
  const configRoot = join(home, 'Library', 'Application Support', 'Google')
  const configDirs = (await listDir(configRoot)).filter((name) => /^AndroidStudio/.test(name))
  for (const dirName of newestConfigFirst(configDirs)) {
    const optionsDir = join(configRoot, dirName, 'options')
    const files = (await listDir(optionsDir)).filter((name) => name.endsWith('.xml'))
    for (const file of files.slice(0, OPTIONS_FILE_CAP)) {
      let xml: string
      try {
        xml = await readFileFn(join(optionsDir, file))
      } catch {
        continue
      }
      for (const candidate of extractConfigCandidates(xml, home)) {
        const verified = await verify(candidate)
        if (verified !== null) {
          sdkCandidate = verified
          candidateSource = 'studio-config'
          break
        }
      }
      if (sdkCandidate !== null) break
    }
    if (sdkCandidate !== null) break
  }

  // 2) 环境变量（ANDROID_SDK_ROOT 优先）
  if (sdkCandidate === null) {
    const verified = await verify(env.ANDROID_SDK_ROOT || env.ANDROID_HOME || undefined)
    if (verified !== null) {
      sdkCandidate = verified
      candidateSource = 'env'
    }
  }

  // 3) 平台默认目录
  if (sdkCandidate === null) {
    const verified = await verify(defaultSdkPath)
    if (verified !== null) {
      sdkCandidate = verified
      candidateSource = 'default-dir'
    }
  }

  // 4) PATH 上 adb 反推（adb 路径上溯两级 = SDK 根）
  if (sdkCandidate === null) {
    const adbOnPath = deps.adbOnPath ?? (() => defaultAdbOnPath({ env, fileExists }))
    let adbPath: string | null = null
    try {
      adbPath = await adbOnPath()
    } catch {
      adbPath = null
    }
    if (adbPath !== null) {
      const verified = await verify(dirname(dirname(adbPath)))
      if (verified !== null) {
        sdkCandidate = verified
        candidateSource = 'path-adb'
      }
    }
  }

  return {
    studioFound,
    studioAppPath,
    jbrHome: jbrReady ? jbrHome : null,
    sdkCandidate,
    candidateSource,
    defaultSdkPath
  }
}

/** 选中路径与 Studio 实际 SDK 是否同一处（realpath 对比——归属判定，研究 §2.5） */
export async function isStudioSdk(
  path: string,
  detection: StudioSdkDetection | null,
  deps: Pick<StudioDetectDeps, 'fileExists'> & {
    realpathFn?: (path: string) => Promise<string>
  } = {}
): Promise<boolean> {
  if (detection === null || detection.sdkCandidate === null) return false
  if (path === detection.sdkCandidate) return true
  const realpathFn = deps.realpathFn ?? realpath
  try {
    const [a, b] = await Promise.all([realpathFn(path), realpathFn(detection.sdkCandidate)])
    return a === b
  } catch {
    return false
  }
}

// ---- 主进程缓存：设置页打开时跑一次，「重新检测」手动刷新（plan §7/§8）----

let cached: StudioSdkDetection | null = null

/** 跑检测链并刷新缓存（sdk:detect-studio 与版面自动检测共用） */
export async function runStudioDetection(deps: StudioDetectDeps = {}): Promise<StudioSdkDetection> {
  cached = await detectStudioAndSdk(deps)
  return cached
}

/** 读缓存（sdk:source-get 用——不触发扫描；未跑过为 null） */
export function getStudioDetection(): StudioSdkDetection | null {
  return cached
}

/** 测试用：清缓存 */
export function resetStudioDetectionForTest(): void {
  cached = null
}
