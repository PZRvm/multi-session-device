import { adbRecovery } from '../emulator/adbRecovery'
import { app } from 'electron'
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { DeviceSnapshot } from '@shared/types'
import { CHECK_TIMEOUT_MS, checkDeviceHealth } from '../emulator/reconcile'
import { deleteAvd } from '../emulator/avd'
import { removeJournal, transactionsDir } from '../emulator/configTransaction'
import { StartCancelledError } from '../emulator/runner'
import { originOfMeta } from '@shared/deviceOrigin'
import { msg } from '../locale'
import { avdDirs, avdHome, messageOf, reconcileDirs } from './environment'
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
  requireDevice,
  setAcceptingCommands,
  snapshotNow,
  streamBridge,
  toMeta
} from './state'

// ---- 生命周期流程 ----

/** 停止/删除中的重复请求合并到同一次执行（deleteDevice 私有） */
const deleteFlights = new Map<string, Promise<DeviceSnapshot>>()

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
  adbRecovery.assertOpen()
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

export const deleteDevice = (
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
  adbRecovery.assertOpen()
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
