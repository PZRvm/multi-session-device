import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import type {
  Device,
  DeviceAdvancedSettings,
  DeviceAvailability,
  RuntimeErrorMessage
} from '@shared/types'
import { CHECK_TIMEOUT_MS, checkDeviceHealth } from '../emulator/reconcile'
import { awaitWithAbort } from '../emulator/abort'
import { isMigrationActive } from '../emulator/sdkMigration'
import { ensureSharedServer } from '../emulator/adb'
import { createRunner } from '../emulator/runner'
import { getMainWindow } from '../window'
import { listWebcams } from '../emulator/cameras'
import {
  arbitrateCameras,
  type ArbitrationCamera,
  type ArbitrationSide
} from '../emulator/cameraArbitration'
import { resetDisplayCutout } from '../emulator/displayCutout'
import { nativeDisplayArgs, parseConfigEntries, readAvdConfigRaw } from '../emulator/deviceConfig'
import { settingsToRunnerArgs } from '../emulator/settings'
import { androidUserHomeFor } from '../emulator/androidUserHome'
import { msg } from '../locale'
import {
  ADVICE_RE,
  adbBinaryPath,
  avdDirs,
  avdHome,
  messageOf,
  parseLegacyCamera,
  ports,
  reconcileDirs,
  requireAdb,
  sdkRoot
} from './environment'
import { commitMetas } from './persistence'
import { broadcastChanged, devicesNow, requireDevice, streamBridge, toMeta } from './state'

/** 后台运行故障 → 主窗（无主窗时保留在行内 lastError，重开后展示） */
const emitRuntimeError = (message: RuntimeErrorMessage): void => {
  getMainWindow()?.webContents.send(IPC_CHANNELS.devicesRuntimeError, message)
}

// ---- runner 事件 → 设备状态回写 ----

const handleRunning = (id: string, runId: string, serial: string): void => {
  const device = devicesNow().find((entry) => entry.id === id)
  if (!device || device.runId !== runId || device.status !== 'starting') return
  device.status = 'running'
  device.serial = serial
  broadcastChanged()
  streamBridge.running?.(id, runId, serial)
}

const handleUnexpectedExit = (
  id: string,
  runId: string,
  info: { code: number; stderrTail: string; stdoutTail: string }
): void => {
  const device = devicesNow().find((entry) => entry.id === id)
  if (!device || device.runId !== runId) return // 旧代次退出不覆盖新实例
  // 致命参数错误只打在 stdout（37.2.12 实测），stderr/stdout 尾部都带上
  const parts = [
    info.stderrTail.length > 0 ? info.stderrTail : null,
    info.stdoutTail.length > 0 ? `stdout：${info.stdoutTail}` : null
  ].filter((part): part is string => part !== null)
  const detail = parts.length > 0 ? parts.join('\n') : `exit ${info.code}`
  device.status = 'stopped'
  device.lastError = { code: 'unexpected-exit', message: msg('unexpectedExit', { detail }) }
  device.cameraNotice = undefined
  cameraOverridesByDevice.delete(id)
  device.serial = undefined
  device.runId = undefined
  broadcastChanged()
  streamBridge.stopped?.(id)
  emitRuntimeError({
    eventId: randomUUID(),
    deviceId: id,
    runId,
    code: 'unexpected-exit',
    message: device.lastError.message
  })
}

/** 启动前置核验失败：带阻断 code 与（若有）健康结果，供 startDevice 合并 lastError */
export class StartBlockedError extends Error {
  constructor(
    readonly blockCode: string,
    message: string,
    readonly availability?: DeviceAvailability
  ) {
    super(message)
  }
}

/**
 * 真实摄像头启动重核验（plan 设计 7）：配置的 webcam 拔出/消失时拒绝启动。
 * labels 为启动仲裁已枚举的宿主映射时复用（避免双跑探针）；缺省自行枚举，语义不变。
 */
