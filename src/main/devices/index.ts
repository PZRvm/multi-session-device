import { BrowserWindow, app, clipboard, ipcMain } from 'electron'
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import type {
  CreateDeviceInput,
  CreateDeviceResult,
  Device,
  DeviceAdvancedSettings,
  DeviceAvailability,
  DeviceEditFieldNote,
  DeviceConfigField,
  DeviceConfigMismatch,
  DeviceEditSnapshot,
  DeviceEditStorageInfo,
  DeviceFrameKind,
  DeviceMeta,
  DeviceRuntimeView,
  DeviceSnapshot,
  ReconcileReport,
  ReconcileResult,
  ReconciliationSummary,
  RuntimeErrorMessage,
  StoreHealth,
  UpdateDeviceInput
} from '@shared/types'
import { normalizeEditedSettings, sanitizeUpdateSettings } from '@shared/settings-contract'
import { getLocaleState } from '../locale/store'
import { msg } from '../locale'
import { armStoreProtection, readDeviceStore, writeDeviceMetas } from '../store'
import { createAvd, deleteAvd, patchAvdConfig } from '../emulator/avd'
import {
  applyConfigPatchToText,
  buildConfigEditPatch,
  configFingerprintOf,
  nativeDisplayArgs,
  parseConfigEntries,
  readAvdConfigRaw,
  readHardwareSchemaDefaults,
  storageMiBFromText,
  writeAvdConfigRaw
} from '../emulator/deviceConfig'
import {
  recoverPendingTransactions,
  removeJournal,
  transactionsDir,
  writeJournal,
  type RecoveryResult
} from '../emulator/configTransaction'
import {
  classifyTags,
  parseApiVersion,
  scanLocalImages,
  splitPackageName
} from '../emulator/catalog'
import { assessImageCompatibility } from '@shared/compatibility'
import {
  buildEnrichedCapabilities,
  normalizeAdvancedSettings,
  readEmulatorVersion,
  settingsToConfigPatch,
  settingsToRunnerArgs
} from '../emulator/settings'
import { avdmanagerPathFor, listDeviceProfiles } from '../emulator/profiles'
import {
  loadFrameKindIndex,
  sdklibJarPathFor,
  type FrameKindIndex
} from '../emulator/profileMetadata'
import {
  CHECK_TIMEOUT_MS,
  checkDeviceHealth,
  runReconciliation,
  type ReconcileDirs,
  type ReconcileOutcome
} from '../emulator/reconcile'
import { awaitWithAbort } from '../emulator/abort'
import {
  ensureSharedServer,
  candidateAdbPaths,
  listAdbSerials,
  resolveAdbExecutable,
  scrubAdbEnv,
  type AdbExecutable
} from '../emulator/adb'
import { PortAllocator, tcpProbe } from '../emulator/ports'
import { createRunner, StartCancelledError } from '../emulator/runner'
import { getMainWindow } from '../window'
import { wizardContextOf } from '../window/wizard'
import { importedSkinsRoot } from '../emulator/skins'
import { listWebcams } from '../emulator/cameras'
import {
  arbitrateCameras,
  type ArbitrationCamera,
  type ArbitrationSide
} from '../emulator/cameraArbitration'
import { activePackageOp, beginPackageCreation, endPackageCreation } from '../emulator/packageOps'
import { resetDisplayCutout } from '../emulator/displayCutout'
import { configBaseline, configMismatchesOf } from '../emulator/configDrift'

/** 底层错误自带建议从句的多语言标记（zh「请」/ zh-TW「請」/ en "please"） */
const ADVICE_RE = /[請请]|please/i

/** skinRef → 皮肤目录（sdk:* 解析 SDK skins；其余查应用库）。skinRef 已按能力
 * 枚举（skinIds 白名单）归一化校验，id 来源受信扫描（uuid/目录名），无逃逸面 */
