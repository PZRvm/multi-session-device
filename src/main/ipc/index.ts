import { registerDialogIpc } from '../dialog'
import {
  attachDeviceStreamBridge,
  adbBinaryPath,
  androidToolEnv,
  listDeviceNamesReferencing,
  registerDevicesIpc
} from '../devices'
import { registerSdkIpc } from '../emulator'
import { createScrcpyManager } from '../scrcpy'
import { registerWizardIpc } from '../window/wizard'
import { registerThemeIpc } from '../theme'
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
  registerSdkIpc({ referencingDeviceNames: listDeviceNamesReferencing })
  registerWizardIpc()
  registerThemeIpc()

  const scrcpy = createScrcpyManager({
    adbPath: adbBinaryPath,
    toolEnv: androidToolEnv,
    getMainWindow,
    isMainSender: (sender) => getMainWindow()?.webContents.id === sender.id
  })
  scrcpy.registerIpc()
  streamShutdown = () => scrcpy.destroyAll()

  // runner 事件 → 流会话生命周期：running 建会话，停止/崩溃/清理销毁（beforeKill 先释放投屏资源）
  attachDeviceStreamBridge({
    running: (id, runId, serial) => {
      void scrcpy.ensureSession({ id, runId, serial }).catch(() => undefined)
    },
    stopped: (id) => {
      void scrcpy.destroySession(id)
    },
    beforeKill: (id) => scrcpy.destroySession(id)
  })
}