const verifyWebcamsFor = async (
  device: Device,
  labels?: Map<string, string> | null
): Promise<void> => {
  const webcams =
    device.advancedSettings?.frontCamera.mode === 'webcam' ||
    device.advancedSettings?.rearCamera.mode === 'webcam'
  if (!webcams || device.advancedSettings === null) return
  let available: Map<string, string>
  if (labels !== undefined && labels !== null) {
    available = labels
  } else {
    try {
      available = new Map(
        (await listWebcams(sdkRoot())).map((entry) => [entry.id, entry.deviceLabel])
      )
    } catch (error) {
      // 底层错误自带建议从句（如「请检查 emulator 版本」）时不再叠加第二条建议
      const cause = messageOf(error)
      throw new StartBlockedError(
        'webcam-missing',
        ADVICE_RE.test(cause)
          ? msg('startCameraVerifyFailed', { cause })
          : msg('startCameraVerifyFailedHint', { cause })
      )
    }
  }
  const missing: string[] = []
  for (const camera of [device.advancedSettings.frontCamera, device.advancedSettings.rearCamera]) {
    if (
      camera.mode === 'webcam' &&
      camera.deviceId !== null &&
      (!available.has(camera.deviceId) ||
        (camera.hostDeviceId !== undefined &&
          available.get(camera.deviceId) !== camera.hostDeviceId))
    ) {
      missing.push(camera.deviceId)
    }
  }
  if (missing.length > 0) {
    throw new StartBlockedError(
      'webcam-missing',
      msg('webcamMissing', { names: missing.join('、') })
    )
  }
}

/** 单目标即时核验的期限包装（与全量扫描同额）：超时不冒充通过也不冒充已删 */
export const withDeadline = async <T>(
  promise: Promise<T>,
  fallback: () => T,
  ms: number
): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timed = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback()), ms)
  })
  promise.catch(() => undefined) // 迟到失败不产生 unhandled rejection
  try {
    return await Promise.race([promise, timed])
  } finally {
    clearTimeout(timer)
  }
}

export const checkTimeoutAvailability = (): DeviceAvailability => ({
  state: 'inaccessible',
  issues: [
    {
      component: 'avd',
      code: 'check-timeout',
      message: msg('startVerifyTimeout', { seconds: CHECK_TIMEOUT_MS / 1000 }),
      severity: 'error'
    }
  ],
  checkedAt: Date.now()
})

// 原生窗口关闭后，命名皮肤仍会覆盖 LCD 尺寸。外观由 renderer 绘制，运行画面
// 固定使用 config.ini 的机型尺寸；按 runId 隔离，取消后的迟到结果不供新启动使用。
export const displayArgsByDevice = new Map<string, { runId: string; args: string[] }>()

/** 仲裁侧绑定：config.ini 的 webcamN，托管设置同资源号时并入其稳定宿主身份 */
const arbitrationSideOf = (
  id: string,
  name: string,
  configEntries: Map<string, string>,
  advancedSettings: DeviceAdvancedSettings | null
): ArbitrationSide => {
  const bindingOf = (
    key: 'hw.camera.front' | 'hw.camera.back',
    identitySource?: DeviceAdvancedSettings['frontCamera']
  ): ArbitrationCamera | null => {
    const parsed = parseLegacyCamera(configEntries.get(key))
    if (parsed === null || parsed.mode !== 'webcam' || parsed.deviceId === null) return null
    return {
      deviceId: parsed.deviceId,
      ...(identitySource?.deviceId === parsed.deviceId && identitySource.hostDeviceId !== undefined
        ? { hostDeviceId: identitySource.hostDeviceId }
        : {})
    }
  }
  return {
    id,
    name,
    front: bindingOf('hw.camera.front', advancedSettings?.frontCamera),
    rear: bindingOf('hw.camera.back', advancedSettings?.rearCamera)
  }
}

/** 先到先得的先后判定：startedAt 更早者保留摄像头；同毫秒按 id 字典序定序 */
const startedBefore = (entry: Device, myStart: number, myId: string): boolean => {
  const other = entry.startedAt ?? 0
  return other < myStart || (other === myStart && entry.id < myId)
}

/** 枚举 webcamN → 稳定宿主身份；失败返回 null（仲裁退化为编号比较，核验自行重试） */
const enumerateWebcamLabels = async (signal: AbortSignal): Promise<Map<string, string> | null> => {
  try {
    const webcams = await awaitWithAbort(() => listWebcams(sdkRoot()), signal)
    return new Map(webcams.map((entry) => [entry.id, entry.deviceLabel]))
  } catch (error) {
    if (signal.aborted) throw error
    console.warn(`[devices] 摄像头枚举失败，本次仲裁退化为编号比较：${messageOf(error)}`)
    return null
  }
}

