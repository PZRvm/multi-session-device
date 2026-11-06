import { adbRecovery } from '../emulator/adbRecovery'
import { app } from 'electron'
import { readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Device, DeviceSnapshot } from '@shared/types'
import { CHECK_TIMEOUT_MS, checkDeviceHealth } from '../emulator/reconcile'
import { deleteAvd } from '../emulator/avd'
import { removeJournal, transactionsDir } from '../emulator/configTransaction'
import { StartCancelledError } from '../emulator/runner'
import { emuConsoleExec } from '../emulator/emuConsole'
import {
  cleanupOldHibernationSnapshots,
  hardwareFingerprintOf,
  hibernationSnapshotDir,
  hibernationSnapshotExists,
  newHibernationSnapshotName,
  readHibernationManifest,
  removeHibernationManifest,
  waitHibernationSnapshotStable,
  writeHibernationManifest,
  type HibernationManifest
} from '../emulator/hibernation'
import { parseConfigEntries, readAvdConfigRaw } from '../emulator/deviceConfig'
import { readEmulatorVersion } from '../emulator/settings'
import { tcpProbe } from '../emulator/ports'
import { originOfMeta } from '@shared/deviceOrigin'
import { msg } from '../locale'
import { avdDirs, avdHome, messageOf, reconcileDirs, sdkRoot } from './environment'
import {
  assertDeviceInCurrentBucket,
  assertMetaWritable,
  commitMetas,
  enqueueStoreTask
} from './persistence'
import {
  ensureLoaded,
  reconcileDevices,
  refreshReportFromDevices,
  syncReportRevision
} from './scan'
import {
  cameraOverridesByDevice,
  checkTimeoutAvailability,
  displayArgsByDevice,
  readGuestBootId,
  resumePlansByDevice,
  runner,
  StartBlockedError,
  withDeadline
} from './startup'
import {
  acceptingCommandsNow,
  broadcastChanged,
  bumpAvdEpoch,
  devicesNow,
  editFlights,
  frozenMessages,
  hibernationCapabilityOf,
  hibernationGate,
  requireDevice,
  setAcceptingCommands,
  snapshotNow,
  streamBridge,
  toMeta
} from './state'

// ---- 生命周期流程 ----

/** 停止/删除中的重复请求合并到同一次执行（deleteDevice 私有） */
const deleteFlights = new Map<string, Promise<DeviceSnapshot>>()

/** 休眠/恢复/放弃中的重复请求合并到同一次执行（私有） */
const hibernationFlights = new Map<string, Promise<DeviceSnapshot>>()