const skinDirectoryFor = (skinRef: string): string => {
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
/** 对账受控根：avd-home + SDK 根 + 应用皮肤库（skin.path 越界判定用） */
const reconcileDirs = (): ReconcileDirs => ({
  avdHome: avdHome(),
  sdkRoot: sdkRoot(),
  skinsRoot: importedSkinsRoot(app.getPath('userData'))
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
// availability/storeHealth 同为内存派生（对账产物），随快照发布、不进 toMeta。

let devices: Device[] = []
let revision = 0
let loadPromise: Promise<void> | null = null
let writeQueue: Promise<void> = Promise.resolve()
let acceptingCommands = true
const deleteFlights = new Map<string, Promise<DeviceSnapshot>>()

// ---- 对账状态（plan 2026-10-05-avd-reconciliation 设计 3）----

/** 当前库健康：error 时无可信列表；read-only 冻结一切元数据写入 */
let storeHealth: StoreHealth = { state: 'ok', issues: [] }
/** 最后接纳/成功提交的元数据（外部变化判定基准）；null = 尚无可信列表 */
let acceptedMetas: DeviceMeta[] | null = null
/** 坏/重复条目中可识别的 id（「元数据异常关联文件」） */
let suspectIds: string[] = []
/** 元数据提交代次（commitMetas 成功后 +1）——扫描过期判定 */
let metaRevision = 0
/** AVD 文件变更代次（create/delete 事务开始与结束 +1）——扫描过期判定 */
let avdEpoch = 0
let lastReport: ReconcileReport | null = null
let acknowledgedSignature: string | null = null
let reconcilePromise: Promise<ReconcileResult> | null = null

// ---- 配置编辑域状态（plan 2026-10-08-device-config-edit）----

/** 同设备保存互斥（覆盖全部 await）：持有期间启动/删除/独立重命名/重复保存拒绝交错 */
const editFlights = new Map<string, Promise<DeviceSnapshot>>()
/** 事务恢复无法裁决、冻结配置写入的目标（id → 中文原因；行内 lastError 反馈） */
const frozenMessages = new Map<string, string>()

const bumpAvdEpoch = (): void => {
  avdEpoch += 1
}

/** 投屏会话桥（ipc 层装配）：running 建流，stopped/beforeKill 释放流资源 */
const streamBridge: {
  running?: (id: string, runId: string, serial: string) => void
  stopped?: (id: string) => void
  beforeKill?: (id: string, runId: string) => Promise<void>
} = {}

// ---- 画像外观索引（派生展示提示，不入盘）：SDK 缺失/解析失败收敛为空索引 ----
let frameIndex: FrameKindIndex | null = null

/** 每次调用重验 JAR stat（SDK 更新后自动失效重建）；loadFrameKindIndex 内部全兜底不抛 */
const ensureFrameIndex = async (): Promise<void> => {
  frameIndex = await loadFrameKindIndex(sdkRoot())
}

const frameKindOf = (profileId: string): DeviceFrameKind | undefined =>
  frameIndex?.lookup(profileId)

export function attachDeviceStreamBridge(bridge: typeof streamBridge): void {
  Object.assign(streamBridge, bridge)
}

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
  const device = devices.find((entry) => entry.id === id)
  return device?.status === 'running' && !!device.serial
}

export const listDeviceNamesReferencing = (packageName: string): string[] =>
  devices.filter((device) => device.imagePackageName === packageName).map((device) => device.name)

const checkingAvailability = (): DeviceAvailability => ({
  state: 'checking',
  issues: [],
  checkedAt: null
})

/** 创建/删除/回滚/保存中的 id：扫描时暂缓判孤立（保存中 config 半提交不是稳定目标） */
const transientIdsNow = (): Set<string> =>
  new Set([
    ...devices
      .filter((device) => device.status === 'creating' || device.status === 'deleting')
      .map((device) => device.id),
    ...editFlights.keys()
  ])

/**
 * 以 metas 重建 devices：同 id 保留完整运行字段（status/lastError/serial/runId/
 * startedAt/availability），新 id 落 stopped + checking——首载/首建/提交三处共用
 * 单源（review P3：三段近重复收敛）。
 */
const rebuildDevices = (metas: DeviceMeta[]): Device[] => {
  const runtimeById = new Map(devices.map((device) => [device.id, device]))
  return metas.map((meta) => {
    const runtime = runtimeById.get(meta.id)
    return runtime !== undefined
      ? {
          ...meta,
          frameKind: runtime.frameKind ?? frameKindOf(meta.profileId),
          status: runtime.status,
          lastError: runtime.lastError,
          cameraNotice: runtime.cameraNotice,
          serial: runtime.serial,
          runId: runtime.runId,
          startedAt: runtime.startedAt,
          availability: runtime.availability
        }
      : {
          ...meta,
          frameKind: frameKindOf(meta.profileId),
          status: 'stopped' as const,
          availability: checkingAvailability()
        }
  })
}

/**
 * 首次加载（issue 2026-10-03 双读的收口）：并发调用共享同一 Promise，失败可重试。
 * JSON 解析与文件核验都在共享 Promise 内完成后才发布列表（plan 对账设计 3）。
 */
const ensureLoaded = (): Promise<void> => {
  if (!loadPromise) {
    loadPromise = loadAndScan().catch((error) => {
      loadPromise = null
      throw error
    })
  }
  return loadPromise
}

const loadAndScan = async (): Promise<void> => {
  let read = await readDeviceStore()
  // 事务恢复先于文件扫描与设备启动（plan 设计 3.5）：库 error 时无可信元数据可
  // 对照，跳过恢复（记录保留待下次启动裁决）
  if (read.health.state !== 'error') {
    const recovery = await runTransactionRecovery()
    if (recovery.completed.length + recovery.rolledBack.length + recovery.frozen.length > 0) {
      bumpAvdEpoch()
      read = await readDeviceStore()
    }
  }
  await ensureFrameIndex()
  storeHealth = read.health
  suspectIds = read.suspectIds
  acceptedMetas = read.health.state === 'error' ? null : read.metas
  devices = rebuildDevices(read.metas)
  applyFrozenTargets(devices)
  applyScan(await scanCurrent())
}

/** 首载事务恢复（内容裁决见 configTransaction）；冻结目标记录消息并落到行内 lastError */
const runTransactionRecovery = async (): Promise<RecoveryResult> => {
  const dir = transactionsDir(app.getPath('userData'))
  const recovery = await recoverPendingTransactions({
    dir,
    readMetas: async () => (await readDeviceStore()).metas,
    configRawOf: (id) => readAvdConfigRaw(id, avdDirs()),
    writeConfigRaw: (id, content, expected) => writeAvdConfigRaw(id, avdDirs(), content, expected),
    removeDeviceJournal: (id) => removeJournal(dir, id)
  })
  for (const target of recovery.frozen) frozenMessages.set(target.deviceId, target.message)
  return recovery
}

/** 冻结目标行内提示（rebuildDevices 后运行字段保留，此处只补 lastError 语义） */
const applyFrozenTargets = (list: Device[]): void => {
  for (const device of list) {
    const message = frozenMessages.get(device.id)
    if (message === undefined || device.lastError?.code === 'config-transaction') continue
    device.lastError = { code: 'config-transaction', message }
  }
}

/** 文件扫描（长任务，writeQueue 外运行）；服务异常收敛为 scanError 不 reject。
 * transient 行（creating/deleting）不进单目标核验（review P2-2）：半成品文件不是
 * 稳定目标，扫描只会误报 missing/broken 并误弹汇总；孤立组另由 transientIds 暂缓。 */
const scanCurrent = async (): Promise<ReconcileOutcome> => {
  try {
    return await runReconciliation({
      metas: devices
        .filter((device) => device.status !== 'creating' && device.status !== 'deleting')
        .map(toMeta),
      badMetaIds: new Set(suspectIds),
      transientIds: transientIdsNow(),
      dirs: reconcileDirs()
    })
  } catch (error) {
    return {
      checkedAt: Date.now(),
      availabilityById: new Map(),
      orphans: [],
      unrecognizedCount: 0,
      scanError: msg('scanServiceError', { message: messageOf(error) })
    }
  }
}

/** 变化检测键：availability/storeHealth/报告摘要与 scanError/avd-missing 清理——checkedAt 不参与 */
const changeKey = (): string =>
  JSON.stringify({
    store: storeHealth,
    summary: reconciliationSummaryNow(),
    scanError: lastReport?.scanError ?? null,
    devices: devices.map((device) => [
      device.id,
      device.availability?.state ?? null,
      device.availability?.issues.map((issue) => [issue.code, issue.severity]) ?? null,
      device.lastError?.code ?? null
    ])
  })

/** 合并一轮扫描：只写 availability 与报告，运行字段原样保留；无语义变化不广播 */
const applyScan = (outcome: ReconcileOutcome): void => {
  const before = changeKey()
  for (const device of devices) {
    const availability = outcome.availabilityById.get(device.id)
    if (availability === undefined) continue
    device.availability = availability
    // 只清理对账能确认恢复的 avd-missing；其他启动/删除/摄像头错误按原命令规则处理
    if (availability.state === 'valid' && device.lastError?.code === 'avd-missing') {
      device.lastError = undefined
    }
  }
  lastReport = buildReport(outcome)
  if (changeKey() !== before) broadcastChanged()
  // 异常清零后复位确认记录（review P3）：同内容异常复发时重新提示
  if (lastReport.signature === null) acknowledgedSignature = null
  syncReportRevision()
}

/** report.revision 对齐发布快照的代次（review P3——原恒差 1） */
const syncReportRevision = (): void => {
  if (lastReport !== null) lastReport = { ...lastReport, revision }
}

/**
 * 逐设备核验后的报告刷新（review P3）：行内 availability 更新也同步 deviceIssues/
 * 签名/摘要——避免汇总条空文案常驻、详情滞留已修复的异常。orphan/scanError/checkedAt
 * 沿上一轮（这两条路径不重扫文件，上一轮结论仍有效）。
 */
const refreshReportFromDevices = (): void => {
  if (lastReport === null) return
  const deviceIssues = collectDeviceIssues()
  const signature = computeSignature(
    {
      orphans: lastReport.orphanEntries,
      unrecognizedCount: lastReport.unrecognizedCount,
      scanError: lastReport.scanError
    },
    deviceIssues
  )
  lastReport = {
    ...lastReport,
    deviceIssues,
    signature,
    pendingNotification: signature !== null && signature !== acknowledgedSignature
  }
  if (signature === null) acknowledgedSignature = null
}

const buildReport = (outcome: ReconcileOutcome): ReconcileReport => {
  const deviceIssues = collectDeviceIssues()
  const signature = computeSignature(outcome, deviceIssues)
  return {
    revision,
    signature,
    checkedAt: outcome.checkedAt,
    storeHealth,
    deviceIssues,
    orphanEntries: outcome.orphans,
    unrecognizedCount: outcome.unrecognizedCount,
    pendingIds: [...transientIdsNow()],
    scanError: outcome.scanError,
    // 已确认过的签名不再提示；重查异常变化（新签名）才重新提示
    pendingNotification: signature !== null && signature !== acknowledgedSignature
  }
}

/** 报告口径的受影响设备：排除 checking（事务中/暂缓判断——review P2-2，不计数不进
 * 签名）；非 valid 或带 warning 的稳定设备进入 */
const collectDeviceIssues = (): ReconcileReport['deviceIssues'] =>
  devices
    .filter(
      (device) =>
        device.availability !== undefined &&
        device.availability.state !== 'checking' &&
        (device.availability.state !== 'valid' || device.availability.issues.length > 0)
    )
    .map((device) => ({ id: device.id, name: device.name, availability: device.availability! }))

/**
 * 异常内容签名：状态与 code 集（不含 message/时间戳；scanError 也不参与——
 * 它是本轮未完成的元状态，不构成新异常内容，避免放弃轮重复弹窗，review P3）。
 */
const computeSignature = (
  outcome: Pick<ReconcileOutcome, 'orphans' | 'unrecognizedCount' | 'scanError'>,
  deviceIssues: ReconcileReport['deviceIssues']
): string | null => {
  const hasAnomaly =
    storeHealth.state !== 'ok' ||
    storeHealth.issues.length > 0 ||
    deviceIssues.some((entry) => entry.availability.state !== 'valid') ||
    outcome.orphans.length > 0 ||
    outcome.unrecognizedCount > 0
  if (!hasAnomaly) return null
  return JSON.stringify({
    storeState: storeHealth.state,
    store: storeHealth.issues.map((issue) => [issue.code, issue.entryIndex ?? -1]),
    devices: deviceIssues
      .filter((entry) => entry.availability.state !== 'valid')
      .map((entry) => [
        entry.id,
        entry.availability.state,
        entry.availability.issues
          .map((issue) => [issue.component, issue.code, issue.severity])
          .sort()
      ]),
    orphans: outcome.orphans.map((entry) => [entry.id, entry.kind]),
    unrecognized: outcome.unrecognizedCount
  })
}

const reconciliationSummaryNow = (): ReconciliationSummary => ({
  signature: lastReport?.signature ?? null,
  unavailableCount: devices.filter(
    (device) =>
      device.availability !== undefined &&
      device.availability.state !== 'valid' &&
      device.availability.state !== 'checking'
  ).length,
  orphanCount: lastReport?.orphanEntries.length ?? 0,
  storeState: storeHealth.state,
  pendingNotification: lastReport?.pendingNotification ?? false
})

/** 人工重查/事务收尾共用单飞；完成后清空——下一次调用重新执行 */
const reconcileDevices = (): Promise<ReconcileResult> => {
  if (reconcilePromise === null) {
    reconcilePromise = performReconcile().finally(() => {
      reconcilePromise = null
    })
  }
  return reconcilePromise
}

const performReconcile = async (): Promise<ReconcileResult> => {
  await ensureLoaded()
  // 元数据重读与健康保护状态提交经 writeQueue 串行（与 commitMetas 互斥）
  await enqueueStoreTask(() => rereadStore())
  // 长文件扫描在队列外；代次变化则整轮重查（上限 3 次防反复失效）
  let outcome: ReconcileOutcome | null = null
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const startMeta = metaRevision
    const startEpoch = avdEpoch
    outcome = await scanCurrent()
    if (startMeta === metaRevision && startEpoch === avdEpoch) break
    outcome = null
  }
  if (outcome === null) {
    // 三轮代次全部失配（review P3）：保留上一轮结果与 checkedAt，只叠加未完成说明
    // ——不伪装刚检查过、不抹掉既有 orphans/deviceIssues；scanError 不参与签名，不重弹
    if (lastReport !== null) {
      const before = changeKey()
      lastReport = {
        ...lastReport,
        scanError: msg('reconcileChurn')
      }
      if (changeKey() !== before) broadcastChanged()
      syncReportRevision()
    }
    return { snapshot: snapshotNow(), report: lastReport! }
  }
  applyScan(outcome)
  return { snapshot: snapshotNow(), report: lastReport! }
}

const deepEqual = (a: unknown, b: unknown): boolean => {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  // undefined 值键视为缺失（review P3）：内存投影可能带 undefined 值键，JSON 往返会丢，
  // 不区分会把合法一致误判成 metadata-changed（回归即全库误冻结）
  const keysOf = (value: object): string[] =>
    Object.keys(value)
      .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
      .sort()
  const keysA = keysOf(a)
  const keysB = keysOf(b)
  if (keysA.length !== keysB.length || keysA.some((key, index) => key !== keysB[index])) {
    return false
  }
  return keysA.every((key) =>
    deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])
  )
}

