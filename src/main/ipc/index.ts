import { settingsOwns } from '../window/settings'
import {
  registerRecording,
  confirmRecordingQuit,
  cancelRecordingQuit as restoreRecordingQuit
} from '../recording'
import { registerDialogIpc } from '../dialog'
import {
  assertEditorTarget,
  attachDeviceStreamBridge,
  adbBinaryPath,
  androidToolEnv,
  appOwnedDeviceCount,
  deviceRefOfId,
  externalRuntimeViews,
  isDeviceActiveOfId,
  listDeviceNamesReferencing,
  listDeviceRuntimeViews,
  purgeAppOwnedDevices,
  registerExternalIpc,
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
import { wirelessOwns, registerWirelessIpc } from '../window/wireless'
import { registerThemeIpc } from '../theme'
import { registerLocaleIpc } from '../locale'
import { getMainWindow } from '../window'

// 退出清理的接缝：main/index 在 before-quit 时调用（先 devices 停实例，再扫尾流会话）
let streamShutdown: (() => Promise<void>) | null = null

export async function shutdownStreams(): Promise<void> {
  if (streamShutdown) await streamShutdown()
}

let recordingQuit: (() => Promise<boolean>) | null = null
let recordingQuitRestore: (() => void) | null = null
export const prepareRecordingQuit = (): Promise<boolean> =>
  recordingQuit?.() ?? Promise.resolve(true)
/** 录制退出流程被外层中断（清理失败/用户反悔留下）后恢复录制常态 */
export const cancelRecordingQuit = (): void => recordingQuitRestore?.()

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
  // 无线连接原生窗（2026-10-15 用户裁定：弹层改原生弹窗）——打开通道 + 五通道放行
  registerWirelessIpc()
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
  // 网络开关域（plan 2026-10-12）：注入同截屏域；句柄供桥启停轮询（running 起、停止收）。
  // 真机适配（plan 2026-10-13-real-device-toolbar-parity）：注入换组合查询
  const network = registerNetworkIpc({
    adbPath: adbBinaryPath,
    runningDevice: deviceRefOfId,
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
  const recording = registerRecording({
    adbPath: adbBinaryPath,
    toolEnv: androidToolEnv,
    scrcpy,
    device: deviceRefOfId,
    getMainWindow,
    isSettingsSender: settingsOwns,
    isMainSender: (sender) => getMainWindow()?.webContents.id === sender.id,
    pushTarget: () => getMainWindow()?.webContents ?? null
  })
  recordingQuit = () => confirmRecordingQuit(recording)
  recordingQuitRestore = () => restoreRecordingQuit(recording)

  // 日志域：运行视图合并（S5）——AVD 视图 + 已连接真机（订阅惰性建会与独立窗下拉共用）
  const logcat = createLogcatManager({
    adbPath: adbBinaryPath,
    toolEnv: androidToolEnv,
    runtimeViews: () => [...listDeviceRuntimeViews(), ...externalRuntimeViews()],
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
      void recording.stopDevice(id)
      void scrcpy.destroySession(id)
      void logcat.destroySession(id)
    },
    beforeKill: (id) => {
      clearScreenshotCache(id)
      network.clearWatch(id)
      return recording
        .stopDevice(id)
        .then(() => Promise.all([scrcpy.destroySession(id), logcat.destroySession(id)]))
        .then(() => undefined)
    }
  })

  // 真机跟踪（track-devices-l 长连接）+ 会话第二桥：外部设备没有 runner，track 事件
  // 直接驱动投屏会话（connected 建会话、removed 销毁）与网络轮询（connected 起、
  // removed 收；startWatch 幂等——重连首帧全量重发不叠 timer）；截屏缓存无进程无需
  // 接，日志在 S5 接。注册须在 scrcpy/network/logcat 创建之后（onSession 闭包引用它们）；
  // 变化广播默认发全部窗口（独立日志窗下拉跟随，对齐 devices:changed 语义）
  registerExternalIpc({
    isMainSender: (sender) => getMainWindow()?.webContents.id === sender.id,
    // 无线五通道放行无线连接窗（原生弹窗化后的调用方）
    isWirelessSender: wirelessOwns,
    onSession: (event) => {
      if (event.kind === 'connected') {
        void scrcpy
          .ensureSession({ id: event.device.id, runId: event.runId, serial: event.device.serial })
          .catch((error) => {
            // 桥路径的会话失败静默（track 下一帧会重发）；但退出恢复（P3-B）等
            // 用户可感路径需要留痕，否则「留下后投屏没回来」无法归因
            console.warn('[external] ensureSession failed for', event.device.id, String(error))
          })
        network.startWatch(event.device.id, event.device.serial)
        logcat.ensureSession({
          id: event.device.id,
          runId: event.runId,
          serial: event.device.serial
        })
      } else {
        void recording.stopDevice(event.id)
        void scrcpy.destroySession(event.id).catch(() => undefined)
        network.clearWatch(event.id)
        logcat.destroySession(event.id)
      }
    }
  })
}