export const startDevice = async (id: string): Promise<DeviceSnapshot> => {
  if (!acceptingCommandsNow()) throw new Error(msg('appClosingNoStart'))
  await ensureLoaded()
  adbRecovery.assertOpen()
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

export const stopDevice = async (id: string): Promise<DeviceSnapshot> => {
  await ensureLoaded()
  adbRecovery.assertOpen()
  const device = requireDevice(id)
  if (device.status === 'hibernating' || device.status === 'resuming') {
    // 休眠事务进行中/退出失败可重试期：停止 = 显式放弃休眠（清单删除、快照留待清理）
    if (device.status === 'hibernating' && hibernationFlights.has(id)) {
      throw new Error(msg('hibernateBusy'))
    }
    if (device.status === 'resuming') {
      throw new Error(msg('stopWhileResuming'))
    }
    await removeHibernationManifest(id, avdDirs()).catch(() => undefined)
    if (runner.phaseOf(id) === null) {
      // 实例进程已不在（如端口异常提交前的窗口）：记账收口到 stopped
      device.status = 'stopped'
      device.serial = undefined
      device.runId = undefined
      device.startedAt = undefined
      device.cameraNotice = undefined
      broadcastChanged()
      streamBridge.stopped?.(id)
      return snapshotNow()
    }
  }
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

export const cancelStartDevice = async (id: string): Promise<DeviceSnapshot> => {
  await ensureLoaded()
  adbRecovery.assertOpen()
  const device = requireDevice(id)
  if (device.status === 'running') {
    throw new Error(msg('cancelWhileRunning'))
  }
  // 取消恢复（设计 C）：快照与清单必须保留，回 hibernated 可重试——不得 stopped
  if (device.status === 'resuming') {
    const runId = device.runId
    device.status = 'stopping'
    broadcastChanged()
    try {
      await runner.cancelStart(id)
    } catch (error) {
      const target = requireDevice(id)
      if (target.status === 'stopping') {
        if (runner.phaseOf(id) === 'running') {
          target.status = 'running'
          target.serial = runner.serialOf(id)
        } else {
          target.status = 'hibernated'
          target.lastError = {
            code: 'resume-failed',
            message: msg('hibernateResumeFailed', { detail: messageOf(error) })
          }
        }
        broadcastChanged()
      }
      throw error
    }
    const target = requireDevice(id)
    if (target.status === 'stopping') {
      resumePlansByDevice.delete(id)
      target.status = 'hibernated'
      target.serial = undefined
      target.runId = undefined
      target.startedAt = undefined
      target.cameraNotice = undefined
      broadcastChanged()
      streamBridge.stopped?.(target.id)
      void runId
    }
    return snapshotNow()
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
  opts: { bypassOriginBucket?: boolean; internal?: boolean } = {}
): Promise<DeviceSnapshot> => {
  await ensureLoaded()
  adbRecovery.assertOpen()
  const device = requireDevice(id)
  if (device.status === 'creating') throw new Error(msg('deleteWhileCreating'))
  if (editFlights.has(id)) throw new Error(msg('blockDeleteWhileSaving'))
  // 用户删除入口的 stopped-only 守卫（plan 设计 E）：内部级联（SDK 清理）走
  // internal 路径保留「先停后删」。此处在最后一个异步加载（ensureLoaded）之后、
  // 首个副作用之前同步核验——确认窗口内设备被启动也在此拒绝，零停止/删除副作用。
  if (!opts.internal && device.status !== 'stopped') {
    throw new Error(msg('deleteNotStopped'))
  }
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

export const deleteDevice = (
  id: string,
  opts: { bypassOriginBucket?: boolean; internal?: boolean } = {}
): Promise<DeviceSnapshot> => {
  // 停止/删除中的重复请求合并到同一次执行
  const flight = deleteFlights.get(id)
  if (flight) return flight
  const promise = deleteFlow(id, opts).finally(() => deleteFlights.delete(id))
  deleteFlights.set(id, promise)
  return promise
}

// ---- 休眠域（plan 2026-11-06-emulator-hibernation；ADR-007）----

/** console save 命令的受理期限（受理≠写完；写盘完成另由稳定性探测判定） */
const HIBERNATE_SAVE_ACCEPT_MS = 120_000
/** 快照首字节/稳定的预算（PoC：冷缓存双机下首字节可 >20s，全程数十秒） */
const SNAPSHOT_FIRST_BYTE_MS = 90_000
const SNAPSHOT_STABLE_MS = 180_000
const SNAPSHOT_POLL_MS = 1_000
/** 休眠忙态守卫：该设备安装/录屏（含暂停）进行中——用户先结束，不静默中断 */
const assertHibernationNotBusy = (id: string): void => {
  if (hibernationGate.installerBusyFor?.(id)) {
    throw new Error(msg('hibernateBlockedByInstall'))
  }
  if (hibernationGate.recordingActiveFor?.(id)) {
    throw new Error(msg('hibernateBlockedByRecording'))
  }
}

/** 镜像 source.properties 的 Pkg.Revision（指纹参与项；读不到 = null） */
const readImageRevision = async (imagePackageName: string): Promise<number | null> => {
  const segments = imagePackageName.split(';')
  if (
    segments.length !== 4 ||
    !segments.every((part) => /^[A-Za-z0-9_.-]+$/.test(part) && part !== '.' && part !== '..')
  ) {
    return null
  }
  try {
    const source = await readFile(join(sdkRoot(), ...segments, 'source.properties'), 'utf8')
    const revision = source.match(/^Pkg\.Revision\s*=\s*(\d+)\s*$/m)?.[1]
    return revision === undefined ? null : Number(revision)
  } catch {
    return null
  }
}

/** 休眠指纹：保存与恢复共用单源（config.ini 稳定键 + 镜像/版本/GPU） */
const currentFingerprint = async (
  device: Device
): Promise<{
  emulatorVersion: string | null
  imageRevision: number | null
  gpuBackend: string
  fingerprint: string
}> => {
  const [emulatorVersion, imageRevision, rawConfig] = await Promise.all([
    readEmulatorVersion(sdkRoot()),
    readImageRevision(device.imagePackageName),
    readAvdConfigRaw(device.id, avdDirs()).catch(() => null)
  ])
  const entries = parseConfigEntries(rawConfig ?? '')
  const gpuBackend =
    device.advancedSettings === null || device.advancedSettings === undefined
      ? 'host'
      : device.advancedSettings.graphics
  return {
    emulatorVersion,
    imageRevision,
    gpuBackend,
    fingerprint: hardwareFingerprintOf({
      imagePackageName: device.imagePackageName,
      imageRevision,
      emulatorVersion,
      gpuBackend,
      cpuCores: entries.get('hw.cpu.ncore') ?? null,
      ramMiB: entries.get('hw.ramSize') ?? null,
      vmHeapMiB: entries.get('vm.heapSize') ?? null,
      cameraFront: entries.get('hw.camera.front') ?? null,
      cameraBack: entries.get('hw.camera.back') ?? null,
      lcdWidth: entries.get('hw.lcd.width') ?? null,
      lcdHeight: entries.get('hw.lcd.height') ?? null,
      lcdDensity: entries.get('hw.lcd.density') ?? null
    })
  }
}

/** 端口释放复核（区分 TIME_WAIT：connect 探测只认真实监听） */
const portsReleased = async (port: number): Promise<boolean> =>
  !(await tcpProbe(port)) && !(await tcpProbe(port + 1))

const hibernateFlow = async (id: string): Promise<DeviceSnapshot> => {
  await ensureLoaded()
  adbRecovery.assertOpen()
  const device = requireDevice(id)
  // 退出失败的休眠允许重试（跳过保存直达退出段）；其余状态必须是 running
  const retryExit =
    device.status === 'hibernating' && device.lastError?.code === 'hibernate-exit-failed'
  if (!retryExit && device.status !== 'running') {
    throw new Error(msg('hibernateNotRunning'))
  }
  if (editFlights.has(id)) throw new Error(msg('blockStartWhileSaving'))
  const capability = hibernationCapabilityOf(device)
  if (!capability.available) {
    throw new Error(capability.disabledReason ?? msg('hibernationUnsupportedPlatform'))
  }
  assertHibernationNotBusy(id)
  const runId = device.runId
  if (runId === undefined) throw new Error(msg('hibernateNotRunning'))

  if (!retryExit) {
    device.status = 'hibernating'
    device.lastError = undefined
    broadcastChanged()
  }
  // 流程内显式阶段标记：catch 分支据此收口（runner.phaseOf 对 mock/竞态不可靠）
  let saved = retryExit
  let exited = false
  try {
    let savedManifest: HibernationManifest
    if (retryExit) {
      // 上次已保存成功：清单恢复到 saved 语义，直接重试退出
      const record = await readHibernationManifest(id, avdDirs())
      if (record.kind !== 'ok') throw new Error(msg('hibernateRetryRecordLost'))
      savedManifest = { ...record.manifest, stage: 'saved' }
    } else {
      // D2/D4：释放已按下输入 → 排空在途截图 → 拆除投屏/日志/剪贴板/网络轮询会话
      await hibernationGate.releaseInputs?.(id).catch(() => undefined)
      await hibernationGate.drainScreenshots?.(id).catch(() => undefined)
      await streamBridge.beforeKill?.(id, runId)
      const port = runner.portOf(id)
      if (port === undefined) throw new Error(msg('hibernateProcessLost'))
      const snapshotName = newHibernationSnapshotName()
      const guestBootId = await readGuestBootId(device.serial ?? '')
      const identity = await currentFingerprint(device)
      // 在途记录先行（崩溃可解释）；保存完成提交 saved；退出确认后提交 hibernated
      const manifest: HibernationManifest = {
        schemaVersion: 1,
        deviceId: id,
        snapshotName,
        savedAt: 0,
        guestBootId,
        stage: 'saving',
        emulatorVersion: identity.emulatorVersion,
        imagePackageName: device.imagePackageName,
        imageRevision: identity.imageRevision,
        gpuBackend: identity.gpuBackend,
        hardwareFingerprint: identity.fingerprint
      }
      await writeHibernationManifest(id, manifest, avdDirs())
      const response = await emuConsoleExec(
        port,
        `avd snapshot save ${snapshotName}`,
        HIBERNATE_SAVE_ACCEPT_MS
      )
      if (/KO|error|failed/i.test(response)) {
        throw new Error(msg('hibernateSaveRejected', { response }))
      }
      await waitHibernationSnapshotStable(hibernationSnapshotDir(id, snapshotName, avdDirs()), {
        firstByteBudgetMs: SNAPSHOT_FIRST_BYTE_MS,
        stableBudgetMs: SNAPSHOT_STABLE_MS,
        intervalMs: SNAPSHOT_POLL_MS
      })
      saved = true
      savedManifest = { ...manifest, stage: 'saved', savedAt: Date.now() }
      await writeHibernationManifest(id, savedManifest, avdDirs())
    }
    // D5：优雅退出 → 端口复核（探测只认真实监听，不受 TIME_WAIT 干扰）
    const port = runner.portOf(id)
    if (port === undefined) throw new Error(msg('hibernateProcessLost'))
    await runner.quit(id)
    exited = true
    let portsHeld = !(await portsReleased(port))
    if (portsHeld) {
      // 退避复探：进程关闭后端口的摘除可能滞后
      await new Promise((resolve) => setTimeout(resolve, 500))
      portsHeld = !(await portsReleased(port))
    }
    if (portsHeld) {
      // 进程已确认退出（quit 已等 close）：端口被占是外来者——不撤回休眠，
      // 以显式异常留痕（快照有效、可恢复/放弃）
      console.warn(`[hibernate] 设备 ${id} 进程已退出但端口 ${port} 仍被监听（疑似外部占用）`)
    }
    await writeHibernationManifest(id, { ...savedManifest, stage: 'hibernated' }, avdDirs())
    const target = requireDevice(id)
    if (target.status === 'hibernating') {
      target.status = 'hibernated'
      target.serial = undefined
      target.runId = undefined
      target.startedAt = undefined
      target.cameraNotice = undefined
      target.lastError = portsHeld
        ? { code: 'hibernate-port-anomaly', message: msg('hibernatePortHeldWarning', { port }) }
        : undefined
      cameraOverridesByDevice.delete(id)
      displayArgsByDevice.delete(id)
      broadcastChanged()
    }
    // 旧休眠快照在进程退出后清理（运行中删除再复用同名实测会静默丢快照——PoC 发现）；
    // 必须保留本次快照：keepName 传 null 会把刚保存的快照一并删掉，恢复即「快照缺失」
    void cleanupOldHibernationSnapshots(id, savedManifest.snapshotName, avdDirs(), (message) =>
      console.warn(message)
    )
    return snapshotNow()
  } catch (error) {
    const target = devicesNow().find((entry) => entry.id === id)
    if (!target || target.status !== 'hibernating') throw error
    if (!saved) {
      // 保存失败：实例仍活 → 恢复运行 + 媒体重建；进程已亡 → stopped（不伪装休眠）
      await removeHibernationManifest(id, avdDirs()).catch(() => undefined)
      if (runner.phaseOf(id) === 'running') {
        target.status = 'running'
        target.lastError = {
          code: 'hibernate-save-failed',
          message: msg('hibernateSaveFailed', { message: messageOf(error) })
        }
        broadcastChanged()
        if (target.serial && target.runId) {
          streamBridge.running?.(id, target.runId, target.serial)
        }
      } else {
        target.status = 'stopped'
        target.serial = undefined
        target.runId = undefined
        target.startedAt = undefined
        target.cameraNotice = undefined
        target.lastError = {
          code: 'hibernate-aborted',
          message: msg('hibernateAbortedProcessLost', { message: messageOf(error) })
        }
        broadcastChanged()
        streamBridge.stopped?.(id)
      }
      throw error
    }
    // 退出失败（进程不退/清单读取失败）：保持 hibernating + 原因 + 重试出口（设计 C）
    void exited
    target.lastError = {
      code: 'hibernate-exit-failed',
      message: msg('hibernateExitFailed', { message: messageOf(error) })
    }
    broadcastChanged()
    throw error
  }
}

export const hibernateDevice = (id: string): Promise<DeviceSnapshot> => {
  const flight = hibernationFlights.get(id)
  if (flight) return flight
  const promise = hibernateFlow(id).finally(() => hibernationFlights.delete(id))
  hibernationFlights.set(id, promise)
  return promise
}

const resumeFlow = async (id: string): Promise<DeviceSnapshot> => {
  await ensureLoaded()
  adbRecovery.assertOpen()
  const device = requireDevice(id)
  if (device.status !== 'hibernated') throw new Error(msg('resumeNotHibernated'))
  if (editFlights.has(id)) throw new Error(msg('blockStartWhileSaving'))
  const capability = hibernationCapabilityOf(device)
  if (!capability.available) {
    throw new Error(capability.disabledReason ?? msg('hibernationUnsupportedPlatform'))
  }
  const record = await readHibernationManifest(id, avdDirs())
  if (record.kind !== 'ok' || record.manifest.stage !== 'hibernated') {
    throw new Error(msg('hibernateRecordInvalid'))
  }
  const manifest = record.manifest
  // 兼容校验（设计 D6/D8）：镜像、emulator 版本、硬件指纹、快照文件在场
  if (manifest.imagePackageName !== device.imagePackageName) {
    throw new Error(msg('resumeIncompatibleImage'))
  }
  if (!(await hibernationSnapshotExists(id, manifest.snapshotName, avdDirs()))) {
    throw new Error(msg('resumeSnapshotMissing'))
  }
  const identity = await currentFingerprint(device)
  if (identity.fingerprint !== manifest.hardwareFingerprint) {
    throw new Error(msg('resumeIncompatibleFingerprint'))
  }
  device.status = 'resuming'
  device.lastError = undefined
  device.cameraNotice = undefined
  device.startedAt = Date.now()
  const attemptId = randomUUID()
  device.runId = attemptId
  resumePlansByDevice.set(id, {
    runId: attemptId,
    snapshotName: manifest.snapshotName,
    expectedBootId: manifest.guestBootId
  })
  broadcastChanged()
  try {
    const { runId, serial } = await runner.start(id, attemptId)
    const target = devicesNow().find((entry) => entry.id === id)
    if (target?.runId === attemptId && target.status === 'resuming') {
      target.runId = runId
      target.serial = serial
      broadcastChanged()
    }
  } catch (error) {
    resumePlansByDevice.delete(id)
    const target = devicesNow().find((entry) => entry.id === id)
    if (target?.runId === attemptId && target.status === 'resuming') {
      if (error instanceof StartCancelledError) {
        // 取消恢复：快照与清单保留，回到 hibernated（不得 stopped）
        target.status = 'hibernated'
        target.runId = undefined
        target.startedAt = undefined
      } else {
        target.status = 'hibernated'
        target.runId = undefined
        target.startedAt = undefined
        target.lastError = {
          code: 'resume-failed',
          message: msg('hibernateResumeFailed', { detail: messageOf(error) })
        }
      }
      broadcastChanged()
    }
    throw error
  }
  return snapshotNow()
}

export const resumeDevice = (id: string): Promise<DeviceSnapshot> => {
  const flight = hibernationFlights.get(id)
  if (flight) return flight
  const promise = resumeFlow(id).finally(() => hibernationFlights.delete(id))
  hibernationFlights.set(id, promise)
  return promise
}

const discardFlow = async (id: string): Promise<DeviceSnapshot> => {
  await ensureLoaded()
  adbRecovery.assertOpen()
  const device = requireDevice(id)
  if (device.status !== 'hibernated') throw new Error(msg('discardNotHibernated'))
  if (editFlights.has(id)) throw new Error(msg('blockStartWhileSaving'))
  const record = await readHibernationManifest(id, avdDirs())
  if (record.kind === 'ok') {
    const { rm } = await import('node:fs/promises')
    // 删除快照目录（进程已退出，安全窗口）与清单；失败保留 hibernated 附原因
    await rm(hibernationSnapshotDir(id, record.manifest.snapshotName, avdDirs()), {
      recursive: true,
      force: true
    })
  }
  await cleanupOldHibernationSnapshots(id, null, avdDirs(), (message) => console.warn(message))
  await removeHibernationManifest(id, avdDirs())
  const target = requireDevice(id)
  if (target.status === 'hibernated') {
    target.status = 'stopped'
    target.lastError = undefined
    broadcastChanged()
  }
  return snapshotNow()
}

export const discardHibernationDevice = (id: string): Promise<DeviceSnapshot> => {
  const flight = hibernationFlights.get(id)
  if (flight) return flight
  const promise = discardFlow(id).finally(() => hibernationFlights.delete(id))
  hibernationFlights.set(id, promise)
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
  adbRecovery.assertOpen()
  const targets = devicesNow()
    .filter((device) => originOfMeta(device) === 'app-owned')
    .map((device) => ({ id: device.id, name: device.name }))
  const deleted: Array<{ id: string; name: string }> = []
  const failures: Array<{ name: string; message: string }> = []
  for (const target of targets) {
    try {
      // 内部级联（设计 E）：不受用户通道 stopped-only 限制，保留先停后删
      await deleteDevice(target.id, { bypassOriginBucket: true, internal: true })
      deleted.push(target)
    } catch (error) {
      failures.push({ name: target.name, message: messageOf(error) })
    }
  }
  return { deleted, failures }
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
        device.status === 'stopping' ||
        device.status === 'hibernating'
      ) {
        // 休眠中断（save/quit 未完成）：清单停在 saving/saved——下次启动扫描按
        // 「中断休眠」解释为 stopped + 原因，不伪装已休眠
        device.status = 'stopped'
        device.serial = undefined
        device.runId = undefined
        device.cameraNotice = undefined
        streamBridge.stopped?.(device.id)
      } else if (device.status === 'resuming') {
        // 恢复中断：清单未消费（stage 仍 hibernated）——下次启动投影回 hibernated
        device.status = 'hibernated'
        device.serial = undefined
        device.runId = undefined
        device.startedAt = undefined
        device.cameraNotice = undefined
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
