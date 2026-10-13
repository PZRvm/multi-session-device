import { registerDialogIpc } from '../dialog'
import {
  assertEditorTarget,
  attachDeviceStreamBridge,
  adbBinaryPath,
  androidToolEnv,
  appOwnedDeviceCount,
  deviceRefOfId,
  isDeviceActiveOfId,
  listDeviceNamesReferencing,
  listDeviceRuntimeViews,
  purgeAppOwnedDevices,
  registerExternalIpc,
  runningDeviceRef,
  savedDeviceSkinRef,
  registerDevicesIpc,
  serialOfDeviceId,
  triggerSourceChangeReconcile
} from '../devices'
import { createLogcatManager } from '../logcat'
import { registerSdkIpc, onSdkSourceChanged } from '../emulator'
import { registerApkInstallIpc } from '../apkInstall'
import { createScrcpyManager } from '../scrcpy'
import { registerScreenshotIpc, clearScreenshotCache } from '../screenshot'
import { registerNetworkIpc } from '../network'
import { registerWizardIpc } from '../window/wizard'
import { registerSettingsIpc } from '../window/settings'
import { registerLogcatIpc, isLogcatWindowSender } from '../window/logcat'
import { registerReportIpc } from '../window/report'
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
  // 来源变更 → devices 全量可用性重查（plan 2026-10-12-device-list-source-aware）：
  // 生效根变了镜像核验结果跟着变，切换后列表即时标注不可用设备，不再等点启动才暴露
  onSdkSourceChanged(triggerSourceChangeReconcile)
  // 引用查询经注入进入 sdk 域（镜像删除守卫）——emulator 域不反向依赖 devices；
  // 清除保留根的设备级联与确认框计数同走注入（用户 2026-10-12 批复：清 SDK 连带
  // 删除全部项目自有设备）
  registerSdkIpc({
    referencingDeviceNames: listDeviceNamesReferencing,
    savedDeviceSkinRef,
    purgeAppOwnedDevices,
    appOwnedDeviceCount
  })
  // 编辑窗目标核验经注入进入向导域（开窗前 devices 域裁决，避免 wizard 反向依赖）
  registerWizardIpc({ assertEditorTarget })
  // 拖拽 APK 安装：serial 断言统一走组合查询（真机 connected 或 AVD running）经注入，
  // 安装域自身不反向依赖 devices；仅主窗可发起
  registerApkInstallIpc({
    adbPath: adbBinaryPath,
    serialOf: serialOfDeviceId,
    isMainSender: (sender) => getMainWindow()?.webContents.id === sender.id
  })
  // 截屏域（plan 2026-10-10）：running 校验经注入进入 devices 域，域自身不反向依赖；
  // 尾段复核用同步 isRunningDevice——迟到回填与停止钩子清缓存之间零异步间隙。
  // 真机适配（plan 2026-10-13-real-device-toolbar-parity）：注入换组合查询（外部 device
  // 态优先，miss 落 AVD running），AVD 行为不变
  registerScreenshotIpc({
    adbPath: adbBinaryPath,
    runningDevice: deviceRefOfId,
    isRunningDevice: isDeviceActiveOfId,
    isMainSender: (sender) => getMainWindow()?.webContents.id === sender.id
  })
  // 网络开关域（plan 2026-10-12）：注入同截屏域；句柄供桥启停轮询（running 起、停止收）
  const network = registerNetworkIpc({
    adbPath: adbBinaryPath,
    runningDevice: runningDeviceRef,
    isMainSender: (sender) => getMainWindow()?.webContents.id === sender.id,
    pushTarget: () => getMainWindow()?.webContents ?? null
  })
  registerSettingsIpc()
  registerLogcatIpc()
  registerReportIpc()
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
    runtimeViews: listDeviceRuntimeViews,
    isLogcatWindow: isLogcatWindowSender
  })
  logcat.registerIpc()

  // 扫尾流会话：投屏与日志两域并行销毁（截屏缓存无进程，靠桥按设备清理）
  streamShutdown = () =>
    Promise.all([scrcpy.destroyAll(), logcat.destroyAll()]).then(() => undefined)

  // runner 事件 → 流会话生命周期：running 建会话，停止/崩溃/清理销毁（beforeKill 先释放
  // 投屏与日志资源）。截屏缓存同桥收尾：设备停止/清理时最近一张作废（save 拒绝 stale）；
  // 网络轮询同桥启停：running 首拍读初值，停止/清理退订 timer 与读回基准
  attachDeviceStreamBridge({
    running: (id, runId, serial) => {
      void scrcpy.ensureSession({ id, runId, serial }).catch(() => undefined)
      logcat.ensureSession({ id, runId, serial })
      network.startWatch(id, serial)
    },
    stopped: (id) => {
      clearScreenshotCache(id)
      network.clearWatch(id)
      void scrcpy.destroySession(id)
      void logcat.destroySession(id)
    },
    beforeKill: (id) => {
      clearScreenshotCache(id)
      network.clearWatch(id)
      return Promise.all([scrcpy.destroySession(id), logcat.destroySession(id)]).then(
        () => undefined
      )
    }
  })

  // 真机跟踪（track-devices-l 长连接）+ 会话第二桥：外部设备没有 runner，track 事件
  // 直接驱动投屏会话（connected 建会话、removed 销毁）；截屏/网络/日志不接真机
  // （PRD 后续批次，假设 5）。注册须在 scrcpy 创建之后（onSession 闭包引用它）
  registerExternalIpc({
    pushTarget: () => getMainWindow()?.webContents ?? null,
    isMainSender: (sender) => getMainWindow()?.webContents.id === sender.id,
    onSession: (event) => {
      if (event.kind === 'connected') {
        void scrcpy
          .ensureSession({ id: event.device.id, runId: event.runId, serial: event.device.serial })
          .catch(() => undefined)
      } else {
        void scrcpy.destroySession(event.id).catch(() => undefined)
      }
    }
  })
}
