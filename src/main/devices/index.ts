// devices 域公共出口（消费方：ipc/index.ts、main/index.ts、
// emulator/sdkSourceSwitch.ts、__tests__ 经 import('..') 走本入口）
// 分层：environment/state → persistence → scan/startup/lifecycle/create/edit
// → queries/ipc → 本文件；状态单例语义依赖本入口的依赖图整体加载。
export { adbBinaryPath, androidToolEnv } from './environment'
export { attachDeviceStreamBridge } from './state'
export { triggerSourceChangeReconcile } from './scan'
export { runningDeviceCount } from './startup'
export { prepareAppShutdown, purgeAppOwnedDevices, resumeAfterShutdown } from './lifecycle'
export { assertEditorTarget } from './edit'
export {
  appOwnedDeviceCount,
  deviceRefOfId,
  isDeviceActiveOfId,
  isRunningDevice,
  listDeviceNamesReferencing,
  listDeviceRuntimeViews,
  runningDeviceRef,
  runningDeviceSerial,
  savedDeviceSkinRef,
  serialOfDeviceId
} from './queries'
export { registerDevicesIpc } from './ipc'
export {
  externalRuntimeViews,
  registerExternalIpc,
  resumeExternalSessions,
  stopExternalTracking
} from './external'
