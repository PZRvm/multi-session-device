import { app } from 'electron'
import { join } from 'node:path'
import type { Device, DeviceMeta } from '@shared/types'
import { bucketOfShared, originOfMeta } from '@shared/deviceOrigin'
import { isSharedReadOnly } from '../emulator/sdkSource'
import { readAvdConfigRaw, writeAvdConfigRaw } from '../emulator/deviceConfig'
import {
  recoverPendingTransactions,
  removeJournal,
  transactionsDir,
  writeJournal,
  type RecoveryResult
} from '../emulator/configTransaction'
import { armStoreProtection, readDeviceStore, writeDeviceMetas } from '../store'
import { msg } from '../locale'
import { avdDirs, messageOf } from './environment'
import {
  bumpMetaRevision,
  devicesNow,
  frozenMessages,
  rebuildDevices,
  setDevices,
  setStoreHealth,
  setSuspectIds,
  storeHealthNow
} from './state'

/** 最后接纳/成功提交的元数据（外部变化判定基准）；null = 尚无可信列表。
 *  仅持久化域读写（受控重读与两处提交路径）——ESM let 不可外部赋值，收在本文件。 */
let acceptedMetas: DeviceMeta[] | null = null
export const setAcceptedMetas = (next: DeviceMeta[] | null): void => {
  acceptedMetas = next
}

