import { BrowserWindow, app, clipboard, ipcMain } from 'electron'
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import type {
  CreateDeviceInput,
  CreateDeviceResult,
  Device,
  DeviceAvailability,
  DeviceFrameKind,
  DeviceMeta,
  DeviceSnapshot,
  ReconcileReport,
  ReconcileResult,
  ReconciliationSummary,
  RuntimeErrorMessage,
  StoreHealth
} from '@shared/types'
import { armStoreProtection, readDeviceStore, writeDeviceMetas } from '../store'
import { createAvd, deleteAvd, patchAvdConfig } from '../emulator/avd'
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
import { wizardOwns } from '../window/wizard'
import { importedSkinsRoot } from '../emulator/skins'
import { listWebcams } from '../emulator/cameras'
import { activePackageOp, beginPackageCreation, endPackageCreation } from '../emulator/packageOps'

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

export const listDeviceNamesReferencing = (packageName: string): string[] =>
  devices.filter((device) => device.imagePackageName === packageName).map((device) => device.name)

const checkingAvailability = (): DeviceAvailability => ({
  state: 'checking',
  issues: [],
  checkedAt: null
})

/** 创建/删除/回滚中的 id：扫描时暂缓判孤立 */
const transientIdsNow = (): Set<string> =>
  new Set(
    devices
      .filter((device) => device.status === 'creating' || device.status === 'deleting')
      .map((device) => device.id)
  )

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
  const read = await readDeviceStore()
  await ensureFrameIndex()
  storeHealth = read.health
  suspectIds = read.suspectIds
  acceptedMetas = read.health.state === 'error' ? null : read.metas
  devices = rebuildDevices(read.metas)
  applyScan(await scanCurrent())
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
      scanError: `检查服务异常：${messageOf(error)}`
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
        scanError: '扫描期间元数据或文件代次持续变化，本轮未完成；请稍后再次重新检查'
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
      armStoreProtection(
        'devices.json 已被外部修改，与应用内存不一致：元数据写入已冻结；请核对文件后重启应用载入'
      )
    }
    storeHealth = {
      state: 'read-only',
      issues: [
        ...read.health.issues,
        {
          code: 'metadata-changed',
          message:
            'devices.json 与应用最后接纳的内容不一致（外部修改）；已保留当前列表并冻结写入，重启后载入修复文件'
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
 * 元数据提交全局串行；写盘成功才改内存（issue 2026-10-03 落盘分叉的修法）。
 * 写前 CAS（review P3）：现有文件与最后接纳不一致（运行中被外部修改）→ 中止并冻结，
 * 不静默覆盖；draft 是唯一写盘内容，内存按 draft 重建并保留完整运行字段。
 */
const commitMetas = (mutate: (metas: DeviceMeta[]) => DeviceMeta[]): Promise<void> =>
  enqueueStoreTask(async () => {
    const guard = await readDeviceStore()
    if (
      guard.health.state !== 'error' &&
      acceptedMetas !== null &&
      !metasEqual(guard.metas, acceptedMetas)
    ) {
      armStoreProtection(
        'devices.json 在写入前被外部修改，与应用内存不一致：写入已中止并冻结；请核对文件后重启应用载入'
      )
      storeHealth = {
        state: 'read-only',
        issues: [
          ...guard.health.issues,
          {
            code: 'metadata-changed',
            message: '写入前检测到 devices.json 外部修改，本次写入已中止；重启后载入修复文件'
          }
        ]
      }
      throw new Error('devices.json 已被外部修改，写入已中止（元数据冻结，重启后载入）')
    }
    const draft = mutate(devices.map(toMeta))
    await writeDeviceMetas(draft)
    devices = rebuildDevices(draft)
    acceptedMetas = devices.map(toMeta)
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

const requireDevice = (id: string): Device => {
  const device = devices.find((entry) => entry.id === id)
  if (!device) throw new Error(`设备不存在（${id}）`)
  return device
}

/** 元数据写命令的副作用前守卫（对账设计 3）：error/read-only 都拒绝并说明原因 */
const assertMetaWritable = (action: string): void => {
  if (storeHealth.state === 'error') {
    throw new Error(
      `设备数据读取失败（${storeHealth.issues[0]?.message ?? '未知错误'}），不能${action}；请先修复 devices.json 后重新检查`
    )
  }
  if (storeHealth.state === 'read-only') {
    throw new Error(
      `元数据写入已冻结（${storeHealth.issues.map((issue) => issue.message).join('；')}），不能${action}`
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

/** 真实摄像头启动重核验（plan 设计 7）：配置的 webcam 拔出/消失时拒绝启动 */
const verifyWebcamsFor = async (device: Device): Promise<void> => {
  const webcams =
    device.advancedSettings?.frontCamera.mode === 'webcam' ||
    device.advancedSettings?.rearCamera.mode === 'webcam'
  if (!webcams || device.advancedSettings === null) return
  try {
    const available = new Map(
      (await listWebcams(sdkRoot())).map((entry) => [entry.id, entry.deviceLabel])
    )
    const missing: string[] = []
    for (const camera of [
      device.advancedSettings.frontCamera,
      device.advancedSettings.rearCamera
    ]) {
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
        `宿主摄像头（${missing.join('、')}）已不可用，请重新选择摄像头后启动`
      )
    }
  } catch (error) {
    if (error instanceof StartBlockedError) throw error
    // 底层错误自带建议从句（如「请检查 emulator 版本」）时不再叠加第二条建议
    const cause = messageOf(error)
    throw new StartBlockedError(
      'webcam-missing',
      cause.includes('请')
        ? `启动前无法核验摄像头：${cause}`
        : `启动前无法核验摄像头：${cause}，请检查权限或改用模拟画面`
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
      message: `启动前核验超时（${CHECK_TIMEOUT_MS / 1000} 秒），为安全起见未启动`,
      severity: 'error'
    }
  ],
  checkedAt: Date.now()
})

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
    const device = devices.find((entry) => entry.id === id)
    if (device === undefined) throw new Error(`设备不存在（${id}）`)
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
        `启动前核验未通过：${blocking?.message ?? '设备文件状态异常'}`,
        availability
      )
    }
    await awaitWithAbort(() => verifyWebcamsFor(device), signal)
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
  // 检查前同步保留 runId 并进入 starting（对账设计 4）：文件/摄像头核验移入
  // runner 准备——可取消、迟到结果不 spawn；未知检查结果不允许启动
  device.status = 'starting'
  device.lastError = undefined
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
    target.startedAt = undefined
    broadcastChanged()
    streamBridge.stopped?.(target.id)
  }
  return snapshotNow()
}

const deleteFlow = async (id: string): Promise<DeviceSnapshot> => {
  await ensureLoaded()
  const device = requireDevice(id)
  if (device.status === 'creating') throw new Error('设备创建中，不能删除')
  // 副作用前守卫（对账设计 4）：库不可写时拒绝——删了 AVD 却删不掉元数据会留幽灵记录
  assertMetaWritable('删除设备')
  if (device.status === 'starting') await cancelStartDevice(id)
  else if (device.status === 'running' || device.status === 'stopping') await stopDevice(id)
  if (requireDevice(id).status !== 'stopped') throw new Error('停止未完成，未删除')
  // 停止后、FS 删除前再检查保护（停止耗时期间外部可能改坏库）
  assertMetaWritable('删除设备')
  bumpAvdEpoch()
  requireDevice(id).status = 'deleting'
  broadcastChanged()
  try {
    // 删除的文件操作与 JSON 写入无法原子提交：分别报错，失败保留异常记录。
    // deleteAvd 只删 id 推导的两条路径（containment 守卫），不跟随 ini 外指
    await deleteAvd(id, avdDirs())
    await commitMetas((metas) => metas.filter((meta) => meta.id !== id))
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
  assertMetaWritable('创建设备')
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
    capabilities
  )
  if (Object.keys(normalized.errors).length > 0) {
    const first = Object.entries(normalized.errors)[0] as [string, string]
    throw new Error(`附加设置不合法（${first[0]}）：${first[1]}`)
  }
  const advancedSettings = normalized.settings
  // 查询结束后、AVD 副作用前再次检查写保护（对账设计 4——查询窗口内库可能变坏）
  assertMetaWritable('创建设备')
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
            message: `创建后核验失败（${messageOf(error)}）`,
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
  assertMetaWritable('重命名设备')
  await commitMetas((metas) => metas.map((meta) => (meta.id === id ? { ...meta, name } : meta)))
  broadcastChanged()
  return snapshotNow()
}

// ---- sender 白名单：启停/删除/复制/对账仅登记主窗；创建允许主窗与向导 ----

type IpcEvent = Electron.IpcMainInvokeEvent

const requireSender = (channel: string, event: IpcEvent, scope: 'main' | 'create'): void => {
  const allowed =
    scope === 'main'
      ? getMainWindow()?.webContents.id === event.sender.id
      : getMainWindow()?.webContents.id === event.sender.id || wizardOwns(event.sender)
  if (!allowed) throw new Error(`${channel}: 未登记的窗口`)
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
        throw new Error(`${IPC_CHANNELS.devicesReconciliationAck}: 非法的入参`)
      }
      acknowledgeReconciliation((raw as { signature: string }).signature)
    }
  )
}
