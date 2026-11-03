import type { DeviceRuntimeView } from '@shared/types'
import { originOfMeta } from '@shared/deviceOrigin'
import { msg } from '../locale'
import { ensureLoaded } from './scan'
import { externalDevicesNow } from './external'
import { devicesNow, requireDevice } from './state'

// ---- 对外只读查询（跨域注入消费；不触发写路径）----

/**
 * 引用查询（镜像删除守卫用）：按 imagePackageName 列设备名。devices 内存数组
 * 含 creating 事务行——创建中的引用同样拦住删除（plan 2026-10-06-image-uninstall）。
 */
/** 主窗皮肤读取只从已保存设备取引用；SDK 域经注入消费。 */
export const savedDeviceSkinRef = async (id: string): Promise<string | null> => {
  await ensureLoaded()
  return requireDevice(id).advancedSettings?.skinRef ?? null
}

/** 截屏域经注入消费：running 设备的 serial 与名称；未运行返回 null（由调用方决定文案） */
export const runningDeviceRef = async (
  id: string
): Promise<{ serial: string; name: string } | null> => {
  await ensureLoaded()
  const device = requireDevice(id)
  if (device.status !== 'running' || !device.serial) return null
  return { serial: device.serial, name: device.name }
}

/** 截屏域迟到回填复核用：同步读 running（不 ensureLoaded——调用点设备必已加载；
 * 与异步复核的差别是零微任务间隙，停止钩子无法插进复核与缓存回填之间） */
export const isRunningDevice = (id: string): boolean => {
  const device = devicesNow().find((entry) => entry.id === id)
  return device?.status === 'running' && !!device.serial
}

export const listDeviceNamesReferencing = (packageName: string): string[] =>
  devicesNow()
    .filter((device) => device.imagePackageName === packageName)
    .map((device) => device.name)

/** 窗口上下文窄视图（日志窗下拉等）：只暴露 id/名称/运行态/serial/runId——
 *  相比全量快照不扩散健康详情、镜像与附加设置；各消费域仍须自行守卫 sender */
export const listDeviceRuntimeViews = (): DeviceRuntimeView[] =>
  devicesNow().map((device) => ({
    id: device.id,
    name: device.name,
    status: device.status,
    serial: device.serial,
    runId: device.runId
  }))

/** 安装域注入用（plan 2026-10-10-drag-apk-install）：断言设备 running 并返回 serial；
 *  未 running 抛本地化错误——与 copySerial 同一守卫口径 */
export const runningDeviceSerial = (id: string): string => {
  const device = requireDevice(id)
  if (device.status !== 'running' || !device.serial) {
    throw new Error(msg('apkDeviceNotRunning'))
  }
  return device.serial
}

/** 安装域的统一 serial 入口（plan 2026-10-13-real-device-usb-and-apk-install）：
 *  外部设备 connected 态 → serial；外部但未就绪 → 真机未就绪词条；未命中 → 落
 *  runningDeviceSerial（AVD 路径行为不变） */
export const serialOfDeviceId = (id: string): string => {
  const external = externalDevicesNow().find((device) => device.id === id)
  if (external) {
    if (external.state === 'device') return external.serial
    throw new Error(msg('apkExternalNotReady'))
  }
  return runningDeviceSerial(id)
}

/** 截屏/网络域注入用（plan 2026-10-13-real-device-toolbar-parity）：外部优先组合引用——
 *  device 态真机 → serial/名称（model 缺省用 serial）；外部命中但未就绪 → 抛
 *  externalDeviceNotReady（review P3-4：真机未授权不再误报「设备不在运行中」）；
 *  未命中 → 落 runningDeviceRef（AVD 行为不变，missing id 的抛错语义同源） */
export const deviceRefOfId = async (
  id: string
): Promise<{ serial: string; name: string } | null> => {
  const external = externalDevicesNow().find((device) => device.id === id)
  if (external) {
    if (external.state !== 'device') throw new Error(msg('externalDeviceNotReady'))
    return { serial: external.serial, name: external.model ?? external.serial }
  }
  return runningDeviceRef(id)
}

/** 截屏尾段同步复核用（与 isRunningDevice 同款零间隙语义）：外部命中 → device 态判定；
 *  未命中 → 落 isRunningDevice */
export const isDeviceActiveOfId = (id: string): boolean => {
  const external = externalDevicesNow().find((device) => device.id === id)
  if (external) return external.state === 'device'
  return isRunningDevice(id)
}

/** 设置窗清除确认框的计数来源：项目自有出身设备总数（当前视图的另一桶全体） */
export const appOwnedDeviceCount = async (): Promise<number> => {
  await ensureLoaded()
  return devicesNow().filter((device) => originOfMeta(device) === 'app-owned').length
}
