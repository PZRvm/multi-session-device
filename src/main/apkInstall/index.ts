import { ipcMain } from 'electron'
import { basename } from 'node:path'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import type { ApkInstallResult } from '@shared/types'
import type { ErrorsCopy } from '@shared/i18n'
import { msg } from '../locale'
import { runAdb, type AdbRunResult } from '../emulator/adb'

// 拖拽 APK 安装域（plan 2026-10-10-drag-apk-install）：renderer 把 .apk 拖进画布，
// main 校验 running + serial 后走 `adb -s <serial> install -r`；每设备串行，
// 结果一次返回（adb 不产出百分比，无进度推送）。签名 → 词条映射，原文附详情。

/** stderr/stdout 失败签名 → 错误键；未命中走 apkInstallFailed（原文一律附详情） */
const FAILURE_SIGNATURES: Array<{ match: RegExp; key: keyof ErrorsCopy }> = [
  { match: /INSTALL_FAILED_UPDATE_INCOMPATIBLE/, key: 'apkInstallSignatureMismatch' },
  { match: /INSTALL_FAILED_INSUFFICIENT_STORAGE/, key: 'apkInstallNoSpace' },
  { match: /INSTALL_FAILED_OLDER_SDK/, key: 'apkInstallOlderSdk' },
  { match: /INSTALL_FAILED_TEST_ONLY/, key: 'apkInstallTestOnly' },
  { match: /INSTALL_PARSE_FAILED_NOT_APK/, key: 'apkInstallNotApk' }
]

/** 组装失败文案：现代 adb 的失败原因在 stdout（Failure [REASON]），stderr 兜底 */
const installFailureMessage = (result: AdbRunResult): string => {
  const output = `${result.stdout}\n${result.stderr}`.trim()
  const detail = output.length > 0 ? output : `exit ${result.code}`
  for (const signature of FAILURE_SIGNATURES) {
    if (signature.match.test(output)) return msg(signature.key, { detail })
  }
  return msg('apkInstallFailed', { detail })
}

export interface ApkInstallDeps {
  /** adb 可执行路径（devices 域运行时解析，含 PATH/共享 SDK 兜底） */
  adbPath: () => string
  /** 断言设备 running 并返回 serial（devices 域注入；未 running 抛本地化错误） */
  serialOf: (id: string) => string
  /** 仅主窗可发起（拖放目标只在主窗画布） */
  isMainSender: (sender: { id: number }) => boolean
  /** 可注入的 adb 执行器（测试替身；默认 runAdb） */
  run?: typeof runAdb
}

interface ApkInstallInput {
  deviceId: string
  filePath: string
}

const isInstallInput = (raw: unknown): raw is ApkInstallInput =>
  typeof raw === 'object' &&
  raw !== null &&
  typeof (raw as { deviceId?: unknown }).deviceId === 'string' &&
  typeof (raw as { filePath?: unknown }).filePath === 'string' &&
  (raw as ApkInstallInput).deviceId.length > 0 &&
  (raw as ApkInstallInput).filePath.length > 0

export function registerApkInstallIpc(deps: ApkInstallDeps): void {
  const run = deps.run ?? runAdb
  // 每设备串行：安装中的重复请求直接拒绝（不排队）；不同设备互不影响
  const activeDevices = new Set<string>()

  const install = async (deviceId: string, filePath: string): Promise<ApkInstallResult> => {
    const serial = deps.serialOf(deviceId)
    if (activeDevices.has(deviceId)) throw new Error(msg('apkInstallBusy'))
    activeDevices.add(deviceId)
    try {
      // timeoutMs 0 = 不设硬超时：大包安装 1–2 分钟，adb 自然返回（plan 风险表）
      const result = await run(deps.adbPath(), ['-s', serial, 'install', '-r', filePath], {
        timeoutMs: 0
      })
      if (result.code !== 0 || !result.stdout.includes('Success')) {
        throw new Error(installFailureMessage(result))
      }
      return { fileName: basename(filePath) }
    } finally {
      activeDevices.delete(deviceId)
    }
  }

  ipcMain.handle(
    IPC_CHANNELS.apkInstall,
    async (event, raw: unknown): Promise<ApkInstallResult> => {
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
      return install(raw.deviceId, raw.filePath)
    }
  )
}
