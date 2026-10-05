import { BrowserWindow, app, clipboard, ipcMain } from 'electron'
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import type {
  CreateDeviceInput,
  CreateDeviceResult,
  Device,
  DeviceMeta,
  DeviceSnapshot,
  RuntimeErrorMessage
} from '@shared/types'
import { readDeviceMetas, writeDeviceMetas } from '../store'
import { avdExists, createAvd, deleteAvd, patchAvdConfig } from '../emulator/avd'
import {
  classifyTags,
  parseApiVersion,
  scanLocalImages,
  splitPackageName
} from '../emulator/catalog'
import { assessImageCompatibility } from '@shared/compatibility'
import {
  buildCapabilities,
  normalizeAdvancedSettings,
  readEmulatorVersion,
  settingsToConfigPatch,
  settingsToRunnerArgs
} from '../emulator/settings'
import { avdmanagerPathFor, listDeviceProfiles } from '../emulator/profiles'
import { sdklibJarPathFor } from '../emulator/profileMetadata'
import {
  ensureSharedServer,
  candidateAdbPaths,
  listAdbSerials,
  resolveAdbExecutable,
  scrubAdbEnv,
  type AdbExecutable
} from '../emulator/adb'
import { PortAllocator, tcpProbe } from '../emulator/ports'
import { createRunner } from '../emulator/runner'
import { getMainWindow } from '../window'
import { wizardOwns } from '../window/wizard'
import { importedSkinsRoot } from '../emulator/skins'
import { listWebcams } from '../emulator/cameras'

/** skinRef → 皮肤目录（sdk:* 解析 SDK skins；其余查应用库）；未知返回 null */
const skinDirectoryFor = (skinRef: string): string | null => {
  if (skinRef.startsWith('sdk:')) {
    return join(sdkRoot(), 'skins', skinRef.slice(4))
  }
  const id = skinRef.replace(/^(imported|downloaded):/, '')
  return join(importedSkinsRoot(app.getPath('userData')), id)
}

// 应用自有目录（与 emulator IPC 层同源：userData/AndroidSDK + userData/avd-home）
const sdkRoot = (): string => join(app.getPath('userData'), 'AndroidSDK')
const avdHome = (): string => join(app.getPath('userData'), 'avd-home')
const avdDirs = (): { avdHome: string; sdkRoot: string } => ({
  avdHome: avdHome(),
  sdkRoot: sdkRoot()
})

const MAX_NAME_LENGTH = 50

const normalizeName = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  const name = value.trim()
  if (name.length === 0 || name.length > MAX_NAME_LENGTH) return null
  return name
}

/** renderer payload 不可信，进业务前先过守卫（coding-style IPC 纪律） */
const isCreateDeviceInput = (value: unknown): value is CreateDeviceInput => {
  if (typeof value !== 'object' || value === null) return false
  const input = value as Record<string, unknown>
  return (
    typeof input.profileId === 'string' &&
    input.profileId.length > 0 &&
    typeof input.profileLabel === 'string' &&
    input.profileLabel.length > 0 &&
    typeof input.imagePackageName === 'string' &&
    splitPackageName(input.imagePackageName) !== null &&
    normalizeName(input.name) !== null &&
    (input.advancedSettings === null ||
      input.advancedSettings === undefined ||
      typeof input.advancedSettings === 'object')
  )
}

const isRenameInput = (value: unknown): value is { id: string; name: string } => {
  if (typeof value !== 'object' || value === null) return false
  const input = value as Record<string, unknown>
  return typeof input.id === 'string' && input.id.length > 0 && normalizeName(input.name) !== null
}

const isDeviceIdInput = (value: unknown): value is { id: string } => {
  if (typeof value !== 'object' || value === null) return false
  const input = value as Record<string, unknown>
  return typeof input.id === 'string' && input.id.length > 0
}

// ---- 共享 adb 可执行文件（解析一次；start 前经 ensureSharedServer 验兼容）----

