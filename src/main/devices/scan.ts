import type { ReconcileReport, ReconcileResult } from '@shared/types'
import { runReconciliation, type ReconcileOutcome } from '../emulator/reconcile'
import {
  hibernationSnapshotExists,
  readHibernationManifest,
  removeHibernationManifest
} from '../emulator/hibernation'
import { readDeviceStore } from '../store'
import { msg } from '../locale'
import { avdDirs, ensureFrameIndex, messageOf, reconcileDirs } from './environment'
import {
  applyFrozenTargets,
  enqueueStoreTask,
  rereadStore,
  runTransactionRecovery,
  setAcceptedMetas
} from './persistence'
import {
  avdEpochNow,
  broadcastChanged,
  bumpAvdEpoch,
  devicesNow,
  lastReportNow,
  metaRevisionNow,
  reconciliationSummaryNow,
  rebuildDevices,
  revisionNow,
  setDevices,
  setLastReport,
  setStoreHealth,
  setSuspectIds,
  snapshotNow,
  storeHealthNow,
  suspectIdsNow,
  toMeta,
  transientIdsNow
} from './state'

/** 确认签名记录（对账域私有）：同内容异常只提示一次，异常清零后复位 */
let acknowledgedSignature: string | null = null
/** 人工重查单飞（reconcileDevices 私有）：进行中合并后续调用 */
let reconcilePromise: Promise<ReconcileResult> | null = null

/**
 * 首次加载（issue 2026-10-03 双读的收口）：并发调用共享同一 Promise，失败可重试。
 * JSON 解析与文件核验都在共享 Promise 内完成后才发布列表（plan 对账设计 3）。
 */
let loadPromise: Promise<void> | null = null
export const ensureLoaded = (): Promise<void> => {
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
  setStoreHealth(read.health)
  setSuspectIds(read.suspectIds)
  setAcceptedMetas(read.health.state === 'error' ? null : read.metas)
  setDevices(rebuildDevices(read.metas))
  applyFrozenTargets(devicesNow())
  await applyHibernationRecords()
  applyScan(await scanCurrent())
}

/**
 * 启动扫描的休眠投影（plan 2026-11-06 设计 B）：saved/hibernated 清单（进程退出
 * 已确认或保存已完成）→ hibernated；saving 中断/清单损坏/快照文件缺失 → stopped
 * 附明确原因并清理不可恢复的记录——不一律重置，也不把中断伪装成已休眠。
 */
const applyHibernationRecords = async (): Promise<void> => {
  for (const device of devicesNow()) {
    if (device.status !== 'stopped') continue
    const record = await readHibernationManifest(device.id, avdDirs())
    if (record.kind === 'none') continue
    if (record.kind === 'corrupt') {
      device.lastError = {
        code: 'hibernation-corrupt',
        message: msg('hibernationRecordCorrupt', { reason: record.reason })
      }
      await removeHibernationManifest(device.id, avdDirs())
      continue
    }
    const manifest = record.manifest
    if (manifest.stage === 'saving') {
      device.lastError = {
        code: 'hibernation-interrupted',
        message: msg('hibernationInterrupted')
      }
      await removeHibernationManifest(device.id, avdDirs())
      continue
    }
    if (await hibernationSnapshotExists(device.id, manifest.snapshotName, avdDirs())) {
      device.status = 'hibernated'
    } else {
      device.lastError = {
        code: 'hibernation-snapshot-missing',
        message: msg('hibernationSnapshotMissing')
      }
      await removeHibernationManifest(device.id, avdDirs())
    }
  }
}

/** 文件扫描（长任务，writeQueue 外运行）；服务异常收敛为 scanError 不 reject。
 * transient 行（creating/deleting）不进单目标核验（review P2-2）：半成品文件不是
 * 稳定目标，扫描只会误报 missing/broken 并误弹汇总；孤立组另由 transientIds 暂缓。 */
