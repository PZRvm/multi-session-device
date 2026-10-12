import { app, clipboard, ipcMain } from 'electron'
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import type {
  CreateDeviceInput,
  CreateDeviceResult,
  Device,
  DeviceAdvancedSettings,
  DeviceEditFieldNote,
  DeviceConfigField,
  DeviceConfigMismatch,
  DeviceEditSnapshot,
  DeviceEditStorageInfo,
  DeviceMeta,
  DeviceRuntimeView,
  DeviceSnapshot,
  ReconcileReport,
  ReconcileResult,
  UpdateDeviceInput
} from '@shared/types'
import { normalizeEditedSettings, sanitizeUpdateSettings } from '@shared/settings-contract'
import { getLocaleState } from '../locale/store'
import { msg } from '../locale'
import { createAvd, deleteAvd, patchAvdConfig } from '../emulator/avd'
import {
  applyConfigPatchToText,
  buildConfigEditPatch,
  configFingerprintOf,
  parseConfigEntries,
  readAvdConfigRaw,
  readHardwareSchemaDefaults,
  storageMiBFromText
} from '../emulator/deviceConfig'
import { removeJournal, transactionsDir } from '../emulator/configTransaction'
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
  settingsToConfigPatch
} from '../emulator/settings'
import { avdmanagerPathFor, listDeviceProfiles } from '../emulator/profiles'
import { sdklibJarPathFor } from '../emulator/profileMetadata'
import { CHECK_TIMEOUT_MS, checkDeviceHealth } from '../emulator/reconcile'
import { isSharedReadOnly } from '../emulator/sdkSource'
import { originOfMeta } from '@shared/deviceOrigin'
import { StartCancelledError } from '../emulator/runner'
import { getMainWindow } from '../window'
import { getReportWindow } from '../window/report'
import { wizardContextOf } from '../window/wizard'
import { listWebcams } from '../emulator/cameras'
import { activePackageOp, beginPackageCreation, endPackageCreation } from '../emulator/packageOps'
import { configBaseline, configMismatchesOf } from '../emulator/configDrift'
import { javaHomeFor } from '../emulator/sdkSource'
import { androidUserHomeFor } from '../emulator/androidUserHome'
import {
  avdDirs,
  avdHome,
  ensureFrameIndex,
  frameKindOf,
  isCreateDeviceInput,
  isDeviceIdInput,
  isRenameInput,
  messageOf,
  normalizeName,
  parseLegacyCamera,
  reconcileDirs,
  sdkRoot,
  skinDirectoryFor
} from './environment'

export { adbBinaryPath, androidToolEnv } from './environment'
export { attachDeviceStreamBridge } from './state'
import {
  acceptingCommandsNow,
  broadcastChanged,
  bumpAvdEpoch,
  checkingAvailability,
  devicesNow,
  editFlights,
  frozenMessages,
  lastReportNow,
  requireDevice,
  setAcceptingCommands,
  setDevices,
  snapshotNow,
  storeHealthNow,
  streamBridge,
  toMeta
} from './state'
import {
  assertDeviceInCurrentBucket,
  assertMetaWritable,
  commitMetas,
  commitMetasWithConfig,
  deepEqual,
  enqueueStoreTask
} from './persistence'

export { triggerSourceChangeReconcile } from './scan'
import {
  acknowledgeReconciliation,
  ensureLoaded,
  reconcileDevices,
  refreshReportFromDevices,
  syncReportRevision
} from './scan'
import {
  assertSdkDomainOpen,
  cameraOverridesByDevice,
  checkTimeoutAvailability,
  displayArgsByDevice,
  runner,
  StartBlockedError,
  withDeadline
} from './startup'

export { runningDeviceCount } from './startup'

// ---- 主进程是设备列表与运行状态的唯一事实源（architecture 边界不变量）----
// status/lastError/serial/runId 只活在 state.ts 的内存里，重启一律「停止」，不入盘。
// availability/storeHealth 同为内存派生（对账产物），随快照发布、不进 toMeta。

const deleteFlights = new Map<string, Promise<DeviceSnapshot>>()

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

// ---- 生命周期流程 ----

