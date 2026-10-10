import { registerDialogIpc } from '../dialog'
import {
  assertEditorTarget,
  attachDeviceStreamBridge,
  adbBinaryPath,
  androidToolEnv,
  listDeviceNamesReferencing,
  runningDeviceRef,
  runningDeviceSerial,
  savedDeviceSkinRef,
  registerDevicesIpc
} from '../devices'
import { registerSdkIpc } from '../emulator'
import { registerApkInstallIpc } from '../apkInstall'
import { createScrcpyManager } from '../scrcpy'
import { registerScreenshotIpc, clearScreenshotCache } from '../screenshot'
import { registerWizardIpc } from '../window/wizard'
import { registerSettingsIpc } from '../window/settings'
import { registerThemeIpc } from '../theme'
import { registerLocaleIpc } from '../locale'
import { getMainWindow } from '../window'

// 退出清理的接缝：main/index 在 before-quit 时调用（先 devices 停实例，再扫尾流会话）
let streamShutdown: (() => Promise<void>) | null = null

export async function shutdownStreams(): Promise<void> {
  if (streamShutdown) await streamShutdown()
}

export function registerIpcHandlers(): void {
  registerDialogIpc()
  registerDevicesIpc()
  // 引用查询经注入进入 sdk 域（镜像删除守卫）——emulator 域不反向依赖 devices
  registerSdkIpc({ referencingDeviceNames: listDeviceNamesReferencing, savedDeviceSkinRef })
  // 编辑窗目标核验经注入进入向导域（开窗前 devices 域裁决，避免 wizard 反向依赖）
  registerWizardIpc({ assertEditorTarget })
  // 拖拽 APK 安装：running/serial 断言经注入（安装域不反向依赖 devices）；仅主窗可发起
  registerApkInstallIpc({
    adbPath: adbBinaryPath,
    serialOf: runningDeviceSerial,
    isMainSender: (sender) => getMainWindow()?.webContents.id === sender.id
  })
  registerSettingsIpc()
  registerThemeIpc()
  registerLocaleIpc()

  const scrcpy = createScrcpyManager({
    adbPath: adbBinaryPath,
    toolEnv: androidToolEnv,
    getMainWindow,
    isMainSender: (sender) => getMainWindow()?.webContents.id === sender.id
  })
  scrcpy.registerIpc()
  streamShutdown = () => scrcpy.destroyAll()

  // 截屏域（plan 2026-10-10）：running 校验经注入进入 devices 域，域自身不反向依赖
  registerScreenshotIpc({
    adbPath: adbBinaryPath,
    runningDevice: runningDeviceRef,
    isMainSender: (sender) => getMainWindow()?.webContents.id === sender.id
  })

  // runner 事件 → 流会话生命周期：running 建会话，停止/崩溃/清理销毁（beforeKill 先释放投屏资源）。
  // 截屏缓存同桥收尾：设备停止/清理时最近一张作废（save 拒绝 stale，不留残留图）
  attachDeviceStreamBridge({
    running: (id, runId, serial) => {
      void scrcpy.ensureSession({ id, runId, serial }).catch(() => undefined)
    },
    stopped: (id) => {
      clearScreenshotCache(id)
      void scrcpy.destroySession(id)
    },
    beforeKill: (id) => {
      clearScreenshotCache(id)
      return scrcpy.destroySession(id)
    }
  })
}