let adbExecutable: AdbExecutable | null = null
const requireAdb = async (): Promise<AdbExecutable> => {
  if (!adbExecutable) {
    adbExecutable = await resolveAdbExecutable(candidateAdbPaths(sdkRoot()))
  }
  return adbExecutable
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

/** scrcpy 会话与 runner 共用：已解析的 adb 二进制（未解析时回落应用自有路径） */
export const adbBinaryPath = (): string =>
  adbExecutable?.path ?? join(sdkRoot(), 'platform-tools', 'adb')

/** 工具子进程统一环境：SDK 与用户目录全部指进应用自有目录（architecture 隔离不变量） */
export const androidToolEnv = (): NodeJS.ProcessEnv =>
  scrubAdbEnv({
    ...process.env,
    ANDROID_SDK_ROOT: sdkRoot(),
    ANDROID_HOME: sdkRoot(),
    ANDROID_AVD_HOME: avdHome(),
    ANDROID_USER_HOME: join(sdkRoot(), 'android-user'),
    ANDROID_EMULATOR_HOME: join(sdkRoot(), 'android-user')
  })

const ports = new PortAllocator({
  probeTcp: tcpProbe,
  // server 尚不可用时按无外部登记处理，spawn 前还有一道 serial 检查兜底
  adbSerials: async () => {
    try {
      return await listAdbSerials((await requireAdb()).path)
    } catch {
      return new Set<string>()
    }
  }
})

// ---- 主进程是设备列表与运行状态的唯一事实源（architecture 边界不变量）----
// status/lastError/serial/runId 只活在这里的内存里，重启一律「停止」，不入盘。

let devices: Device[] = []
let revision = 0
let loadPromise: Promise<void> | null = null
let writeQueue: Promise<void> = Promise.resolve()
let acceptingCommands = true
const deleteFlights = new Map<string, Promise<DeviceSnapshot>>()

/** 投屏会话桥（ipc 层装配）：running 建流，stopped/beforeKill 释放流资源 */
const streamBridge: {
  running?: (id: string, runId: string, serial: string) => void
  stopped?: (id: string) => void
  beforeKill?: (id: string, runId: string) => Promise<void>
} = {}

export function attachDeviceStreamBridge(bridge: typeof streamBridge): void {
  Object.assign(streamBridge, bridge)
}

/**
 * 引用查询（镜像删除守卫用）：按 imagePackageName 列设备名。devices 内存数组
 * 含 creating 事务行——创建中的引用同样拦住删除（plan 2026-10-06-image-uninstall）。
 */
export const listDeviceNamesReferencing = (packageName: string): string[] =>
  devices.filter((device) => device.imagePackageName === packageName).map((device) => device.name)

/** 单次加载（issue 2026-10-03 双读的收口）：并发调用共享同一 Promise，失败可重试 */
const ensureLoaded = (): Promise<void> => {
  if (!loadPromise) {
    loadPromise = readDeviceMetas()
      .then((metas) => {
        devices = metas.map((meta) => ({ ...meta, status: 'stopped' as const }))
      })
      .catch((error) => {
        loadPromise = null
        throw error
      })
  }
  return loadPromise
}

const toMeta = (device: Device): DeviceMeta => ({
  id: device.id,
  name: device.name,
  profileId: device.profileId,
  profileLabel: device.profileLabel,
  imagePackageName: device.imagePackageName,
  apiDisplay: device.apiDisplay,
  formFactor: device.formFactor,
  screenSummary: device.screenSummary,
  advancedSettings: device.advancedSettings,
  snapshotReadyAt: device.snapshotReadyAt ?? null,
  createdAt: device.createdAt
})

/**
 * 元数据提交全局串行；写盘成功才改内存（issue 2026-10-03 落盘分叉的修法）。
 * draft 是唯一写盘内容；内存按 draft 重建并保留运行态字段。
 */
const commitMetas = (mutate: (metas: DeviceMeta[]) => DeviceMeta[]): Promise<void> => {
  const run = writeQueue.then(async () => {
    const draft = mutate(devices.map(toMeta))
    await writeDeviceMetas(draft)
    const runtimeById = new Map(devices.map((device) => [device.id, device]))
    devices = draft.map((meta) => {
      const runtime = runtimeById.get(meta.id)
      return runtime
        ? {
            ...meta,
            status: runtime.status,
            lastError: runtime.lastError,
            serial: runtime.serial,
            runId: runtime.runId
          }
        : { ...meta, status: 'stopped' as const }
    })
  })
  writeQueue = run.catch(() => undefined) // 单次失败不断队列
  return run
}

const snapshotNow = (): DeviceSnapshot => ({
  revision,
  devices: devices.map((device) => ({ ...device }))
})

const broadcastChanged = (): void => {
  revision += 1
  const snapshot = snapshotNow()
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(IPC_CHANNELS.devicesChanged, snapshot)
  }
}