const metasEqual = (a: DeviceMeta[], b: DeviceMeta[]): boolean =>
  a.length === b.length && a.every((meta, index) => deepEqual(meta, b[index]))

/** 受控重读（writeQueue 内执行）：error 保留现状；与最后接纳一致解除保护；不一致冻结并提示重启 */
const rereadStore = async (): Promise<void> => {
  const read = await readDeviceStore()
  if (read.health.state === 'error') {
    storeHealth = read.health
    suspectIds = read.suspectIds
    return
  }
  if (acceptedMetas === null) {
    // 初载 error 后首次成功重读：首次建立可信列表（同 id 保留运行字段；初载 error
    // 时 devices 必为空，运行字段保留是防御性口径）
    storeHealth = read.health
    suspectIds = read.suspectIds
    acceptedMetas = read.metas
    devices = rebuildDevices(read.metas)
    return
  }
  if (!metasEqual(read.metas, acceptedMetas)) {
    // 外部改名/重排/删行（含文件消失）：保留内存与运行设备，冻结写入，提示重启载入
    if (read.health.state === 'ok') {
      armStoreProtection(msg('storeExternalModifiedFrozen'))
    }
    storeHealth = {
      state: 'read-only',
      issues: [
        ...read.health.issues,
        {
          code: 'metadata-changed',
          message: msg('storeExternalModifiedAtLoad')
        }
      ]
    }
    suspectIds = read.suspectIds
    return
  }
  // 与最后接纳一致：readDeviceStore 的 ok 已解除写保护（生产唯一解除入口）
  storeHealth = read.health
  suspectIds = read.suspectIds
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
  ...(device.cutoutResetPending === true ? { cutoutResetPending: true } : {}),
  createdAt: device.createdAt
})

/** 全局串行队列：元数据提交与受控重读共用（对账设计 3——保护状态提交不与写盘交错） */
const enqueueStoreTask = <T>(task: () => Promise<T>): Promise<T> => {
  const run = writeQueue.then(task)
  writeQueue = run.then(
    () => undefined,
    () => undefined
  ) // 单次失败不断队列
  return run
}

/**
 * 提交后重建内存列表：在途创建的临时行（creating 且不在草稿里）追加在末尾保进度。
 * 复查 P2-1：写盘基线是已提交元数据，临时行只在内存展示，不因提交而丢失或落盘。
 */
const rebuildWithPendingRows = (draft: DeviceMeta[]): Device[] => {
  const committedIds = new Set(draft.map((meta) => meta.id))
  return [
    ...rebuildDevices(draft),
    ...devices.filter((device) => device.status === 'creating' && !committedIds.has(device.id))
  ]
}

/**
 * 元数据提交全局串行；写盘成功才改内存（issue 2026-10-03 落盘分叉的修法）。
 * 写前 CAS（review P3）：现有文件与最后接纳不一致（运行中被外部修改）→ 中止并冻结，
 * 不静默覆盖；草稿基线是 acceptedMetas（复查 P2-1：其他事务的创建临时行不进写盘
 * 内容，每个事务只发布已提交行）；内存按草稿重建并保留完整运行字段与临时行。
 * 残留事务门（复查 P2-2）：本次内容变化命中待清理 journal 的设备先重试清理，
 * 失败即中止——应用不能把元数据改出记录 old/new 之外，否则重启恢复误判外部修改。
 */
const commitMetas = (mutate: (metas: DeviceMeta[]) => DeviceMeta[]): Promise<void> =>
  enqueueStoreTask(async () => {
    const guard = await readDeviceStore()
    if (
      guard.health.state !== 'error' &&
      acceptedMetas !== null &&
      !metasEqual(guard.metas, acceptedMetas)
    ) {
      armStoreProtection(msg('storeExternalModifiedAtWrite'))
      storeHealth = {
        state: 'read-only',
        issues: [
          ...guard.health.issues,
          {
            code: 'metadata-changed',
            message: msg('storeWriteAbortedV1')
          }
        ]
      }
      throw new Error(msg('storeExternalModifiedAborted'))
    }
    if (acceptedMetas === null) {
      // 理论不可达（error 态已被 assertMetaWritable 拦截）；防御性拒绝，不以全内存落盘
      throw new Error(msg('noTrustedBaseline'))
    }
    const draft = mutate([...acceptedMetas])
    const journalDir = transactionsDir(app.getPath('userData'))
    for (const meta of draft) {
      const prev = acceptedMetas.find((entry) => entry.id === meta.id)
      if (prev === undefined || deepEqual(prev, meta)) continue
      if (!pendingJournalCleanup.has(meta.id)) continue
      const label = devices.find((entry) => entry.id === meta.id)?.name ?? meta.id
      try {
        await removeJournal(journalDir, meta.id)
        pendingJournalCleanup.delete(meta.id)
      } catch (error) {
        throw new Error(msg('configJournalStale', { label, message: messageOf(error) }))
      }
    }
    await writeDeviceMetas(draft)
    devices = rebuildWithPendingRows(draft)
    acceptedMetas = draft
    metaRevision += 1
  })

const snapshotNow = (): DeviceSnapshot => ({
  revision,
  devices: devices.map((device) => ({ ...device })),
  storeHealth,
  reconciliation: reconciliationSummaryNow()
})

const broadcastChanged = (): void => {
  revision += 1
  const snapshot = snapshotNow()
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(IPC_CHANNELS.devicesChanged, snapshot)
  }
}

/** 窗口上下文窄视图（日志窗下拉等）：只暴露 id/名称/运行态/serial/runId——
 *  相比全量快照不扩散健康详情、镜像与附加设置；各消费域仍须自行守卫 sender */
export const listDeviceRuntimeViews = (): DeviceRuntimeView[] =>
  devices.map((device) => ({
    id: device.id,
    name: device.name,
    status: device.status,
    serial: device.serial,
    runId: device.runId
  }))

const requireDevice = (id: string): Device => {
  const device = devices.find((entry) => entry.id === id)
  if (!device) throw new Error(msg('deviceNotFound', { id }))
  return device
}

/** 安装域注入用（plan 2026-10-10-drag-apk-install）：断言设备 running 并返回 serial；
 *  未 running 抛本地化错误——与 copySerial 同一守卫口径 */
export const runningDeviceSerial = (id: string): string => {
  const device = requireDevice(id)
  if (device.status !== 'running' || !device.serial) {
    throw new Error(msg('apkDeviceNotRunning'))
  }
  return device.serial
}