/** 本次启动的摄像头回退（按 runId 隔离，仿 displayArgsByDevice）：命中槽位以
 *  -camera-* emulated 覆盖（argv 不接受 virtualscene——37.2.12 实测 exit 1），
 *  config.ini 不动——不产生文件级配置偏差 */
export const cameraOverridesByDevice = new Map<
  string,
  { runId: string; front: boolean; rear: boolean }
>()

/** argv 里的 -camera-front/-camera-back 改写为 emulated；没有则追加 */
const applyCameraFallbackOverride = (
  args: string[],
  flag: '-camera-front' | '-camera-back'
): void => {
  const index = args.indexOf(flag)
  if (index !== -1 && index + 1 < args.length) args[index + 1] = 'emulated'
  else args.push(flag, 'emulated')
}

/** 运行会话数（starting/running/stopping 全算）——迁移与来源切换的预检口径 */
export const runningDeviceCount = (): number => runner.activeIds().length

/** 迁移期间 SDK 域只读：journal 内存标志在场即阻断创建/启动（同步零 await——
 *  创建事务的用例对入口节拍敏感，真实 fs 读会扰动时序） */
export const assertSdkDomainOpen = (): void => {
  if (isMigrationActive()) {
    throw new Error(msg('sdkMigrationBusy'))
  }
}

