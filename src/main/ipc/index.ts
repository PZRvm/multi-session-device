import { registerDialogIpc } from '../dialog'
import {
  assertEditorTarget,
  attachDeviceStreamBridge,
  adbBinaryPath,
  androidToolEnv,
  currentDeviceSnapshot,
  listDeviceNamesReferencing,
  savedDeviceSkinRef,
  registerDevicesIpc
} from '../devices'
import { createLogcatManager } from '../logcat'
import { registerSdkIpc } from '../emulator'
import { createScrcpyManager } from '../scrcpy'
import { registerWizardIpc } from '../window/wizard'
import { registerSettingsIpc } from '../window/settings'
import { registerLogcatIpc, isLogcatWindowSender } from '../window/logcat'
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
  registerSettingsIpc()
  registerLogcatIpc()
  registerThemeIpc()
  registerLocaleIpc()

  const scrcpy = createScrcpyManager({
    adbPath: adbBinaryPath,
    toolEnv: androidToolEnv,
    getMainWindow,
    isMainSender: (sender) => getMainWindow()?.webContents.id === sender.id
  })
  scrcpy.registerIpc()

  const logcat = createLogcatManager({
    adbPath: adbBinaryPath,
    toolEnv: androidToolEnv,
    snapshot: currentDeviceSnapshot,
    isLogcatWindow: isLogcatWindowSender
  })
  logcat.registerIpc()

  // 扫尾流会话：投屏与日志两域并行销毁
  streamShutdown = () =>
    Promise.all([scrcpy.destroyAll(), logcat.destroyAll()]).then(() => undefined)

  // runner 事件 → 流会话生命周期：running 建会话，停止/崩溃/清理销毁（beforeKill 先释放投屏与日志资源）
  attachDeviceStreamBridge({
    running: (id, runId, serial) => {
      void scrcpy.ensureSession({ id, runId, serial }).catch(() => undefined)
      logcat.ensureSession({ id, runId, serial })
    },
    stopped: (id) => {
      void scrcpy.destroySession(id)
      void logcat.destroySession(id)
    },
    beforeKill: (id) =>
      Promise.all([scrcpy.destroySession(id), logcat.destroySession(id)]).then(() => undefined)
  })
}