const scanCurrent = async (): Promise<ReconcileOutcome> => {
  try {
    return await runReconciliation({
      metas: devicesNow()
        .filter((device) => device.status !== 'creating' && device.status !== 'deleting')
        .map(toMeta),
      badMetaIds: new Set(suspectIdsNow()),
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
    store: storeHealthNow(),
    summary: reconciliationSummaryNow(),
    scanError: lastReportNow()?.scanError ?? null,
    devices: devicesNow().map((device) => [
      device.id,
      device.availability?.state ?? null,
      device.availability?.issues.map((issue) => [issue.code, issue.severity]) ?? null,
      device.lastError?.code ?? null
    ])
  })

/** 合并一轮扫描：只写 availability 与报告，运行字段原样保留；无语义变化不广播 */
const applyScan = (outcome: ReconcileOutcome): void => {
  const before = changeKey()
  for (const device of devicesNow()) {
    const availability = outcome.availabilityById.get(device.id)
    if (availability === undefined) continue
    device.availability = availability
    // 只清理对账能确认恢复的 avd-missing；其他启动/删除/摄像头错误按原命令规则处理
    if (availability.state === 'valid' && device.lastError?.code === 'avd-missing') {
      device.lastError = undefined
    }
  }
  setLastReport(buildReport(outcome))
  if (changeKey() !== before) broadcastChanged()
  // 异常清零后复位确认记录（review P3）：同内容异常复发时重新提示
  if (lastReportNow()?.signature === null) acknowledgedSignature = null
  syncReportRevision()
}

/** report.revision 对齐发布快照的代次（review P3——原恒差 1） */
export const syncReportRevision = (): void => {
  const report = lastReportNow()
  if (report !== null) setLastReport({ ...report, revision: revisionNow() })
}

/**
 * 逐设备核验后的报告刷新（review P3）：行内 availability 更新也同步 deviceIssues/
 * 签名/摘要——避免汇总条空文案常驻、详情滞留已修复的异常。orphan/scanError/checkedAt
 * 沿上一轮（这两条路径不重扫文件，上一轮结论仍有效）。
 */
export const refreshReportFromDevices = (): void => {
  const report = lastReportNow()
  if (report === null) return
  const deviceIssues = collectDeviceIssues()
  const signature = computeSignature(
    {
      orphans: report.orphanEntries,
      unrecognizedCount: report.unrecognizedCount,
      scanError: report.scanError
    },
    deviceIssues
  )
  setLastReport({
    ...report,
    deviceIssues,
    signature,
    pendingNotification: signature !== null && signature !== acknowledgedSignature
  })
  if (signature === null) acknowledgedSignature = null
}

const buildReport = (outcome: ReconcileOutcome): ReconcileReport => {
  const deviceIssues = collectDeviceIssues()
  const signature = computeSignature(outcome, deviceIssues)
  return {
    revision: revisionNow(),
    signature,
    checkedAt: outcome.checkedAt,
    storeHealth: storeHealthNow(),
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
  devicesNow()
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
  const health = storeHealthNow()
  const hasAnomaly =
    health.state !== 'ok' ||
    health.issues.length > 0 ||
    deviceIssues.some((entry) => entry.availability.state !== 'valid') ||
    outcome.orphans.length > 0 ||
    outcome.unrecognizedCount > 0
  if (!hasAnomaly) return null
  return JSON.stringify({
    storeState: health.state,
    store: health.issues.map((issue) => [issue.code, issue.entryIndex ?? -1]),
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

/** 人工重查/事务收尾共用单飞；完成后清空——下一次调用重新执行 */
export const reconcileDevices = (): Promise<ReconcileResult> => {
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
    const startMeta = metaRevisionNow()
    const startEpoch = avdEpochNow()
    outcome = await scanCurrent()
    if (startMeta === metaRevisionNow() && startEpoch === avdEpochNow()) break
    outcome = null
  }
  if (outcome === null) {
    // 三轮代次全部失配（review P3）：保留上一轮结果与 checkedAt，只叠加未完成说明
    // ——不伪装刚检查过、不抹掉既有 orphans/deviceIssues；scanError 不参与签名，不重弹
    const churned = lastReportNow()
    if (churned !== null) {
      const before = changeKey()
      setLastReport({
        ...churned,
        scanError: msg('reconcileChurn')
      })
      if (changeKey() !== before) broadcastChanged()
      syncReportRevision()
    }
    return { snapshot: snapshotNow(), report: lastReportNow()! }
  }
  applyScan(outcome)
  return { snapshot: snapshotNow(), report: lastReportNow()! }
}

/**
 * SDK 来源变更后的全量可用性重查（plan 2026-10-12-device-list-source-aware）：
 * 生效根变了，镜像核验结果跟着变——fire-and-forget 沿删除/创建回滚后的对账先例，
 * 单飞守卫合并连续切换。ipc/index.ts 登记点经 onSdkSourceChanged 接线。
 */
export const triggerSourceChangeReconcile = (): void => {
  void reconcileDevices().catch(() => undefined)
}

/** 确认已展示某签名的异常汇总（对账设计 5）：只消费当前签名的待提示态 */
export const acknowledgeReconciliation = (signature: string): void => {
  const report = lastReportNow()
  if (report === null || report.signature === null) return
  if (report.signature !== signature) return // 迟到确认不消费新异常
  acknowledgedSignature = signature
  if (report.pendingNotification) {
    setLastReport({ ...report, pendingNotification: false })
    broadcastChanged()
  }
}