const startDevice = async (id: string): Promise<DeviceSnapshot> => {
  if (!acceptingCommandsNow()) throw new Error(msg('appClosingNoStart'))
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
    const target = devicesNow().find((entry) => entry.id === id)
    if (target?.runId === attemptId && target.status === 'starting') {
      target.runId = runId
      target.serial = serial
      broadcastChanged()
    }
  } catch (error) {
    if (error instanceof StartCancelledError) return snapshotNow()
    const target = devicesNow().find((entry) => entry.id === id)
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

const deleteFlow = async (
  id: string,
  opts: { bypassOriginBucket?: boolean } = {}
): Promise<DeviceSnapshot> => {
  await ensureLoaded()
  const device = requireDevice(id)
  if (device.status === 'creating') throw new Error(msg('deleteWhileCreating'))
  if (editFlights.has(id)) throw new Error(msg('blockDeleteWhileSaving'))
  if (!opts.bypassOriginBucket) assertDeviceInCurrentBucket(device)
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
    const target = devicesNow().find((entry) => entry.id === id)
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

const deleteDevice = (
  id: string,
  opts: { bypassOriginBucket?: boolean } = {}
): Promise<DeviceSnapshot> => {
  // 停止/删除中的重复请求合并到同一次执行
  const flight = deleteFlights.get(id)
  if (flight) return flight
  const promise = deleteFlow(id, opts).finally(() => deleteFlights.delete(id))
  deleteFlights.set(id, promise)
  return promise
}

/**
 * 清除保留根的设备级联（用户 2026-10-12 批复）：共享态下清除保留 SDK 时，
 * 项目自有出身的设备镜像随之永久消失——设备一并删除（AVD 目录 + 元数据），
 * 不留永久不可启动的死行。逐台走删除流（含运行中先停），失败逐台收集不中断
 * 其余（SDK 已删，残留行可切回自有根后手删）。跨桶只读守卫在此放行——
 * 清除本身就是对另一桶的系统性清理。
 */
export const purgeAppOwnedDevices = async (): Promise<{
  deleted: Array<{ id: string; name: string }>
  failures: Array<{ name: string; message: string }>
}> => {
  await ensureLoaded()
  const targets = devicesNow()
    .filter((device) => originOfMeta(device) === 'app-owned')
    .map((device) => ({ id: device.id, name: device.name }))
  const deleted: Array<{ id: string; name: string }> = []
  const failures: Array<{ name: string; message: string }> = []
  for (const target of targets) {
    try {
      await deleteDevice(target.id, { bypassOriginBucket: true })
      deleted.push(target)
    } catch (error) {
      failures.push({ name: target.name, message: messageOf(error) })
    }
  }
  return { deleted, failures }
}

/** 设置窗清除确认框的计数来源：项目自有出身设备总数（当前视图的另一桶全体） */
export const appOwnedDeviceCount = async (): Promise<number> => {
  await ensureLoaded()
  return devicesNow().filter((device) => originOfMeta(device) === 'app-owned').length
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
    javaHome: javaHomeFor(sdkRoot()),
    userHome: androidUserHomeFor(),
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
    // 出身标注（plan 2026-10-12-device-list-source-aware）：创建时的来源桶；
    // 共享态建出的设备引用 Studio 根内的镜像，切回自有根后指路文案靠它区分
    imageSourceOrigin: isSharedReadOnly() ? 'shared-studio' : 'app-owned',
    createdAt: Date.now(),
    frameKind: frameKindOf(raw.profileId),
    availability: checkingAvailability(),
    status: 'creating'
  }
  bumpAvdEpoch()
  setDevices([...devicesNow(), device])
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
    setDevices(devicesNow().filter((entry) => entry.id !== device.id))
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
  assertDeviceInCurrentBucket(device)
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
  const health = storeHealthNow()
  if (health.state === 'error') {
    return msg('blockSaveStoreError', {
      issues: health.issues[0]?.message ?? msg('unknownError')
    })
  }
  if (health.state === 'read-only') {
    return msg('blockSaveStoreFrozen', {
      issues: health.issues.map((issue) => issue.message).join('；')
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
      javaHome: javaHomeFor(sdkRoot()),
      userHome: androidUserHomeFor(),
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
  const others = devicesNow().filter(
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
    if (!acceptingCommandsNow()) throw new Error(msg('appClosingNoSave'))
    await ensureLoaded()
    assertDeviceInCurrentBucket(requireDevice(input.id))
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

/** 退出清理：停掉本工具全部实例（有界）；返回未停干净的设备 id */
export async function prepareAppShutdown(): Promise<{ leftovers: string[] }> {
  setAcceptingCommands(false)
  const leftovers = await runner.disposeAll()
  // 等待在途配置事务到达可恢复边界（journal 已清理或保留待恢复）——排队空任务
  // 即等队列尾，不在退出途中截断跨文件事务
  await enqueueStoreTask(async () => undefined).catch(() => undefined)
  for (const device of devicesNow()) {
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
  setAcceptingCommands(true)
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
      assertSdkDomainOpen()
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
      assertSdkDomainOpen()
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
      // 对账详情窗（子窗口方案）也允许拉完整报告——sender 由 report 窗口域单例管理
      const isReport = getReportWindow()?.webContents.id === event.sender.id
      if (!isReport) {
        requireSender(IPC_CHANNELS.devicesReconciliationReport, event, 'main')
      }
      // 只回最近报告：不 ensureLoaded、不触发隐式扫描（plan 设计 5）
      return lastReportNow()
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
