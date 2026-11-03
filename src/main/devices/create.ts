import { app } from 'electron'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { CreateDeviceInput, CreateDeviceResult, Device, DeviceSnapshot } from '@shared/types'
import { assessImageCompatibility, hostImageAbi } from '@shared/compatibility'
import { getLocaleState } from '../locale/store'
import { msg } from '../locale'
import { createAvd, deleteAvd, patchAvdConfig } from '../emulator/avd'
import {
  classifyTags,
  parseApiVersion,
  scanLocalImages,
  splitPackageName
} from '../emulator/catalog'
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
import { javaHomeFor } from '../emulator/sdkSource'
import { androidUserHomeFor } from '../emulator/androidUserHome'
import { activePackageOp, beginPackageCreation, endPackageCreation } from '../emulator/packageOps'
import {
  avdDirs,
  avdHome,
  ensureFrameIndex,
  frameKindOf,
  messageOf,
  reconcileDirs,
  sdkRoot,
  skinDirectoryFor
} from './environment'
import { assertDeviceInCurrentBucket, assertMetaWritable, commitMetas } from './persistence'
import {
  ensureLoaded,
  reconcileDevices,
  refreshReportFromDevices,
  syncReportRevision
} from './scan'
import { checkTimeoutAvailability, withDeadline } from './startup'
import {
  broadcastChanged,
  bumpAvdEpoch,
  checkingAvailability,
  devicesNow,
  editFlights,
  requireDevice,
  setDevices,
  snapshotNow,
  toMeta
} from './state'

export const createDevice = async (raw: CreateDeviceInput): Promise<CreateDeviceResult> => {
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
    getLocaleState(),
    hostImageAbi(process.platform)
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

export const renameDevice = async (id: string, name: string): Promise<DeviceSnapshot> => {
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