/** 元数据写命令的副作用前守卫（对账设计 3）：error/read-only 都拒绝并说明原因 */
const assertMetaWritable = (action: string): void => {
  if (storeHealth.state === 'error') {
    throw new Error(
      msg('storeErrorBlocked', {
        issues: storeHealth.issues[0]?.message ?? msg('unknownError'),
        action
      })
    )
  }
  if (storeHealth.state === 'read-only') {
    throw new Error(
      msg('storeReadonlyBlocked', {
        issues: storeHealth.issues.map((issue) => issue.message).join('；'),
        action
      })
    )
  }
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
  info: { code: number; stderrTail: string; stdoutTail: string }
): void => {
  const device = devices.find((entry) => entry.id === id)
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
class StartBlockedError extends Error {
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
const withDeadline = async <T>(promise: Promise<T>, fallback: () => T, ms: number): Promise<T> => {
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

const checkTimeoutAvailability = (): DeviceAvailability => ({
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
const displayArgsByDevice = new Map<string, { runId: string; args: string[] }>()

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
const cameraOverridesByDevice = new Map<string, { runId: string; front: boolean; rear: boolean }>()

/** argv 里的 -camera-front/-camera-back 改写为 emulated；没有则追加 */
const applyCameraFallbackOverride = (
  args: string[],
  flag: '-camera-front' | '-camera-back'
): void => {
  const index = args.indexOf(flag)
  if (index !== -1 && index + 1 < args.length) args[index + 1] = 'emulated'
  else args.push(flag, 'emulated')
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
  beforeStart: async (id, runId, signal) => {
    displayArgsByDevice.delete(id)
    const device = devices.find((entry) => entry.id === id)
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
    const current = devices.find((entry) => entry.id === id)
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
      for (const entry of devices) {
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
        const row = devices.find((entry) => entry.id === id)
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
    const device = devices.find((entry) => entry.id === id)
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

// ---- 生命周期流程 ----

const startDevice = async (id: string): Promise<DeviceSnapshot> => {
  if (!acceptingCommands) throw new Error(msg('appClosingNoStart'))
  await ensureLoaded()
  const device = requireDevice(id)
  if (editFlights.has(id)) throw new Error(msg('blockStartWhileSaving'))
  if (device.status === 'starting' || device.status === 'running') return snapshotNow()
  if (device.status === 'stopping') throw new Error(msg('startWhileStopping'))
  if (device.status !== 'stopped')
    throw new Error(msg('startStateNotAllowed', { status: device.status }))
  // 检查前同步保留 runId 并进入 starting（对账设计 4）：文件/摄像头核验移入
  // runner 准备——可取消、迟到结果不 spawn；未知检查结果不允许启动
  device.status = 'starting'
  device.lastError = undefined
  device.cameraNotice = undefined
  device.startedAt = Date.now()
  const attemptId = randomUUID()
  device.runId = attemptId
  broadcastChanged()
  try {
    const { runId, serial } = await runner.start(id, attemptId)
    const target = devices.find((entry) => entry.id === id)
    if (target?.runId === attemptId && target.status === 'starting') {
      target.runId = runId
      target.serial = serial
      broadcastChanged()
    }
  } catch (error) {
    if (error instanceof StartCancelledError) return snapshotNow()
    const target = devices.find((entry) => entry.id === id)
    if (target?.runId === attemptId && target.status === 'starting') {
      target.status = 'stopped'
      target.serial = undefined
      target.runId = undefined
      target.startedAt = undefined
      const blocked = error instanceof StartBlockedError ? error : null
      if (blocked?.availability !== undefined) target.availability = blocked.availability
      target.lastError = { code: blocked?.blockCode ?? 'start-failed', message: messageOf(error) }
      broadcastChanged()
    }
    throw error
  }
  return snapshotNow()
}

const stopDevice = async (id: string): Promise<DeviceSnapshot> => {
  await ensureLoaded()
  const device = requireDevice(id)
  if (device.status !== 'running' && device.status !== 'stopping') {
    throw new Error(device.status === 'starting' ? msg('stopWhileStarting') : msg('stopNotRunning'))
  }
  device.status = 'stopping'
  broadcastChanged()
  try {
    await runner.stop(id)
  } catch (error) {
    const target = requireDevice(id)
    if (target.status === 'stopping') {
      target.lastError = {
        code: 'stop-failed',
        message: msg('stopFailedError', { message: messageOf(error) })
      }
      broadcastChanged()
    }
    throw error
  }
  const target = requireDevice(id)
  if (target.status === 'stopping') {
    target.status = 'stopped'
    target.serial = undefined
    target.cameraNotice = undefined
    cameraOverridesByDevice.delete(id)
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
    throw new Error(msg('cancelWhileRunning'))
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
    target.startedAt = undefined
    target.cameraNotice = undefined
    cameraOverridesByDevice.delete(id)
    broadcastChanged()
    streamBridge.stopped?.(target.id)
  }
  return snapshotNow()
}

const deleteFlow = async (id: string): Promise<DeviceSnapshot> => {
  await ensureLoaded()
  const device = requireDevice(id)
  if (device.status === 'creating') throw new Error(msg('deleteWhileCreating'))
  if (editFlights.has(id)) throw new Error(msg('blockDeleteWhileSaving'))
  // 副作用前守卫（对账设计 4）：库不可写时拒绝——删了 AVD 却删不掉元数据会留幽灵记录
  assertMetaWritable(msg('actionDelete'))
  if (device.status === 'starting') await cancelStartDevice(id)
  else if (device.status === 'running' || device.status === 'stopping') await stopDevice(id)
  if (requireDevice(id).status !== 'stopped') throw new Error(msg('deleteStopIncomplete'))
  // 停止后、FS 删除前再检查保护（停止耗时期间外部可能改坏库）
  assertMetaWritable(msg('actionDelete'))
  bumpAvdEpoch()
  requireDevice(id).status = 'deleting'
  broadcastChanged()
  try {
    // 删除的文件操作与 JSON 写入无法原子提交：分别报错，失败保留异常记录。
    // deleteAvd 只删 id 推导的两条路径（containment 守卫），不跟随 ini 外指
    await deleteAvd(id, avdDirs())
    await commitMetas((metas) => metas.filter((meta) => meta.id !== id))
    displayArgsByDevice.delete(id)
    // 目标已删：残留的配置事务记录一并清理（内容裁决不再有对照目标）
    await removeJournal(transactionsDir(app.getPath('userData')), id).catch(() => undefined)
    frozenMessages.delete(id)
    bumpAvdEpoch()
    broadcastChanged()
    void reconcileDevices().catch(() => undefined)
    return snapshotNow()
  } catch (error) {
    const target = devices.find((entry) => entry.id === id)
    if (target) {
      target.status = 'stopped'
      target.lastError = {
        code: 'delete-failed',
        message: `删除未完成：${messageOf(error)}；AVD 目录可能残留，可重试删除`
      }
      // 文件已删但 JSON 失败：行内核验反映实际剩余状态（可能已 missing）；
      // 与启动前置同额期限（review P3——裸 await 在 FS 停摆时会悬挂整个删除流）
      try {
        target.availability = await withDeadline(
          checkDeviceHealth(toMeta(target), reconcileDirs()),
          checkTimeoutAvailability,
          CHECK_TIMEOUT_MS
        )
      } catch {
        // 核验失败保留原健康态，下轮对账兜底
      }
    }
    bumpAvdEpoch()
    refreshReportFromDevices()
    broadcastChanged()
    syncReportRevision()
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
  // 外观索引刷新（外框支：每次创建重读 JAR，SDK 更新自动失效；空索引不阻断）
  await ensureFrameIndex()
  // 共享初始化后先检查写保护（对账设计 4）：不可写库不进画像/能力查询
  assertMetaWritable(msg('actionCreate'))
  const packageName = raw.imagePackageName
  // 同包的进行中卸载/下载拒绝创建（review 2026-10-06 P2 TOCTOU：引用守卫
  // 通过后、卸载执行完的窗口内不再建出引用即将消失镜像的设备）
  const op = activePackageOp()
  if (op !== null && op.packageName === packageName) {
    throw new Error(
      op.kind === 'uninstall'
        ? `镜像正在卸载（${packageName}），请等待完成后再创建设备`
        : `镜像正在下载（${packageName}），下载完成后再创建设备`
    )
  }
  // 创建意向全程持有（review P2-2 残窗收口）：本地扫描/画像重查的秒级 await
  // 间隙里，同包下载/卸载会被 beginPackageOp 与卸载守卫拒绝——设备临时行此
  // 时尚未入列，引用查询看不到它
  beginPackageCreation(packageName)
  try {
    return await createDeviceTransaction(raw, packageName)
  } finally {
    endPackageCreation(packageName)
  }
}

const createDeviceTransaction = async (
  raw: CreateDeviceInput,
  packageName: string
): Promise<CreateDeviceResult> => {
  // 创建时重新核验（plan 设计 2：拒绝陈旧选择）——镜像完整安装 + 画像仍可创建 + 兼容性
  const local = await scanLocalImages(sdkRoot())
  const imageRecord = local.get(packageName)
  if (imageRecord?.verified !== true) {
    throw new Error(msg('startImageNotInstalled'))
  }
  const profiles = await listDeviceProfiles({
    sdkRoot: sdkRoot(),
    avdmanagerPath: avdmanagerPathFor(sdkRoot()),
    jarPath: sdklibJarPathFor(sdkRoot())
  })
  const profile = profiles.find((entry) => entry.id === raw.profileId)
  if (profile === undefined || !profile.creatable) {
    throw new Error(msg('profileNotCreatable'))
  }
  const { major, minor } = parseApiVersion(imageRecord.apiLevelText)
  const verdict = assessImageCompatibility(
    profile,
    {
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
    },
    getLocaleState()
  )
  if (verdict.status !== 'supported') {
    throw new Error(msg('compatReject', { reasons: verdict.reasons.join('；') }))
  }
  // 设置归一化（能力上下文 = 当前画像×镜像×emulator，经唯一入口补齐皮肤/摄像头
  // 枚举——review P1：与向导能力查询同源，UI 放行的设置创建侧同样放行）：
  // 字段错误拒绝创建，Quick 未开放回落 Cold——伪造入参不改变开放门槛
  const capabilities = await buildEnrichedCapabilities(
    {
      profile,
      imagePackageName: packageName,
      emulatorVersion: await readEmulatorVersion(sdkRoot())
    },
    sdkRoot(),
    app.getPath('userData')
  )
  const normalized = normalizeAdvancedSettings(
    (raw.advancedSettings as CreateDeviceInput['advancedSettings']) ?? null,
    capabilities,
    getLocaleState()
  )
  if (Object.keys(normalized.errors).length > 0) {
    const first = Object.entries(normalized.errors)[0] as [string, string]
    throw new Error(msg('advancedSettingsInvalid', { field: first[0], message: first[1] }))
  }
  const advancedSettings = normalized.settings
  // 查询结束后、AVD 副作用前再次检查写保护（对账设计 4——查询窗口内库可能变坏）
  assertMetaWritable(msg('actionCreate'))
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
    frameKind: frameKindOf(raw.profileId),
    availability: checkingAvailability(),
    status: 'creating'
  }
  bumpAvdEpoch()
  devices = [...devices, device]
  broadcastChanged()
  try {
    // 事务：AVD 真建成功 → config patch（白名单键、保留未知键）→ 元数据落盘成功
    // → 才转停止；任一失败撤回临时行并回滚 AVD
    await createAvd({ avdName: device.id, profileId: raw.profileId, packageName }, avdDirs())
    if (advancedSettings !== null) {
      const patch = settingsToConfigPatch(advancedSettings)
      // 导入/下载皮肤：config 写绝对 skin.path（应用自有目录，随库稳定）
      if (advancedSettings.skinRef !== null && !advancedSettings.skinRef.startsWith('sdk:')) {
        patch['skin.path'] = skinDirectoryFor(advancedSettings.skinRef)
      }
      await patchAvdConfig(device.id, avdDirs(), patch)
    }
    // 临时行已在内存里：按 id upsert，避免重复条目
    await commitMetas((metas) => [...metas.filter((meta) => meta.id !== device.id), toMeta(device)])
    requireDevice(device.id).status = 'stopped'
    // 事务收尾核验（对账设计 4）：config patch 与提交成功后核验为稳定设备；
    // 核验发现异常保留已提交行并回报健康问题，不当创建失败再自动删 AVD。
    // 期限与启动前置同额（review P3），核验后同步刷新报告避免汇总/详情滞留旧异常
    const settled = requireDevice(device.id)
    try {
      settled.availability = await withDeadline(
        checkDeviceHealth(toMeta(settled), reconcileDirs()),
        checkTimeoutAvailability,
        CHECK_TIMEOUT_MS
      )
    } catch (error) {
      settled.availability = {
        state: 'inaccessible',
        issues: [
          {
            component: 'avd',
            code: 'check-error',
            message: msg('createVerifyFailed', { message: messageOf(error) }),
            severity: 'error'
          }
        ],
        checkedAt: Date.now()
      }
    }
    bumpAvdEpoch()
    refreshReportFromDevices()
    broadcastChanged()
    syncReportRevision()
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
    bumpAvdEpoch()
    // 失败/回滚结束后扫描残留（对账设计 4）：残留目录由孤立组报告反映
    void reconcileDevices().catch(() => undefined)
    if (rollbackError !== null) {
      const main = error instanceof Error ? error.message : String(error)
      throw new Error(
        msg('createFailedRollbackFailed', {
          main,
          rollback: rollbackError,
          dir: join(avdHome(), `${device.id}.avd`)
        })
      )
    }
    throw error
  }
}

const renameDevice = async (id: string, name: string): Promise<DeviceSnapshot> => {
  await ensureLoaded()
  const device = requireDevice(id)
  if (device.status === 'creating' || device.status === 'deleting') {
    throw new Error(msg('renameWhileBusy'))
  }
  if (editFlights.has(id)) throw new Error(msg('blockRenameWhileSaving'))
  assertMetaWritable(msg('actionRename'))
  await commitMetas((metas) => metas.map((meta) => (meta.id === id ? { ...meta, name } : meta)))
  broadcastChanged()
  return snapshotNow()
}

// ---- 配置编辑域（plan 2026-10-08-device-config-edit）----

/** 开编辑窗前核验（wizard 域装配用）：设备存在且不在创建/删除事务中 */
export const assertEditorTarget = async (id: string): Promise<void> => {
  await ensureLoaded()
  const device = requireDevice(id)
  if (device.status === 'creating' || device.status === 'deleting') {
    throw new Error(msg('editWhileBusyRetry'))
  }
}

/** 保存前置阻断原因（快照与更新共用口径）；null = 可保存 */
const editSaveBlockedReason = (device: Device, includeRuntime = true): string | null => {
  const frozen = frozenMessages.get(device.id)
  if (frozen !== undefined) return frozen
  if (storeHealth.state === 'error') {
    return msg('blockSaveStoreError', {
      issues: storeHealth.issues[0]?.message ?? msg('unknownError')
    })
  }
  if (storeHealth.state === 'read-only') {
    return msg('blockSaveStoreFrozen', {
      issues: storeHealth.issues.map((issue) => issue.message).join('；')
    })
  }
  if (device.status === 'creating' || device.status === 'deleting') {
    return msg('blockSaveWhileBusy')
  }
  if (includeRuntime && (device.status === 'running' || device.status === 'starting')) {
    return msg('blockSaveWhileRunning')
  }
  if (includeRuntime && device.status === 'stopping') return msg('blockSaveWhileStopping')
  return null
}

/** legacy 摄像头键解析：known 模式直映射（virtualscene 接纳小写与历史 camelCase），
 *  webcamN 保留资源 id，其余不可识别 */
const parseLegacyCamera = (
  text: string | undefined
): { mode: 'none' | 'emulated' | 'virtualScene' | 'webcam'; deviceId: string | null } | null => {
  if (text === 'none' || text === 'emulated') {
    return { mode: text, deviceId: null }
  }
  if (text === 'virtualscene' || text === 'virtualScene') {
    return { mode: 'virtualScene', deviceId: null }
  }
  if (text !== undefined && /^webcam\d+$/.test(text)) {
    return { mode: 'webcam', deviceId: text }
  }
  return null
}

const metadataNote = (): DeviceEditFieldNote => ({ source: 'metadata', warning: null })
const legacyNote = (): DeviceEditFieldNote => ({ source: 'legacy', warning: null })

interface EditDraft {
  mismatches?: DeviceConfigMismatch[]
  settings: DeviceAdvancedSettings | null
  blockedReason?: string
  notes: Record<string, DeviceEditFieldNote>
  storage: DeviceEditStorageInfo
}

/**
 * 编辑回填草稿（读取快照与保存复验共用单源）：已存设置按 metadata 回填并核对
 * config 一致性；legacy（null 设置）按实际生效语义构造（Cold/host/无网络参数），
 * 数值缺省查 config → 所装 schema → unknown（不以新建默认值冒充已存值）。
 */
const buildEditDraft = (
  meta: DeviceMeta,
  configMap: Map<string, string>,
  schemaDefaults: Record<string, string>,
  capabilities: { skinIds: string[] }
): EditDraft => {
  const notes: Record<string, DeviceEditFieldNote> = {}
  const stored = meta.advancedSettings
  if (stored !== null) {
    const mismatches = configMismatchesOf(stored, configMap, { ...capabilities, skinDirectoryFor })
    for (const item of mismatches) {
      notes[item.field] = {
        source: 'metadata',
        warning: `${msg('mismatchPendingNote', { label: String(item.actualLabel) })}${item.actualSettings === null ? msg('unrecognizedSuffix') : ''}`
      }
    }
    const configStorage = storageMiBFromText(configMap.get('disk.dataPartition.size'))
    if (configStorage !== null && configStorage !== stored.internalStorageMiB) {
      notes.internalStorageMiB = {
        source: 'metadata',
        warning: msg('storageMismatch', { value: configStorage })
      }
    }
    const fields: Array<keyof DeviceAdvancedSettings> = [
      'skinRef',
      'frontCamera',
      'rearCamera',
      'networkSpeed',
      'networkLatency',
      'orientation',
      'bootMode',
      'internalStorageMiB',
      'cpuCores',
      'graphics',
      'ramMiB',
      'vmHeapMiB',
      'preferredAbi'
    ]
    const settings = { ...stored }
    for (const field of fields) if (notes[field] === undefined) notes[field] = metadataNote()
    return {
      settings,
      notes,
      mismatches,
      storage: {
        valueMiB: stored.internalStorageMiB,
        note: msg('storageFixedNote')
      }
    }
  }

  // legacy（无已存设置）：Cold/host 固定语义 + config/schema 回退
  const numberFrom = (
    key: string,
    label: string
  ): { value: number | null; note: DeviceEditFieldNote } => {
    const configText = configMap.get(key)
    const fromConfig =
      configText !== undefined && /^\d+$/.test(configText) ? Number(configText) : NaN
    if (Number.isFinite(fromConfig) && fromConfig > 0)
      return { value: fromConfig, note: { source: 'config', warning: null } }
    // 显式自动值/不可识别值不能被 schema 的默认值替代。
    const fromSchema =
      configText === undefined && /^\d+$/.test(schemaDefaults[key] ?? '')
        ? Number(schemaDefaults[key])
        : NaN
    if (Number.isFinite(fromSchema) && fromSchema > 0) {
      return {
        value: fromSchema,
        note: {
          source: 'schema',
          warning: msg('enumNotInConfig', { label })
        }
      }
    }
    return {
      value: null,
      note: { source: 'unknown', warning: msg('enumUnknownKeep', { label }) }
    }
  }
  const cameraFrom = (
    key: string
  ): { config: DeviceAdvancedSettings['frontCamera'] | null; note: DeviceEditFieldNote } => {
    const fromConfig = parseLegacyCamera(configMap.get(key))
    if (fromConfig !== null) {
      return { config: fromConfig, note: { source: 'config', warning: null } }
    }
    const fromSchema = configMap.has(key) ? null : parseLegacyCamera(schemaDefaults[key])
    if (fromSchema !== null) {
      return {
        config: fromSchema,
        note: { source: 'schema', warning: msg('cameraNotInConfig') }
      }
    }
    return {
      config: null,
      note: { source: 'unknown', warning: msg('cameraUnrecognizedKeep') }
    }
  }
  const cpu = numberFrom('hw.cpu.ncore', 'CPU 核数')
  const ram = numberFrom('hw.ramSize', 'RAM')
  const heap = numberFrom('vm.heapSize', 'VM heap')
  const front = cameraFrom('hw.camera.front')
  const rear = cameraFrom('hw.camera.back')
  // legacy runner 显式 -gpu host 优先于 config，不能在首次编辑时改变。
  const graphics = 'host' as const
  const storageConfig = storageMiBFromText(configMap.get('disk.dataPartition.size'))
  const storageSchema = storageMiBFromText(schemaDefaults['disk.dataPartition.size'])

  const storageValue =
    storageConfig ?? (configMap.has('disk.dataPartition.size') ? null : storageSchema)
  const knownStorage = storageValue !== null && storageValue > 0 ? storageValue : null
  const skinName = configMap.get('skin.name')
  const skinPath = configMap.get('skin.path')
  const hasNamedSkin = Boolean(skinPath || (skinName && !/^\d+x\d+$/.test(skinName)))
  const skinRef = hasNamedSkin
    ? (capabilities.skinIds.find(
        (ref) =>
          ref.replace(/^(sdk|imported|downloaded):/, '') === skinName ||
          (skinPath && skinPath.endsWith(`/${ref.replace(/^(sdk|imported|downloaded):/, '')}`))
      ) ?? null)
    : null
  const orientationText = configMap.get('hw.initialOrientation')
  const orientation =
    orientationText === 'portrait' || orientationText === 'landscape' ? orientationText : null
  const incomplete =
    cpu.value === null ||
    ram.value === null ||
    heap.value === null ||
    front.config === null ||
    rear.config === null ||
    knownStorage === null ||
    (hasNamedSkin && skinRef === null) ||
    (orientationText !== undefined && orientation === null)
  return {
    settings: incomplete
      ? null
      : {
          skinRef,
          frontCamera: front.config!,
          rearCamera: rear.config!,
          networkSpeed: null,
          networkLatency: null,
          orientation,
          bootMode: 'cold',
          internalStorageMiB: knownStorage!,
          cpuCores: cpu.value!,
          graphics,
          ramMiB: ram.value!,
          vmHeapMiB: heap.value!,
          preferredAbi: 'optimal'
        },
    ...(incomplete
      ? {
          blockedReason: msg('settingsBlockedLegacy')
        }
      : {}),
    notes: {
      skinRef: {
        source: hasNamedSkin ? 'config' : 'legacy',
        warning: hasNamedSkin && skinRef === null ? msg('skinUnrecognizedKeep') : null
      },
      frontCamera: front.note,
      rearCamera: rear.note,
      networkSpeed: legacyNote(),
      networkLatency: legacyNote(),
      orientation: { source: orientation === null ? 'legacy' : 'config', warning: null },
      bootMode: legacyNote(),
      cpuCores: cpu.note,
      graphics: legacyNote(),
      ramMiB: ram.note,
      vmHeapMiB: heap.note,
      preferredAbi: legacyNote()
    },
    storage:
      knownStorage === null
        ? { valueMiB: null, note: msg('storageUnknownNote') }
        : { valueMiB: knownStorage, note: msg('storageFixedNote') }
  }
}

/** 编辑能力（与创建同规则）：按已存画像身份/形态构建，画像清单不可用不阻断；
 *  原值 webcam 并入枚举——已存但未变更的摄像头不因枚举变化被形状校验拒绝，
 *  稳定身份在保存时单独核验（stale 得到明确报错）。 */
const buildEditCapabilities = async (meta: DeviceMeta): Promise<WizardCapabilitiesLike> => {
  let profileRam: number | null = null
  try {
    const profiles = await listDeviceProfiles({
      sdkRoot: sdkRoot(),
      avdmanagerPath: avdmanagerPathFor(sdkRoot()),
      jarPath: sdklibJarPathFor(sdkRoot())
    })
    profileRam = profiles.find((entry) => entry.id === meta.profileId)?.ramMiB ?? null
  } catch {
    // 画像清单不可用：按已存形态与缺省 RAM 构建（不要求重新选择画像）
  }
  return buildEnrichedCapabilities(
    {
      profile: { id: meta.profileId, ramMiB: profileRam, formFactor: meta.formFactor },
      imagePackageName: meta.imagePackageName,
      emulatorVersion: await readEmulatorVersion(sdkRoot())
    },
    sdkRoot(),
    app.getPath('userData')
  )
}

type WizardCapabilitiesLike = Awaited<ReturnType<typeof buildEnrichedCapabilities>>

const augmentDraftWebcams = (
  capabilities: WizardCapabilitiesLike,
  settings: DeviceAdvancedSettings
): void => {
  for (const camera of [settings.frontCamera, settings.rearCamera]) {
    if (
      camera.mode === 'webcam' &&
      camera.deviceId !== null &&
      !capabilities.webcamDeviceIds.includes(camera.deviceId)
    ) {
      capabilities.webcamDeviceIds.push(camera.deviceId)
    }
  }
}

/**
 * 共享摄像头提示（设计决定 2026-10-09，复查 P2-3）：不再阻断共绑，草稿提示其他
 * 设备的有效绑定（托管设置或 legacy 的实际 config.ini）。非权威——启动仲裁才裁决；
 * 枚举失败退化为编号+宿主身份比较，legacy config 读不到按无绑定（提示可漏报）。
 */
const sharedCameraOwnersOf = async (
  id: string,
  settings: DeviceAdvancedSettings
): Promise<Partial<Record<'frontCamera' | 'rearCamera', string>>> => {
  const slots = [
    ['frontCamera', settings.frontCamera],
    ['rearCamera', settings.rearCamera]
  ] as const
  if (!slots.some(([, camera]) => camera.mode === 'webcam')) return {}
  const others = devices.filter(
    (entry) => entry.id !== id && entry.status !== 'creating' && entry.status !== 'deleting'
  )
  const bindings: Array<{ camera: DeviceAdvancedSettings['frontCamera']; owner: string }> = []
  for (const entry of others) {
    if (entry.advancedSettings !== null) {
      bindings.push(
        { camera: entry.advancedSettings.frontCamera, owner: entry.name },
        { camera: entry.advancedSettings.rearCamera, owner: entry.name }
      )
      continue
    }
    try {
      const entries = parseConfigEntries((await readAvdConfigRaw(entry.id, avdDirs())) ?? '')
      for (const key of ['hw.camera.front', 'hw.camera.back'] as const) {
        const parsed = parseLegacyCamera(entries.get(key))
        if (parsed !== null && parsed.mode === 'webcam') {
          bindings.push({ camera: parsed, owner: entry.name })
        }
      }
    } catch {
      // legacy config 读不到按无绑定：启动仲裁才是权威
    }
  }
  if (!bindings.some(({ camera }) => camera.mode === 'webcam')) return {}
  let labels: Map<string, string> | null = null
  try {
    labels = new Map((await listWebcams(sdkRoot())).map((entry) => [entry.id, entry.deviceLabel]))
  } catch {
    labels = null
  }
  const keyOf = (camera: DeviceAdvancedSettings['frontCamera']): string | null => {
    if (camera.mode !== 'webcam' || camera.deviceId === null) return null
    return camera.hostDeviceId ?? labels?.get(camera.deviceId) ?? camera.deviceId
  }
  const result: Partial<Record<'frontCamera' | 'rearCamera', string>> = {}
  for (const [field, camera] of slots) {
    const mine = keyOf(camera)
    if (mine === null) continue
    const shared = bindings.find(({ camera: other }) => keyOf(other) === mine)
    if (shared !== undefined) result[field] = shared.owner
  }
  return result
}

/** 编辑快照读取：只读，不触发启动/迁移或默认值落盘 */
const readDeviceConfig = async (id: string): Promise<DeviceEditSnapshot> => {
  await ensureLoaded()
  const device = requireDevice(id)
  if (device.status === 'creating' || device.status === 'deleting') {
    throw new Error(msg('editWhileBusy'))
  }
  const meta = toMeta(device)
  const blocked = editSaveBlockedReason(device, false)
  let configRaw: string | null = null
  let configError: string | null = null
  try {
    configRaw = await readAvdConfigRaw(id, avdDirs())
  } catch (error) {
    configError = messageOf(error)
  }
  const schemaDefaults = await readHardwareSchemaDefaults(sdkRoot()).catch(
    () => ({}) as Record<string, string>
  )
  const capabilities = await buildEditCapabilities(meta)
  const draft = buildEditDraft(
    meta,
    configRaw === null ? new Map() : parseConfigEntries(configRaw),
    schemaDefaults,
    capabilities
  )
  if (draft.settings !== null) {
    augmentDraftWebcams(capabilities, draft.settings)
    const shared = await sharedCameraOwnersOf(id, draft.settings)
    for (const field of ['frontCamera', 'rearCamera'] as const) {
      const owner = shared[field]
      if (owner === undefined) continue
      const note = draft.notes[field]
      const hint = msg('cameraSharedHint', { owner })
      draft.notes[field] = {
        ...note,
        warning:
          note.warning === null || note.warning === undefined ? hint : `${note.warning}${hint}`
      }
    }
  }
  const saveBlockedReason =
    blocked ?? configError ?? (configRaw === null ? msg('blockSaveNoConfig') : null)
  return {
    deviceId: id,
    identity: {
      name: meta.name,
      profileId: meta.profileId,
      profileLabel: meta.profileLabel,
      imagePackageName: meta.imagePackageName,
      apiDisplay: meta.apiDisplay,
      formFactor: meta.formFactor
    },
    settings: draft.settings,
    settingsBlockedReason: draft.blockedReason ?? null,
    status: requireDevice(id).status,
    fieldNotes: draft.notes,
    configMismatches: draft.mismatches ?? [],
    internalStorage: draft.storage,
    capabilities,
    saveBlockedReason,
    fingerprint: configFingerprintOf(configRaw, meta)
  }
}

const isUpdateDeviceInput = (value: unknown): value is UpdateDeviceInput => {
  if (typeof value !== 'object' || value === null) return false
  const input = value as Record<string, unknown>
  if (typeof input.id !== 'string' || input.id.length === 0) return false
  if (typeof input.fingerprint !== 'string' || input.fingerprint.length === 0) return false
  if (input.name !== undefined && typeof input.name !== 'string') return false
  if (input.resetDisplayCutout !== undefined && typeof input.resetDisplayCutout !== 'boolean')
    return false
  if (input.advancedSettings !== undefined && typeof input.advancedSettings !== 'object') {
    return false
  }
  return true
}

/** 核验本次修改或待同步的摄像头；与文件一致的旧资源不阻断无关编辑。 */
const verifyEditableCameras = async (
  original: DeviceAdvancedSettings,
  settings: DeviceAdvancedSettings,
  syncFields: readonly DeviceConfigField[] = []
): Promise<void> => {
  const changed = (
    [
      ['frontCamera', settings.frontCamera],
      ['rearCamera', settings.rearCamera]
    ] as const
  ).filter(([field, camera]) => syncFields.includes(field) || !deepEqual(original[field], camera))
  if (!changed.some(([, camera]) => camera.mode === 'webcam')) return
  let webcams: Map<string, string>
  try {
    webcams = new Map((await listWebcams(sdkRoot())).map((entry) => [entry.id, entry.deviceLabel]))
  } catch (error) {
    throw new Error(msg('saveCameraVerifyFailed', { message: messageOf(error) }))
  }
  for (const [field, camera] of changed) {
    if (camera.mode !== 'webcam' || camera.deviceId === null) continue
    if (
      !webcams.has(camera.deviceId) ||
      (camera.hostDeviceId !== undefined && webcams.get(camera.deviceId) !== camera.hostDeviceId)
    ) {
      throw new Error(msg('cameraUnavailableOnSave', { field, deviceId: camera.deviceId }))
    }
  }
}

const pendingJournalCleanup = new Set<string>()
const cleanupCommittedJournal = async (dir: string, id: string): Promise<void> => {
  try {
    await removeJournal(dir, id)
    pendingJournalCleanup.delete(id)
  } catch (error) {
    pendingJournalCleanup.add(id)
    console.warn(`[devices] 配置已提交，事务记录待清理（${id}）：${messageOf(error)}`)
  }
}

/**
 * config × 元数据跨文件事务（plan 设计 3.3/3.4）：在全局元数据队列内执行——
 * 重新 CAS 元数据、复验原 config 字节、持久记录 old/new、原子写 config、
 * store 唯一入口写元数据、成功后清理记录。元数据写失败恢复原 config；回滚失败
 * 保留记录并冻结目标。任务体内直接操作不嵌套调用同一队列（不自等待）。
 */
const commitMetasWithConfig = (
  id: string,
  oldMeta: DeviceMeta,
  newMeta: DeviceMeta,
  oldConfig: string,
  newConfig: string
): Promise<void> =>
  enqueueStoreTask(async () => {
    const guard = await readDeviceStore()
    if (
      guard.health.state !== 'error' &&
      acceptedMetas !== null &&
      !metasEqual(guard.metas, acceptedMetas)
    ) {
      armStoreProtection(msg('storeExternalModifiedAtWrite'))
      storeHealth = {
        state: 'read-only',
        issues: [
          ...guard.health.issues,
          {
            code: 'metadata-changed',
            message: msg('storeWriteAbortedV1')
          }
        ]
      }
      throw new Error(msg('storeExternalModifiedAborted'))
    }
    // 写 config 前复验原字节：外部工具改过 config 即中止，不覆盖
    const currentConfig = await readAvdConfigRaw(id, avdDirs())
    if (currentConfig !== oldConfig) {
      throw new Error(msg('blockConfigExternallyModified'))
    }
    const dir = transactionsDir(app.getPath('userData'))
    if (pendingJournalCleanup.has(id)) {
      await removeJournal(dir, id)
      pendingJournalCleanup.delete(id)
    }
    await writeJournal(dir, {
      version: 1,
      deviceId: id,
      createdAt: Date.now(),
      oldConfig,
      newConfig,
      oldMeta,
      newMeta
    })
    try {
      await writeAvdConfigRaw(id, avdDirs(), newConfig, oldConfig)
    } catch (error) {
      // config 未落成（tmp 写失败或 rename 失败）：清记录；元数据未动，无残留
      await removeJournal(dir, id).catch(() => undefined)
      throw new Error(msg('writeAvdConfigFailed', { message: messageOf(error) }))
    }
    let metaFailure: unknown = null
    try {
      if (acceptedMetas === null) {
        throw new Error(msg('noTrustedBaseline'))
      }
      // 复查 P2-1：草稿基线是已提交元数据，其他事务的创建临时行不进写盘内容
      const draft = acceptedMetas.map((entry) => (entry.id === id ? newMeta : entry))
      await writeDeviceMetas(draft)
      devices = rebuildWithPendingRows(draft)
      acceptedMetas = draft
      metaRevision += 1
    } catch (error) {
      metaFailure = error
    }
    if (metaFailure !== null) {
      // 元数据未提交：恢复原 config，使两文件回到事务前的一致状态
      try {
        await writeAvdConfigRaw(id, avdDirs(), oldConfig, newConfig)
        await removeJournal(dir, id)
      } catch (rollbackError) {
        const journalPath = join(dir, `${id}.json`)
        const message = `上次保存未完成且回滚失败（${messageOf(rollbackError)}），本设备的配置写入已冻结；事务记录保留在 ${journalPath}`
        frozenMessages.set(id, message)
        const target = devices.find((entry) => entry.id === id)
        if (target) target.lastError = { code: 'config-transaction', message }
        throw new Error(message)
      }
      throw metaFailure
    }
    await cleanupCommittedJournal(dir, id)
  })

const updateConfigFlow = async (input: UpdateDeviceInput): Promise<DeviceSnapshot> => {
  const device = requireDevice(input.id)
  const blocked = editSaveBlockedReason(device)
  if (blocked !== null) throw new Error(blocked)
  const nextName = input.name !== undefined ? normalizeName(input.name) : null
  if (input.name !== undefined && nextName === null) {
    throw new Error(msg('deviceNameLength'))
  }
  // 差异闭集守卫：存储/ABI/未知键在此拒绝（伪造载荷不进入业务）
  const diff = sanitizeUpdateSettings(input.advancedSettings ?? {}, getLocaleState())
  const configRaw = await readAvdConfigRaw(input.id, avdDirs())
  const meta = toMeta(device)
  if (configFingerprintOf(configRaw, meta) !== input.fingerprint) {
    throw new Error(msg('editFingerprintStale'))
  }
  const nameChanged = nextName !== null && nextName !== meta.name
  const pendingSync = configMismatchesOf(
    meta.advancedSettings,
    parseConfigEntries(configRaw ?? ''),
    { skinIds: [], skinDirectoryFor }
  )
  if (Object.keys(diff).length === 0 && pendingSync.length === 0) {
    if (nameChanged || input.resetDisplayCutout === true) {
      await commitMetas((metas) =>
        metas.map((entry) =>
          entry.id === input.id
            ? {
                ...entry,
                ...(nameChanged ? { name: nextName! } : {}),
                ...(input.resetDisplayCutout === true
                  ? { cutoutResetPending: true, snapshotReadyAt: null }
                  : {})
              }
            : entry
        )
      )
      broadcastChanged()
    }
    return snapshotNow()
  }
  const health = await withDeadline(
    checkDeviceHealth(meta, reconcileDirs()),
    checkTimeoutAvailability,
    CHECK_TIMEOUT_MS
  )
  if (health.state !== 'valid')
    throw new Error(
      msg('saveVerifyFailed', { message: health.issues[0]?.message ?? msg('fileStateAbnormal') })
    )
  // 目标设置 = 可信原草稿 + 差异（与读取快照同一构建器，两处口径恒一致）
  const schemaDefaults = await readHardwareSchemaDefaults(sdkRoot()).catch(
    () => ({}) as Record<string, string>
  )
  const capabilities = await buildEditCapabilities(meta)
  const draft = buildEditDraft(
    meta,
    configRaw === null ? new Map() : parseConfigEntries(configRaw),
    schemaDefaults,
    capabilities
  )
  const original = draft.settings
  if (original !== null) augmentDraftWebcams(capabilities, original)
  if (original === null) throw new Error(msg('settingsBlockedUnrecognized'))
  const mismatches = draft.mismatches ?? []
  const syncFields = mismatches.map((item) => item.field)
  const syncDiff = Object.fromEntries(syncFields.map((field) => [field, original[field]]))
  const normalized = normalizeEditedSettings(
    original,
    { ...syncDiff, ...diff },
    capabilities,
    syncFields,
    getLocaleState()
  )
  if (Object.keys(normalized.errors).length > 0) {
    const first = Object.entries(normalized.errors)[0] as [string, string]
    throw new Error(msg('advancedSettingsInvalid', { field: first[0], message: first[1] }))
  }
  const nextSettings = normalized.settings as DeviceAdvancedSettings
  const settingsChanged = !deepEqual(original, nextSettings)
  const patch = buildConfigEditPatch(configBaseline(original, mismatches), nextSettings, {
    skinDirectoryFor,
    forceFields: mismatches.filter((item) => item.actualSettings === null).map((item) => item.field)
  })
  const configChanged = Object.keys(patch.sets).length > 0 || patch.deletes.length > 0
  if (!settingsChanged && !configChanged && !nameChanged && input.resetDisplayCutout !== true)
    return snapshotNow()
  if ((settingsChanged || configChanged) && configRaw === null) {
    throw new Error(msg('blockSettingsNoConfig'))
  }
  if (!settingsChanged && !configChanged) {
    // 只改名：走既有元数据提交，不动 config 与快照标记（独立重命名同语义）
    await commitMetas((metas) =>
      metas.map((entry) =>
        entry.id === input.id
          ? {
              ...entry,
              ...(nameChanged ? { name: nextName! } : {}),
              ...(input.resetDisplayCutout === true
                ? { cutoutResetPending: true, snapshotReadyAt: null }
                : {})
            }
          : entry
      )
    )
    broadcastChanged()
    return snapshotNow()
  }
  await verifyEditableCameras(original, nextSettings, syncFields)
  // 硬件/启动配置变化使快照失效（下次冷启动）；纯名称变化不动快照。
  // 网络字段是启动参数、不改 config，也不使快照失效。
  const snapshotAffecting = configChanged || original.bootMode !== nextSettings.bootMode
  const newMeta: DeviceMeta = {
    ...meta,
    name: nextName ?? meta.name,
    advancedSettings: nextSettings,
    snapshotReadyAt: snapshotAffecting ? null : meta.snapshotReadyAt,
    ...(input.resetDisplayCutout === true
      ? { cutoutResetPending: true, snapshotReadyAt: null }
      : {})
  }
  const newConfigRaw = applyConfigPatchToText(configRaw as string, patch)
  // 事务开始/结束都动文件代次：进行中的扫描结果不覆盖事务后的状态
  bumpAvdEpoch()
  try {
    await commitMetasWithConfig(input.id, meta, newMeta, configRaw as string, newConfigRaw)
  } finally {
    bumpAvdEpoch()
  }
  broadcastChanged()
  return snapshotNow()
}

/** 保存命令：同设备互斥（重复请求合并到在途执行），退出清理期拒绝新保存 */
const updateDeviceConfig = (input: UpdateDeviceInput): Promise<DeviceSnapshot> => {
  const flight = editFlights.get(input.id)
  if (flight) return flight
  const promise = (async (): Promise<DeviceSnapshot> => {
    if (!acceptingCommands) throw new Error(msg('appClosingNoSave'))
    await ensureLoaded()
    try {
      return await updateConfigFlow(input)
    } finally {
      editFlights.delete(input.id)
    }
  })()
  editFlights.set(input.id, promise)
  return promise
}

// ---- sender 白名单：启停/删除/复制/对账仅登记主窗；创建允许主窗与 create 向导；
// 配置读写仅绑定目标设备的编辑窗（主窗不直接写附加配置）----

type IpcEvent = Electron.IpcMainInvokeEvent

const requireSender = (
  channel: string,
  event: IpcEvent,
  scope: 'main' | 'create' | { edit: string }
): void => {
  const isMain = getMainWindow()?.webContents.id === event.sender.id
  if (scope === 'main') {
    if (!isMain) throw new Error(`${channel}: ${msg('unregisteredWindowSuffix')}`)
    return
  }
  if (scope === 'create') {
    // create 上下文窗口（或主窗）；编辑窗不能发起创建——create/edit 隔离
    if (isMain || wizardContextOf(event.sender)?.kind === 'create') return
    throw new Error(`${channel}: ${msg('unregisteredWindowSuffix')}`)
  }
  const context = wizardContextOf(event.sender)
  if (context?.kind === 'edit' && context.deviceId === scope.edit) return
  throw new Error(`${channel}: ${msg('configWindowNotAllowedSuffix')}`)
}

/** 确认已展示某签名的异常汇总（对账设计 5）：只消费当前签名的待提示态 */
const acknowledgeReconciliation = (signature: string): void => {
  if (lastReport === null || lastReport.signature === null) return
  if (lastReport.signature !== signature) return // 迟到确认不消费新异常
  acknowledgedSignature = signature
  if (lastReport.pendingNotification) {
    lastReport = { ...lastReport, pendingNotification: false }
    broadcastChanged()
  }
}

/** 退出清理：停掉本工具全部实例（有界）；返回未停干净的设备 id */
export async function prepareAppShutdown(): Promise<{ leftovers: string[] }> {
  acceptingCommands = false
  const leftovers = await runner.disposeAll()
  // 等待在途配置事务到达可恢复边界（journal 已清理或保留待恢复）——排队空任务
  // 即等队列尾，不在退出途中截断跨文件事务
  await enqueueStoreTask(async () => undefined).catch(() => undefined)
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
        device.cameraNotice = undefined
        streamBridge.stopped?.(device.id)
      }
    }
  }
  cameraOverridesByDevice.clear()
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
        throw new Error(`${IPC_CHANNELS.devicesCreate}${msg('invalidPayload')}`)
      }
      return createDevice(raw)
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.devicesRename,
    async (event, raw: unknown): Promise<DeviceSnapshot> => {
      requireSender(IPC_CHANNELS.devicesRename, event, 'main')
      if (!isRenameInput(raw)) {
        throw new Error(`${IPC_CHANNELS.devicesRename}${msg('invalidPayload')}`)
      }
      const name = normalizeName(raw.name)
      if (!name) throw new Error(`${IPC_CHANNELS.devicesRename}${msg('invalidName')}`)
      return renameDevice(raw.id, name)
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.devicesDelete,
    async (event, raw: unknown): Promise<DeviceSnapshot> => {
      requireSender(IPC_CHANNELS.devicesDelete, event, 'main')
      if (!isDeviceIdInput(raw)) {
        throw new Error(`${IPC_CHANNELS.devicesDelete}${msg('invalidPayload')}`)
      }
      return deleteDevice(raw.id)
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.devicesStart,
    async (event, raw: unknown): Promise<DeviceSnapshot> => {
      requireSender(IPC_CHANNELS.devicesStart, event, 'main')
      if (!isDeviceIdInput(raw)) {
        throw new Error(`${IPC_CHANNELS.devicesStart}${msg('invalidPayload')}`)
      }
      return startDevice(raw.id)
    }
  )

  ipcMain.handle(IPC_CHANNELS.devicesStop, async (event, raw: unknown): Promise<DeviceSnapshot> => {
    requireSender(IPC_CHANNELS.devicesStop, event, 'main')
    if (!isDeviceIdInput(raw)) {
      throw new Error(`${IPC_CHANNELS.devicesStop}${msg('invalidPayload')}`)
    }
    return stopDevice(raw.id)
  })

  ipcMain.handle(
    IPC_CHANNELS.devicesCancelStart,
    async (event, raw: unknown): Promise<DeviceSnapshot> => {
      requireSender(IPC_CHANNELS.devicesCancelStart, event, 'main')
      if (!isDeviceIdInput(raw)) {
        throw new Error(`${IPC_CHANNELS.devicesCancelStart}${msg('invalidPayload')}`)
      }
      return cancelStartDevice(raw.id)
    }
  )

  // ---- 配置编辑域（plan 2026-10-08-device-config-edit）----

  ipcMain.handle(
    IPC_CHANNELS.devicesReadConfig,
    async (event, raw: unknown): Promise<DeviceEditSnapshot> => {
      if (!isDeviceIdInput(raw)) {
        throw new Error(`${IPC_CHANNELS.devicesReadConfig}${msg('invalidPayload')}`)
      }
      requireSender(IPC_CHANNELS.devicesReadConfig, event, { edit: raw.id })
      return readDeviceConfig(raw.id)
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.devicesUpdateConfig,
    async (event, raw: unknown): Promise<DeviceSnapshot> => {
      if (!isUpdateDeviceInput(raw)) {
        throw new Error(`${IPC_CHANNELS.devicesUpdateConfig}${msg('invalidPayload')}`)
      }
      requireSender(IPC_CHANNELS.devicesUpdateConfig, event, { edit: raw.id })
      return updateDeviceConfig(raw)
    }
  )

  ipcMain.handle(IPC_CHANNELS.devicesCopySerial, async (event, raw: unknown): Promise<void> => {
    requireSender(IPC_CHANNELS.devicesCopySerial, event, 'main')
    if (!isDeviceIdInput(raw)) {
      throw new Error(`${IPC_CHANNELS.devicesCopySerial}${msg('invalidPayload')}`)
    }
    const device = requireDevice(raw.id)
    if (device.status !== 'running' || !device.serial) {
      throw new Error(msg('copySerialNotRunning'))
    }
    clipboard.writeText(device.serial)
  })

  ipcMain.handle(IPC_CHANNELS.devicesReconcile, async (event): Promise<ReconcileResult> => {
    requireSender(IPC_CHANNELS.devicesReconcile, event, 'main')
    return reconcileDevices()
  })

  ipcMain.handle(
    IPC_CHANNELS.devicesReconciliationReport,
    async (event): Promise<ReconcileReport | null> => {
      requireSender(IPC_CHANNELS.devicesReconciliationReport, event, 'main')
      // 只回最近报告：不 ensureLoaded、不触发隐式扫描（plan 设计 5）
      return lastReport
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.devicesReconciliationAck,
    async (event, raw: unknown): Promise<void> => {
      requireSender(IPC_CHANNELS.devicesReconciliationAck, event, 'main')
      if (
        typeof raw !== 'object' ||
        raw === null ||
        typeof (raw as { signature?: unknown }).signature !== 'string'
      ) {
        throw new Error(`${IPC_CHANNELS.devicesReconciliationAck}${msg('invalidPayload')}`)
      }
      acknowledgeReconciliation((raw as { signature: string }).signature)
    }
  )
}
