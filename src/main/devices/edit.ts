import { app } from 'electron'
import type {
  Device,
  DeviceAdvancedSettings,
  DeviceConfigField,
  DeviceConfigMismatch,
  DeviceEditFieldNote,
  DeviceEditSnapshot,
  DeviceEditStorageInfo,
  DeviceMeta,
  DeviceSnapshot,
  UpdateDeviceInput
} from '@shared/types'
import { normalizeEditedSettings, sanitizeUpdateSettings } from '@shared/settings-contract'
import { getLocaleState } from '../locale/store'
import { msg } from '../locale'
import {
  applyConfigPatchToText,
  buildConfigEditPatch,
  configFingerprintOf,
  parseConfigEntries,
  readAvdConfigRaw,
  readHardwareSchemaDefaults,
  storageMiBFromText
} from '../emulator/deviceConfig'
import { buildEnrichedCapabilities, readEmulatorVersion } from '../emulator/settings'
import { avdmanagerPathFor, listDeviceProfiles } from '../emulator/profiles'
import { sdklibJarPathFor } from '../emulator/profileMetadata'
import { CHECK_TIMEOUT_MS, checkDeviceHealth } from '../emulator/reconcile'
import { javaHomeFor } from '../emulator/sdkSource'
import { androidUserHomeFor } from '../emulator/androidUserHome'
import { listWebcams } from '../emulator/cameras'
import { configBaseline, configMismatchesOf } from '../emulator/configDrift'
import {
  avdDirs,
  messageOf,
  normalizeName,
  parseLegacyCamera,
  reconcileDirs,
  sdkRoot,
  skinDirectoryFor
} from './environment'
import {
  assertDeviceInCurrentBucket,
  commitMetas,
  commitMetasWithConfig,
  deepEqual
} from './persistence'
import { ensureLoaded } from './scan'
import { checkTimeoutAvailability, withDeadline } from './startup'
import {
  acceptingCommandsNow,
  broadcastChanged,
  bumpAvdEpoch,
  devicesNow,
  editFlights,
  frozenMessages,
  requireDevice,
  snapshotNow,
  storeHealthNow,
  toMeta
} from './state'

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
export const readDeviceConfig = async (id: string): Promise<DeviceEditSnapshot> => {
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
export const updateDeviceConfig = (input: UpdateDeviceInput): Promise<DeviceSnapshot> => {
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