export const runner = createRunner({
  sdkRoot,
  avdHome,
  userHome: androidUserHomeFor,
  emulatorPath: () => join(sdkRoot(), 'emulator', 'emulator'),
  adbPath: adbBinaryPath,
  ports,
  ensureAdbServer: async () => {
    const adb = await requireAdb()
    const descriptor = await ensureSharedServer(adb)
    if (descriptor.reused) {
      console.log(`[devices] 复用共享 adb server（协议 v${descriptor.protocolVersion}）`)
    }
  },
  beforeStart: async (id, runId, signal) => {
    displayArgsByDevice.delete(id)
    const device = devicesNow().find((entry) => entry.id === id)
    if (device === undefined) throw new Error(msg('deviceNotFound', { id }))
    // 真正启动前即时核验（对账设计 4）：不信任上次扫描结果；结果只落在相同代次上
    const availability = await awaitWithAbort(
      () =>
        withDeadline(
          checkDeviceHealth(toMeta(device), reconcileDirs()),
          checkTimeoutAvailability,
          CHECK_TIMEOUT_MS
        ),
      signal
    )
    // 写回前重取列表对象（review P3）：跨 await 的 commitMetas 会重建 devices 数组，
    // 闭包里的旧引用会变成孤儿——写上去等于丢失更新
    const current = devicesNow().find((entry) => entry.id === id)
    if (current?.runId === runId && current.status === 'starting') {
      current.availability = availability
    }
    if (availability.state !== 'valid') {
      const blocking = availability.issues.find((issue) => issue.severity === 'error')
      throw new StartBlockedError(
        availability.state === 'missing' ? 'avd-missing' : `health-${availability.state}`,
        msg('startVerifyFailed', { message: blocking?.message ?? msg('fileStateAbnormal') }),
        availability
      )
    }
    // 摄像头核验与仲裁（设计决定 2026-10-09，复查 P2-3/P3-4）：以 config.ini 实际
    // 绑定为准（托管与 legacy 统一），枚举一次供核验和仲裁共用；先到先得，后启动
    // 方的冲突槽位回退模拟画面（argv 不接受 virtualscene）并透出行内通知
    const raw = await awaitWithAbort(() => readAvdConfigRaw(id, avdDirs()), signal)
    const args = nativeDisplayArgs(raw)
    if (args.length > 0) displayArgsByDevice.set(id, { runId, args })
    cameraOverridesByDevice.delete(id)
    const targetSide = arbitrationSideOf(
      id,
      device.name,
      parseConfigEntries(raw ?? ''),
      device.advancedSettings
    )
    const usesWebcam = targetSide.front !== null || targetSide.rear !== null
    const labels = usesWebcam ? await enumerateWebcamLabels(signal) : null
    await awaitWithAbort(() => verifyWebcamsFor(device, labels), signal)
    if (usesWebcam) {
      const myStart = device.startedAt ?? 0
      const boundOthers: ArbitrationSide[] = []
      for (const entry of devicesNow()) {
        if (
          entry.id === id ||
          (entry.status !== 'starting' && entry.status !== 'running') ||
          !startedBefore(entry, myStart, id)
        ) {
          continue
        }
        try {
          const otherRaw = await awaitWithAbort(() => readAvdConfigRaw(entry.id, avdDirs()), signal)
          const side = arbitrationSideOf(
            entry.id,
            entry.name,
            parseConfigEntries(otherRaw ?? ''),
            entry.advancedSettings
          )
          if (side.front !== null || side.rear !== null) boundOthers.push(side)
        } catch (error) {
          if (signal.aborted) throw error
          // 尽力而为：读不到配置的运行中设备跳过（macOS 摄像头本可共享），不阻断启动
          console.warn(`[devices] 摄像头仲裁跳过设备（${entry.name}）：${messageOf(error)}`)
        }
      }
      const arbitration = arbitrateCameras({ target: targetSide, others: boundOthers, labels })
      if (arbitration.front || arbitration.rear) {
        cameraOverridesByDevice.set(id, {
          runId,
          front: arbitration.front,
          rear: arbitration.rear
        })
        const row = devicesNow().find((entry) => entry.id === id)
        if (row?.runId === runId && row.status === 'starting') {
          row.cameraNotice = arbitration.notices.join('；')
          broadcastChanged()
        }
      }
    }
  },
  beforeKill: (id, runId) => streamBridge.beforeKill?.(id, runId) ?? Promise.resolve(),
  afterBoot: async (id, runId, serial, signal) => {
    const device = requireDevice(id)
    if (device.runId !== runId || !device.cutoutResetPending) return
    await resetDisplayCutout({ adbPath: adbBinaryPath(), serial, avdName: id, signal })
    if (signal.aborted || requireDevice(id).runId !== runId) return
    await commitMetas((metas) =>
      metas.map((meta) => (meta.id === id ? { ...meta, cutoutResetPending: undefined } : meta))
    )
  },
  // 运行字段按设备自己的已验证设置构造 argv；legacy（无设置）沿用固定 Cold/host。
  // Quick 的首启/失效路径：从未有效快照 → -no-snapshot-load（不加载旧快照，
  // 正常停止仍保存新快照；plan 设计 8 的冷启动恢复）
  extraArgsFor: (id) => {
    const device = devicesNow().find((entry) => entry.id === id)
    const display = displayArgsByDevice.get(id)
    const displayArgs = display?.runId === device?.runId ? (display?.args ?? []) : []
    // 摄像头回退（仲裁命中时）：本次启动以 emulated 覆盖，config.ini 不动
    const withCameraOverride = (args: string[]): string[] => {
      const override = cameraOverridesByDevice.get(id)
      if (override === undefined || override.runId !== device?.runId) return args
      const next = [...args]
      if (override.front) applyCameraFallbackOverride(next, '-camera-front')
      if (override.rear) applyCameraFallbackOverride(next, '-camera-back')
      return next
    }
    if (device?.advancedSettings === undefined || device.advancedSettings === null) {
      return withCameraOverride(['-no-snapshot', '-gpu', 'host', ...displayArgs])
    }
    const args = settingsToRunnerArgs(device.advancedSettings)
    if (device.cutoutResetPending) {
      if (!args.includes('-no-snapshot')) args.push('-no-snapshot')
      return withCameraOverride([...args, ...displayArgs])
    }
    if (device.advancedSettings.bootMode === 'quick' && (device.snapshotReadyAt ?? null) === null) {
      const coldLoad = args.indexOf('-no-snapshot')
      if (coldLoad !== -1) args.splice(coldLoad, 1)
      args.push('-no-snapshot-load')
    }
    return withCameraOverride([...args, ...displayArgs])
  },
  onRunning: handleRunning,
  onUnexpectedExit: handleUnexpectedExit
})