const requireDevice = (id: string): Device => {
  const device = devices.find((entry) => entry.id === id)
  if (!device) throw new Error(`设备不存在（${id}）`)
  return device
}

/** 后台运行故障 → 主窗（无主窗时保留在行内 lastError，重开后展示） */
const emitRuntimeError = (message: RuntimeErrorMessage): void => {
  getMainWindow()?.webContents.send(IPC_CHANNELS.devicesRuntimeError, message)
}

// ---- runner 事件 → 设备状态回写 ----

const handleRunning = (id: string, runId: string, serial: string): void => {
  const device = devices.find((entry) => entry.id === id)
  if (!device || device.runId !== runId || device.status !== 'starting') return
  device.status = 'running'
  device.serial = serial
  broadcastChanged()
  streamBridge.running?.(id, runId, serial)
}

const handleUnexpectedExit = (
  id: string,
  runId: string,
  info: { code: number; stderrTail: string }
): void => {
  const device = devices.find((entry) => entry.id === id)
  if (!device || device.runId !== runId) return // 旧代次退出不覆盖新实例
  const detail = info.stderrTail.length > 0 ? info.stderrTail : `exit ${info.code}`
  device.status = 'stopped'
  device.lastError = { code: 'unexpected-exit', message: `模拟器意外退出：${detail}` }
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

const runner = createRunner({
  sdkRoot,
  avdHome,
  emulatorPath: () => join(sdkRoot(), 'emulator', 'emulator'),
  adbPath: () => adbExecutable?.path ?? join(sdkRoot(), 'platform-tools', 'adb'),
  ports,
  ensureAdbServer: async () => {
    const adb = await requireAdb()
    const descriptor = await ensureSharedServer(adb)
    if (descriptor.reused) {
      console.log(`[devices] 复用共享 adb server（协议 v${descriptor.protocolVersion}）`)
    }
  },
  beforeKill: (id, runId) => streamBridge.beforeKill?.(id, runId) ?? Promise.resolve(),
  // 运行字段按设备自己的已验证设置构造 argv；legacy（无设置）沿用固定 Cold/host。
  // Quick 的首启/失效路径：从未有效快照 → -no-snapshot-load（不加载旧快照，
  // 正常停止仍保存新快照；plan 设计 8 的冷启动恢复）
  extraArgsFor: (id) => {
    const device = devices.find((entry) => entry.id === id)
    if (device?.advancedSettings === undefined || device.advancedSettings === null) {
      return ['-no-snapshot', '-gpu', 'host']
    }
    const args = settingsToRunnerArgs(device.advancedSettings)
    if (device.advancedSettings.bootMode === 'quick' && (device.snapshotReadyAt ?? null) === null) {
      const coldLoad = args.indexOf('-no-snapshot')
      if (coldLoad !== -1) args.splice(coldLoad, 1)
      args.push('-no-snapshot-load')
    }
    return args
  },
  onRunning: handleRunning,
  onUnexpectedExit: handleUnexpectedExit
})

// ---- 生命周期流程 ----

const startDevice = async (id: string): Promise<DeviceSnapshot> => {
  if (!acceptingCommands) throw new Error('应用退出清理中，暂停启动')
  await ensureLoaded()
  const device = requireDevice(id)
  if (device.status === 'starting' || device.status === 'running') return snapshotNow()
  if (device.status === 'stopping') throw new Error('设备停止中，停止完成后再启动')
  if (device.status !== 'stopped') throw new Error(`设备当前状态不允许启动（${device.status}）`)
  // 步骤 6 对账未接入前的最小存在性校验：缺失/不安全 AVD 一律拒绝
  if (!(await avdExists(id, avdDirs()))) {
    device.lastError = { code: 'avd-missing', message: 'AVD 不存在或已被外部删除，无法启动' }
    broadcastChanged()
    throw new Error(device.lastError.message)
  }
  // 真实摄像头启动重核验（plan 设计 7）：配置的 webcam 拔出/消失时拒绝启动
  const webcams =
    device.advancedSettings?.frontCamera.mode === 'webcam' ||
    device.advancedSettings?.rearCamera.mode === 'webcam'
  if (webcams === true && device.advancedSettings !== null) {
    try {
      const available = new Set((await listWebcams(sdkRoot())).map((entry) => entry.id))
      const missing: string[] = []
      for (const camera of [
        device.advancedSettings.frontCamera,
        device.advancedSettings.rearCamera
      ]) {
        if (
          camera.mode === 'webcam' &&
          camera.deviceId !== null &&
          !available.has(camera.deviceId)
        ) {
          missing.push(camera.deviceId)
        }
      }
      if (missing.length > 0) {
        device.lastError = {
          code: 'webcam-missing',
          message: `宿主摄像头（${missing.join('、')}）已不可用，请重新选择摄像头后启动`
        }
        broadcastChanged()
        throw new Error(device.lastError.message)
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('不可用')) throw error
      // 枚举本身失败不阻断启动（emulator 启动时会给出自己的错误）
    }
  }
  device.status = 'starting'
  device.lastError = undefined
  device.startedAt = Date.now()
  broadcastChanged()
  try {
    const { runId, serial } = await runner.start(id)
    const target = requireDevice(id)
    target.runId = runId
    if (target.status === 'starting') target.serial = serial
    broadcastChanged()
  } catch (error) {
    const target = requireDevice(id)
    if (target.status === 'starting') {
      target.status = 'stopped'
      target.lastError = { code: 'start-failed', message: messageOf(error) }
    }
    broadcastChanged()
    throw error
  }
  return snapshotNow()
}

const stopDevice = async (id: string): Promise<DeviceSnapshot> => {
  await ensureLoaded()
  const device = requireDevice(id)
  if (device.status !== 'running' && device.status !== 'stopping') {
    throw new Error(
      device.status === 'starting' ? '设备启动中：请取消启动而非停止' : '设备不在运行中'
    )
  }
  device.status = 'stopping'
  broadcastChanged()
  try {
    await runner.stop(id)
  } catch (error) {
    const target = requireDevice(id)
    if (target.status === 'stopping') {
      target.lastError = { code: 'stop-failed', message: `停止失败：${messageOf(error)}` }
      broadcastChanged()
    }
    throw error
  }
  const target = requireDevice(id)
  if (target.status === 'stopping') {
    target.status = 'stopped'
    target.serial = undefined
    const startedAt = target.startedAt
    target.startedAt = undefined
    target.runId = undefined
    broadcastChanged()
    streamBridge.stopped?.(target.id)
    // 正常停止的快照核验（plan 设计 8）：Quick 设备确认快照文件新于本次启动
    // 才置 snapshotReadyAt；核验不过保持 null——下次启动走冷启动恢复，不静默丢数据
    if (target.advancedSettings?.bootMode === 'quick' && startedAt !== undefined) {
      const verified = await verifySnapshotSaved(target.id, startedAt)
      if (verified !== null) {
        await commitMetas((metas) =>
          metas.map((meta) =>
            meta.id === target.id ? { ...meta, snapshotReadyAt: verified } : meta
          )
        ).catch(() => undefined)
      }
    }
  }
  return snapshotNow()
}

/** 快照核验：<avd>/snapshots/default_boot/ 快照条目存在且 mtime 晚于本次启动 */
const verifySnapshotSaved = async (id: string, startedAt: number): Promise<number | null> => {
  const snapshotsDir = join(avdHome(), `${id}.avd`, 'snapshots', 'default_boot')
  try {
    const entries = await readdir(snapshotsDir)
    for (const entry of entries) {
      const info = await stat(join(snapshotsDir, entry))
      if (info.mtimeMs > startedAt) return info.mtimeMs
    }
    return null
  } catch {
    return null
  }
}

const cancelStartDevice = async (id: string): Promise<DeviceSnapshot> => {
  await ensureLoaded()
  const device = requireDevice(id)
  if (device.status === 'running') {
    throw new Error('设备已在运行，取消不再适用（可改为停止）')
  }
  if (device.status !== 'starting' && device.status !== 'stopping') return snapshotNow()
  if (device.status === 'starting') {
    device.status = 'stopping'
    broadcastChanged()
  }
  try {
    await runner.cancelStart(id)
  } catch (error) {
    const target = requireDevice(id)
    if (target.status === 'stopping') {
      // 迟到取消竞态：boot 恰好已完成则恢复运行态，不把迟到取消当停止
      if (runner.phaseOf(id) === 'running') {
        target.status = 'running'
        target.serial = runner.serialOf(id)
      } else {
        target.lastError = { code: 'stop-failed', message: `取消失败：${messageOf(error)}` }
      }
      broadcastChanged()
    }
    throw error
  }
  const target = requireDevice(id)
  if (target.status === 'stopping') {
    target.status = 'stopped'
    target.serial = undefined
    target.runId = undefined
    broadcastChanged()
    streamBridge.stopped?.(target.id)
  }
  return snapshotNow()
}

const deleteFlow = async (id: string): Promise<DeviceSnapshot> => {
  await ensureLoaded()
  const device = requireDevice(id)
  if (device.status === 'creating') throw new Error('设备创建中，不能删除')
  if (device.status === 'starting') await cancelStartDevice(id)
  else if (device.status === 'running' || device.status === 'stopping') await stopDevice(id)
  if (requireDevice(id).status !== 'stopped') throw new Error('停止未完成，未删除')
  requireDevice(id).status = 'deleting'
  broadcastChanged()
  try {
    // 删除的文件操作与 JSON 写入无法原子提交：分别报错，失败保留异常记录
    await deleteAvd(id, avdDirs())
    await commitMetas((metas) => metas.filter((meta) => meta.id !== id))
    broadcastChanged()
    return snapshotNow()
  } catch (error) {
    const target = devices.find((entry) => entry.id === id)
    if (target) {
      target.status = 'stopped'
      target.lastError = {
        code: 'delete-failed',
        message: `删除未完成：${messageOf(error)}；AVD 目录可能残留，可重试删除`
      }
    }
    broadcastChanged()
    throw error
  }
}

const deleteDevice = (id: string): Promise<DeviceSnapshot> => {
  // 停止/删除中的重复请求合并到同一次执行
  const flight = deleteFlights.get(id)
  if (flight) return flight
  const promise = deleteFlow(id).finally(() => deleteFlights.delete(id))
  deleteFlights.set(id, promise)
  return promise
}

const createDevice = async (raw: CreateDeviceInput): Promise<CreateDeviceResult> => {
  await ensureLoaded()
  const packageName = raw.imagePackageName
  // 创建时重新核验（plan 设计 2：拒绝陈旧选择）——镜像完整安装 + 画像仍可创建 + 兼容性
  const local = await scanLocalImages(sdkRoot())
  const imageRecord = local.get(packageName)
  if (imageRecord?.verified !== true) {
    throw new Error('系统镜像未安装或安装不完整，请先在向导中下载')
  }
  const profiles = await listDeviceProfiles({
    avdmanagerPath: avdmanagerPathFor(sdkRoot()),
    jarPath: sdklibJarPathFor(sdkRoot())
  })
  const profile = profiles.find((entry) => entry.id === raw.profileId)
  if (profile === undefined || !profile.creatable) {
    throw new Error('设备画像已不可创建，请返回向导重新选择')
  }
  const { major, minor } = parseApiVersion(imageRecord.apiLevelText)
  const verdict = assessImageCompatibility(profile, {
    abi: imageRecord.abi,
    services: classifyTags(imageRecord.tagIds).services,
    api: {
      platformSegment: splitPackageName(packageName)?.platformSegment ?? '',
      major,
      minor,
      codename: null,
      extensionLevel: imageRecord.extensionLevel,
      baseExtension: null
    }
  })
  if (verdict.status !== 'supported') {
    throw new Error(`镜像与画像不兼容：${verdict.reasons.join('；')}`)
  }
  // 设置归一化（能力上下文 = 当前画像×镜像×emulator）：字段错误拒绝创建，
  // Quick 未开放回落 Cold——伪造入参不改变开放门槛
  const capabilities = buildCapabilities({
    profile,
    imagePackageName: packageName,
    emulatorVersion: await readEmulatorVersion(sdkRoot())
  })
  const normalized = normalizeAdvancedSettings(
    (raw.advancedSettings as CreateDeviceInput['advancedSettings']) ?? null,
    capabilities
  )
  if (Object.keys(normalized.errors).length > 0) {
    const first = Object.entries(normalized.errors)[0] as [string, string]
    throw new Error(`附加设置不合法（${first[0]}）：${first[1]}`)
  }
  const advancedSettings = normalized.settings
  // 真实摄像头占用核验：同一宿主摄像头不能同时配给两台设备（plan 设计 7）
  if (advancedSettings !== null) {
    const occupied = new Set<string>()
    for (const existing of devices) {
      for (const camera of [
        existing.advancedSettings?.frontCamera,
        existing.advancedSettings?.rearCamera
      ]) {
        if (camera?.mode === 'webcam' && camera.deviceId !== null) {
          occupied.add(camera.deviceId)
        }
      }
    }
    for (const [field, camera] of [
      ['frontCamera', advancedSettings.frontCamera],
      ['rearCamera', advancedSettings.rearCamera]
    ] as const) {
      if (camera.mode === 'webcam' && camera.deviceId !== null && occupied.has(camera.deviceId)) {
        throw new Error(`附加设置不合法（${field}）：摄像头 ${camera.deviceId} 已被其他设备占用`)
      }
    }
  }
  const apiDisplay =
    major === null
      ? (splitPackageName(packageName)?.platformSegment ?? null)
      : minor !== null
        ? `${major}.${minor}`
        : `${major}`
  const device: Device = {
    id: randomUUID(),
    name: raw.name.trim(),
    profileId: profile.id,
    profileLabel: profile.name,
    imagePackageName: packageName,
    apiDisplay,
    formFactor: profile.formFactor,
    screenSummary:
      profile.screen.widthPx !== null || profile.screen.heightPx !== null
        ? {
            widthPx: profile.screen.widthPx,
            heightPx: profile.screen.heightPx,
            diagonalInches: profile.screen.diagonalInches
          }
        : null,
    advancedSettings,
    snapshotReadyAt: null,
    createdAt: Date.now(),
    status: 'creating'
  }
  devices = [...devices, device]
  broadcastChanged()
  try {
    // 事务：AVD 真建成功 → config patch（白名单键、保留未知键）→ 元数据落盘成功
    // → 才转停止；任一失败撤回临时行并回滚 AVD
    await createAvd({ avdName: device.id, profileId: raw.profileId, packageName }, avdDirs())
    if (advancedSettings !== null) {
      const patch = settingsToConfigPatch(advancedSettings)
      // 导入/下载皮肤：config 写绝对 skin.path（应用自有目录，随库稳定）
      if (
        advancedSettings.skinRef !== null &&
        !advancedSettings.skinRef.startsWith('sdk:') &&
        skinDirectoryFor(advancedSettings.skinRef) !== null
      ) {
        patch['skin.path'] = skinDirectoryFor(advancedSettings.skinRef) as string
      }
      await patchAvdConfig(device.id, avdDirs(), patch)
    }
    // 临时行已在内存里：按 id upsert，避免重复条目
    await commitMetas((metas) => [...metas.filter((meta) => meta.id !== device.id), toMeta(device)])
    requireDevice(device.id).status = 'stopped'
    broadcastChanged()
    return { createdId: device.id, snapshot: snapshotNow() }
  } catch (error) {
    devices = devices.filter((entry) => entry.id !== device.id)
    broadcastChanged()
    // 回滚失败不再吞掉：返回主错误与残留路径，供诊断与手动清理（plan 设计 5）
    let rollbackError: string | null = null
    try {
      await deleteAvd(device.id, avdDirs())
    } catch (rollback) {
      rollbackError = rollback instanceof Error ? rollback.message : String(rollback)
    }
    if (rollbackError !== null) {
      const main = error instanceof Error ? error.message : String(error)
      throw new Error(
        `创建失败：${main}；且回滚 AVD 失败（${rollbackError}），残留目录待清理：${join(avdHome(), `${device.id}.avd`)}`
      )
    }
    throw error
  }
}

const renameDevice = async (id: string, name: string): Promise<DeviceSnapshot> => {
  await ensureLoaded()
  const device = requireDevice(id)
  if (device.status === 'creating' || device.status === 'deleting') {
    throw new Error('设备事务进行中，暂不能重命名')
  }
  await commitMetas((metas) => metas.map((meta) => (meta.id === id ? { ...meta, name } : meta)))
  broadcastChanged()
  return snapshotNow()
}

// ---- sender 白名单：启停/删除/复制仅登记主窗；创建允许主窗与向导 ----

type IpcEvent = Electron.IpcMainInvokeEvent

const requireSender = (channel: string, event: IpcEvent, scope: 'main' | 'create'): void => {
  const allowed =
    scope === 'main'
      ? getMainWindow()?.webContents.id === event.sender.id
      : getMainWindow()?.webContents.id === event.sender.id || wizardOwns(event.sender)
  if (!allowed) throw new Error(`${channel}: 未登记的窗口`)
}

/** 退出清理：停掉本工具全部实例（有界）；返回未停干净的设备 id */
export async function prepareAppShutdown(): Promise<{ leftovers: string[] }> {
  acceptingCommands = false
  const leftovers = await runner.disposeAll()
  for (const device of devices) {
    if (!leftovers.includes(device.id)) {
      if (
        device.status === 'starting' ||
        device.status === 'running' ||
        device.status === 'stopping'
      ) {
        device.status = 'stopped'
        device.serial = undefined
        device.runId = undefined
        streamBridge.stopped?.(device.id)
      }
    }
  }
  broadcastChanged()
  return { leftovers }
}

/** 用户选择留在应用后恢复命令接纳（runner 侧同步恢复） */
export function resumeAfterShutdown(): void {
  acceptingCommands = true
  runner.resumeAccepting()
}

export function registerDevicesIpc(): void {
  ipcMain.handle(IPC_CHANNELS.devicesList, async (_event): Promise<DeviceSnapshot> => {
    requireSender(IPC_CHANNELS.devicesList, _event, 'create')
    await ensureLoaded()
    return snapshotNow()
  })

  ipcMain.handle(
    IPC_CHANNELS.devicesCreate,
    async (event, raw: unknown): Promise<CreateDeviceResult> => {
      requireSender(IPC_CHANNELS.devicesCreate, event, 'create')
      if (!isCreateDeviceInput(raw)) {
        throw new Error(`${IPC_CHANNELS.devicesCreate}: 非法的入参`)
      }
      return createDevice(raw)
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.devicesRename,
    async (event, raw: unknown): Promise<DeviceSnapshot> => {
      requireSender(IPC_CHANNELS.devicesRename, event, 'main')
      if (!isRenameInput(raw)) {
        throw new Error(`${IPC_CHANNELS.devicesRename}: 非法的入参`)
      }
      const name = normalizeName(raw.name)
      if (!name) throw new Error(`${IPC_CHANNELS.devicesRename}: 非法的名称`)
      return renameDevice(raw.id, name)
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.devicesDelete,
    async (event, raw: unknown): Promise<DeviceSnapshot> => {
      requireSender(IPC_CHANNELS.devicesDelete, event, 'main')
      if (!isDeviceIdInput(raw)) {
        throw new Error(`${IPC_CHANNELS.devicesDelete}: 非法的入参`)
      }
      return deleteDevice(raw.id)
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.devicesStart,
    async (event, raw: unknown): Promise<DeviceSnapshot> => {
      requireSender(IPC_CHANNELS.devicesStart, event, 'main')
      if (!isDeviceIdInput(raw)) {
        throw new Error(`${IPC_CHANNELS.devicesStart}: 非法的入参`)
      }
      return startDevice(raw.id)
    }
  )

  ipcMain.handle(IPC_CHANNELS.devicesStop, async (event, raw: unknown): Promise<DeviceSnapshot> => {
    requireSender(IPC_CHANNELS.devicesStop, event, 'main')
    if (!isDeviceIdInput(raw)) {
      throw new Error(`${IPC_CHANNELS.devicesStop}: 非法的入参`)
    }
    return stopDevice(raw.id)
  })

  ipcMain.handle(
    IPC_CHANNELS.devicesCancelStart,
    async (event, raw: unknown): Promise<DeviceSnapshot> => {
      requireSender(IPC_CHANNELS.devicesCancelStart, event, 'main')
      if (!isDeviceIdInput(raw)) {
        throw new Error(`${IPC_CHANNELS.devicesCancelStart}: 非法的入参`)
      }
      return cancelStartDevice(raw.id)
    }
  )

  ipcMain.handle(IPC_CHANNELS.devicesCopySerial, async (event, raw: unknown): Promise<void> => {
    requireSender(IPC_CHANNELS.devicesCopySerial, event, 'main')
    if (!isDeviceIdInput(raw)) {
      throw new Error(`${IPC_CHANNELS.devicesCopySerial}: 非法的入参`)
    }
    const device = requireDevice(raw.id)
    if (device.status !== 'running' || !device.serial) {
      throw new Error('设备不在运行中，没有可复制的 serial')
    }
    clipboard.writeText(device.serial)
  })
}
