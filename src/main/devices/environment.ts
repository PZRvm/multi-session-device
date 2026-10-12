import { app } from 'electron'
import { join } from 'node:path'
import type { CreateDeviceInput, DeviceFrameKind } from '@shared/types'
import { splitPackageName } from '../emulator/catalog'
import { importedSkinsRoot } from '../emulator/skins'
import type { ReconcileDirs } from '../emulator/reconcile'
import { androidUserHomeFor } from '../emulator/androidUserHome'
import {
  candidateAdbPaths,
  listAdbSerials,
  resolveAdbExecutable,
  scrubAdbEnv,
  type AdbExecutable
} from '../emulator/adb'
import { PortAllocator, tcpProbe } from '../emulator/ports'
import { loadFrameKindIndex, type FrameKindIndex } from '../emulator/profileMetadata'
import { javaHomeFor, resolveSdkRoot } from '../emulator/sdkSource'

/** 底层错误自带建议从句的多语言标记（zh「请」/ zh-TW「請」/ en "please"） */
export const ADVICE_RE = /[請请]|please/i

/** skinRef → 皮肤目录（sdk:* 解析 SDK skins；其余查应用库）。skinRef 已按能力
 * 枚举（skinIds 白名单）归一化校验，id 来源受信扫描（uuid/目录名），无逃逸面 */
export const skinDirectoryFor = (skinRef: string): string => {
  if (skinRef.startsWith('sdk:')) {
    return join(sdkRoot(), 'skins', skinRef.slice(4))
  }
  const id = skinRef.replace(/^(imported|downloaded):/, '')
  return join(importedSkinsRoot(app.getPath('userData')), id)
}

// SDK 根经 sdkSource 统一解析（managed/custom/shared-studio；avd-home 恒在应用数据目录）
export const sdkRoot = (): string => resolveSdkRoot()
export const avdHome = (): string => join(app.getPath('userData'), 'avd-home')
export const avdDirs = (): {
  avdHome: string
  sdkRoot: string
  javaHome: string
  userHome: string
} => ({
  avdHome: avdHome(),
  sdkRoot: sdkRoot(),
  // 共享 Studio SDK 时 avdmanager 跑在 Studio JBR 上（plan 2026-10-11）；
  // android-user 恒定应用数据目录（issue 2026-10-11 问题三）
  javaHome: javaHomeFor(sdkRoot()),
  userHome: androidUserHomeFor()
})
/** 对账受控根：avd-home + SDK 根 + 应用皮肤库（skin.path 越界判定用） */
export const reconcileDirs = (): ReconcileDirs => ({
  avdHome: avdHome(),
  sdkRoot: sdkRoot(),
  skinsRoot: importedSkinsRoot(app.getPath('userData'))
})

const MAX_NAME_LENGTH = 50

export const normalizeName = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  const name = value.trim()
  if (name.length === 0 || name.length > MAX_NAME_LENGTH) return null
  return name
}

/** renderer payload 不可信，进业务前先过守卫（coding-style IPC 纪律） */
export const isCreateDeviceInput = (value: unknown): value is CreateDeviceInput => {
  if (typeof value !== 'object' || value === null) return false
  const input = value as Record<string, unknown>
  return (
    typeof input.profileId === 'string' &&
    input.profileId.length > 0 &&
    typeof input.profileLabel === 'string' &&
    input.profileLabel.length > 0 &&
    typeof input.imagePackageName === 'string' &&
    splitPackageName(input.imagePackageName) !== null &&
    normalizeName(input.name) !== null &&
    (input.advancedSettings === null ||
      input.advancedSettings === undefined ||
      typeof input.advancedSettings === 'object')
  )
}

export const isRenameInput = (value: unknown): value is { id: string; name: string } => {
  if (typeof value !== 'object' || value === null) return false
  const input = value as Record<string, unknown>
  return typeof input.id === 'string' && input.id.length > 0 && normalizeName(input.name) !== null
}

export const isDeviceIdInput = (value: unknown): value is { id: string } => {
  if (typeof value !== 'object' || value === null) return false
  const input = value as Record<string, unknown>
  return typeof input.id === 'string' && input.id.length > 0
}

// ---- 共享 adb 可执行文件（解析一次；start 前经 ensureSharedServer 验兼容）----

let adbExecutable: AdbExecutable | null = null
export const requireAdb = async (): Promise<AdbExecutable> => {
  if (!adbExecutable) {
    adbExecutable = await resolveAdbExecutable(candidateAdbPaths(sdkRoot()))
  }
  return adbExecutable
}

export const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

/** scrcpy 会话与 runner 共用：已解析的 adb 二进制（未解析时回落应用自有路径） */
export const adbBinaryPath = (): string =>
  adbExecutable?.path ?? join(sdkRoot(), 'platform-tools', 'adb')

/** 工具子进程统一环境：SDK 与用户目录全部指进应用自有目录（architecture 隔离不变量） */
export const androidToolEnv = (): NodeJS.ProcessEnv =>
  scrubAdbEnv({
    ...process.env,
    ANDROID_SDK_ROOT: sdkRoot(),
    ANDROID_HOME: sdkRoot(),
    ANDROID_AVD_HOME: avdHome(),
    ANDROID_USER_HOME: androidUserHomeFor(),
    ANDROID_EMULATOR_HOME: androidUserHomeFor()
  })

export const ports = new PortAllocator({
  probeTcp: tcpProbe,
  // server 尚不可用时按无外部登记处理，spawn 前还有一道 serial 检查兜底
  adbSerials: async () => {
    try {
      return await listAdbSerials((await requireAdb()).path)
    } catch {
      return new Set<string>()
    }
  }
})

// ---- 画像外观索引（派生展示提示，不入盘）：SDK 缺失/解析失败收敛为空索引 ----
let frameIndex: FrameKindIndex | null = null

/** 每次调用重验 JAR stat（SDK 更新后自动失效重建）；loadFrameKindIndex 内部全兜底不抛 */
export const ensureFrameIndex = async (): Promise<void> => {
  frameIndex = await loadFrameKindIndex(sdkRoot())
}

export const frameKindOf = (profileId: string): DeviceFrameKind | undefined =>
  frameIndex?.lookup(profileId)

/** legacy 摄像头键解析：known 模式直映射（virtualscene 接纳小写与历史 camelCase），
 *  webcamN 保留资源 id，其余不可识别（启动仲裁与编辑草稿共用单源） */
export const parseLegacyCamera = (
  text: string | undefined
): { mode: 'none' | 'emulated' | 'virtualScene' | 'webcam'; deviceId: string | null } | null => {
  if (text === 'none' || text === 'emulated') {
    return { mode: text, deviceId: null }
  }
  if (text === 'virtualscene' || text === 'virtualScene') {
    return { mode: 'virtualScene', deviceId: null }
  }
  if (text !== undefined && /^webcam\d+$/.test(text)) {
    return { mode: 'webcam', deviceId: text }
  }
  return null
}
