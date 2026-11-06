import { adbRecovery } from '../emulator/adbRecovery'
import { ipcMain } from 'electron'
import { basename } from 'node:path'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import type { ApkInstallOutcome } from '@shared/types'
import type { ErrorsCopy } from '@shared/i18n'
import { msg } from '../locale'
import { runAdb, type AdbRunResult } from '../emulator/adb'

// 拖拽 APK 安装域（plan 2026-10-10-drag-apk-install；真机扩展 2026-10-13-real-device-usb-and-apk-install）：
// renderer 把 .apk 拖进画布，main 校验 serial 后走 `adb -s <serial> install`；每设备串行，
// 结果一次返回（adb 不产出百分比，无进度推送）。签名 → 词条映射，原文附详情。
// serial 断言由注入的 serialOf 决定（真机 connected 或 AVD running，组合查询）。

/** stderr/stdout 失败签名 → 错误键；未命中走 apkInstallFailed（原文一律附详情） */
const FAILURE_SIGNATURES: Array<{ match: RegExp; key: keyof ErrorsCopy }> = [
  { match: /INSTALL_FAILED_UPDATE_INCOMPATIBLE/, key: 'apkInstallSignatureMismatch' },
  { match: /INSTALL_FAILED_INSUFFICIENT_STORAGE/, key: 'apkInstallNoSpace' },
  { match: /INSTALL_FAILED_OLDER_SDK/, key: 'apkInstallOlderSdk' },
  { match: /INSTALL_FAILED_TEST_ONLY/, key: 'apkInstallTestOnly' },
  { match: /INSTALL_PARSE_FAILED_NOT_APK/, key: 'apkInstallNotApk' },
  // 真机特有面：MIUI/HyperOS 拦「USB 安装」（只词条引导，设备侧开关无 adb 通路）；
  // Android 14+ 拒装 targetSdk<23（唯一可经旗标重试的失败，「仍要安装」A 案）
  { match: /INSTALL_FAILED_USER_RESTRICTED/, key: 'apkInstallUserRestricted' },
  { match: /INSTALL_FAILED_DEPRECATED_SDK_VERSION/, key: 'apkInstallDeprecatedSdk' }
]

/** 匹配失败签名：message 给 renderer 展示；deprecatedSdk 决定「仍要安装」可用性 */
const matchFailure = (result: AdbRunResult): { message: string; deprecatedSdk: boolean } => {
  const output = `${result.stdout}\n${result.stderr}`.trim()
  const detail = output.length > 0 ? output : `exit ${result.code}`
  for (const signature of FAILURE_SIGNATURES) {
    if (signature.match.test(output)) {
      return {
        message: msg(signature.key, { detail }),
        deprecatedSdk: signature.key === 'apkInstallDeprecatedSdk'
      }
    }
  }
  return { message: msg('apkInstallFailed', { detail }), deprecatedSdk: false }
}

export interface ApkInstallDeps {
  /** adb 可执行路径（devices 域运行时解析，含 PATH/共享 SDK 兜底） */
  adbPath: () => string
  /** 断言设备可安装并返回 serial（devices 域组合查询注入；不可安装抛本地化错误） */
  serialOf: (id: string) => string
  /** 仅主窗可发起（拖放目标只在主窗画布） */
  isMainSender: (sender: { id: number }) => boolean
  /** 可注入的 adb 执行器（测试替身；默认 runAdb） */
  run?: typeof runAdb
}

interface ApkInstallInput {
  deviceId: string
  filePath: string
  /** 「仍要安装」重试链路：true 时插入 --bypass-low-target-sdk-block（platform-tools 34+） */
  allowLowTargetSdk?: boolean
}

const isInstallInput = (raw: unknown): raw is ApkInstallInput => {
  if (typeof raw !== 'object' || raw === null) return false
  const value = raw as Record<string, unknown>
  return (
    typeof value['deviceId'] === 'string' &&
    (value['deviceId'] as string).length > 0 &&
    typeof value['filePath'] === 'string' &&
    (value['filePath'] as string).length > 0 &&
    (value['allowLowTargetSdk'] === undefined || typeof value['allowLowTargetSdk'] === 'boolean')
  )
}

export function registerApkInstallIpc(deps: ApkInstallDeps): {
  isBusy: () => boolean
  isDeviceBusy: (deviceId: string) => boolean
} {
  const run = deps.run ?? runAdb
  // 每设备串行：安装中的重复请求直接拒绝（不排队）；不同设备互不影响
  const activeDevices = new Set<string>()

  const install = async (input: ApkInstallInput): Promise<ApkInstallOutcome> => {
    adbRecovery.assertOpen()
    const { deviceId, filePath, allowLowTargetSdk } = input
    const serial = deps.serialOf(deviceId)
    if (activeDevices.has(deviceId)) throw new Error(msg('apkInstallBusy'))
    activeDevices.add(deviceId)
    try {
      // timeoutMs 0 = 不设硬超时：大包安装 1–2 分钟，adb 自然返回（plan 风险表）
      const args = ['-s', serial, 'install']
      if (allowLowTargetSdk) args.push('--bypass-low-target-sdk-block')
      args.push('-r', filePath)
      const result = await run(deps.adbPath(), args, { timeoutMs: 0 })
      if (result.code !== 0 || !result.stdout.includes('Success')) {
        // 安装失败是「结果」不是「错误」：renderer 失败卡据 canBypass 出「仍要安装」
        const failure = matchFailure(result)
        return {
          ok: false,
          message: failure.message,
          canBypassLowTargetSdk: failure.deprecatedSdk && !allowLowTargetSdk
        }
      }
      return { ok: true, fileName: basename(filePath) }
    } finally {
      activeDevices.delete(deviceId)
    }
  }

  ipcMain.handle(
    IPC_CHANNELS.apkInstall,
    async (event, raw: unknown): Promise<ApkInstallOutcome> => {
      if (!deps.isMainSender(event.sender)) {
        throw new Error(`${IPC_CHANNELS.apkInstall}: ${msg('unregisteredWindowSuffix')}`)
      }
      if (!isInstallInput(raw)) {
        throw new Error(`${IPC_CHANNELS.apkInstall}${msg('invalidPayload')}`)
      }
      // .apk 后缀守卫不能只设在 renderer 一层（hook 拦非 apk，main 对直连调用兜底）；
      // 复用 adb 的 INSTALL_PARSE_FAILED_NOT_APK 文案，detail 带路径
      if (!/\.apk$/i.test(raw.filePath)) {
        throw new Error(msg('apkInstallNotApk', { detail: raw.filePath }))
      }
      return install(raw)
    }
  )
  return {
    isBusy: () => activeDevices.size > 0,
    isDeviceBusy: (deviceId) => activeDevices.has(deviceId)
  }
}