/** 首载事务恢复（内容裁决见 configTransaction）；冻结目标记录消息并落到行内 lastError */
export const runTransactionRecovery = async (): Promise<RecoveryResult> => {
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
export const applyFrozenTargets = (list: Device[]): void => {
  for (const device of list) {
    const message = frozenMessages.get(device.id)
    if (message === undefined || device.lastError?.code === 'config-transaction') continue
    device.lastError = { code: 'config-transaction', message }
  }
}

export const deepEqual = (a: unknown, b: unknown): boolean => {
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
export const rereadStore = async (): Promise<void> => {
  const read = await readDeviceStore()
  if (read.health.state === 'error') {
    setStoreHealth(read.health)
    setSuspectIds(read.suspectIds)
    return
  }
  if (acceptedMetas === null) {
    // 初载 error 后首次成功重读：首次建立可信列表（同 id 保留运行字段；初载 error
    // 时 devices 必为空，运行字段保留是防御性口径）
    setStoreHealth(read.health)
    setSuspectIds(read.suspectIds)
    acceptedMetas = read.metas
    setDevices(rebuildDevices(read.metas))
    return
  }
  if (!metasEqual(read.metas, acceptedMetas)) {
    // 外部改名/重排/删行（含文件消失）：保留内存与运行设备，冻结写入，提示重启载入
    if (read.health.state === 'ok') {
      armStoreProtection(msg('storeExternalModifiedFrozen'))
    }
    setStoreHealth({
      state: 'read-only',
      issues: [
        ...read.health.issues,
        {
          code: 'metadata-changed',
          message: msg('storeExternalModifiedAtLoad')
        }
      ]
    })
    setSuspectIds(read.suspectIds)
    return
  }
  // 与最后接纳一致：readDeviceStore 的 ok 已解除写保护（生产唯一解除入口）
  setStoreHealth(read.health)
  setSuspectIds(read.suspectIds)
}

// 全局串行写队列（单写方持有）：元数据提交与受控重读共用
// （对账设计 3——保护状态提交不与写盘交错）
let writeQueue: Promise<void> = Promise.resolve()

export const enqueueStoreTask = <T>(task: () => Promise<T>): Promise<T> => {
  const run = writeQueue.then(task)
  writeQueue = run.then(
    () => undefined,
    () => undefined
  ) // 单次失败不断队列
  return run
}

/** 单写方持有（ESM let 不可外部赋值）：提交后重建内存列表，在途创建的临时行
 * （creating 且不在草稿里）追加在末尾保进度。复查 P2-1：写盘基线是已提交元数据，
 * 临时行只在内存展示，不因提交而丢失或落盘。 */
const rebuildWithPendingRows = (draft: DeviceMeta[]): Device[] => {
  const committedIds = new Set(draft.map((meta) => meta.id))
  return [
    ...rebuildDevices(draft),
    ...devicesNow().filter((device) => device.status === 'creating' && !committedIds.has(device.id))
  ]
}

/** 已提交 journal 的延迟清理登记：写前 CAS 命中时先重试清理，失败即中止提交 */
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
 * 元数据提交全局串行；写盘成功才改内存（issue 2026-10-03 落盘分叉的修法）。
 * 写前 CAS（review P3）：现有文件与最后接纳不一致（运行中被外部修改）→ 中止并冻结，
 * 不静默覆盖；草稿基线是 acceptedMetas（复查 P2-1：其他事务的创建临时行不进写盘
 * 内容，每个事务只发布已提交行）；内存按草稿重建并保留完整运行字段与临时行。
 * 残留事务门（复查 P2-2）：本次内容变化命中待清理 journal 的设备先重试清理，
 * 失败即中止——应用不能把元数据改出记录 old/new 之外，否则重启恢复误判外部修改。
 */
export const commitMetas = (mutate: (metas: DeviceMeta[]) => DeviceMeta[]): Promise<void> =>
  enqueueStoreTask(async () => {
    const guard = await readDeviceStore()
    if (
      guard.health.state !== 'error' &&
      acceptedMetas !== null &&
      !metasEqual(guard.metas, acceptedMetas)
    ) {
      armStoreProtection(msg('storeExternalModifiedAtWrite'))
      setStoreHealth({
        state: 'read-only',
        issues: [
          ...guard.health.issues,
          {
            code: 'metadata-changed',
            message: msg('storeWriteAbortedV1')
          }
        ]
      })
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
      const label = devicesNow().find((entry) => entry.id === meta.id)?.name ?? meta.id
      try {
        await removeJournal(journalDir, meta.id)
        pendingJournalCleanup.delete(meta.id)
      } catch (error) {
        throw new Error(msg('configJournalStale', { label, message: messageOf(error) }))
      }
    }
    await writeDeviceMetas(draft)
    setDevices(rebuildWithPendingRows(draft))
    acceptedMetas = draft
    bumpMetaRevision()
  })

/**
 * config × 元数据跨文件事务（plan 设计 3.3/3.4）：在全局元数据队列内执行——
 * 重新 CAS 元数据、复验原 config 字节、持久记录 old/new、原子写 config、
 * store 唯一入口写元数据、成功后清理记录。元数据写失败恢复原 config；回滚失败
 * 保留记录并冻结目标。任务体内直接操作不嵌套调用同一队列（不自等待）。
 */
export const commitMetasWithConfig = (
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
      setStoreHealth({
        state: 'read-only',
        issues: [
          ...guard.health.issues,
          {
            code: 'metadata-changed',
            message: msg('storeWriteAbortedV1')
          }
        ]
      })
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
      setDevices(rebuildWithPendingRows(draft))
      acceptedMetas = draft
      bumpMetaRevision()
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
        const target = devicesNow().find((entry) => entry.id === id)
        if (target) target.lastError = { code: 'config-transaction', message }
        throw new Error(message)
      }
      throw metaFailure
    }
    await cleanupCommittedJournal(dir, id)
  })

/** 元数据写命令的副作用前守卫（对账设计 3）：error/read-only 都拒绝并说明原因 */
export const assertMetaWritable = (action: string): void => {
  const health = storeHealthNow()
  if (health.state === 'error') {
    throw new Error(
      msg('storeErrorBlocked', {
        issues: health.issues[0]?.message ?? msg('unknownError'),
        action
      })
    )
  }
  if (health.state === 'read-only') {
    throw new Error(
      msg('storeReadonlyBlocked', {
        issues: health.issues.map((issue) => issue.message).join('；'),
        action
      })
    )
  }
}

/**
 * 跨来源设备只读（plan 2026-10-12-device-list-origin-view-filter 用户复核 5）：
 * 另一桶出身的设备在当前来源下禁止改名/删除/编辑保存——UI 禁用为主，此处双保险
 * （禁用态可被伪造入参绕过）。启动/停止不受限：运行中设备必须可停（豁免条款），
 * 启动可行性与来源的关系由既有健康核验表达，不入此守卫。
 */
export const assertDeviceInCurrentBucket = (device: Device): void => {
  if (originOfMeta(device) !== bucketOfShared(isSharedReadOnly())) {
    throw new Error(msg('deviceCrossOriginBlocked'))
  }
}
