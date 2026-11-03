import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { XMLParser } from 'fast-xml-parser'
import { cpus } from 'node:os'
import type {
  DeviceAdvancedSettings,
  DeviceProfile,
  SettingFieldCapability,
  WizardCapabilities
} from '@shared/types'
import { scanImportedSkins, scanSdkSkins } from './skins'
import { listWebcams, readCameraSnapshot } from './cameras'
import { officialSkinName } from './skinSource'

/**
 * 附加设置域（plan 设计 4）：能力构建（defaults/边界/禁用原因）与 emulator
 * 版本读取。枚举/归一化/映射的纯函数在 @shared/settings-contract（单源）。
 */

export {
  NETWORK_SPEED_PRESETS,
  NETWORK_DELAY_PRESETS,
  normalizeAdvancedSettings,
  settingsToConfigPatch,
  settingsToRunnerArgs
} from '@shared/settings-contract'
import { msg } from '../locale'

const DEFAULT_INTERNAL_STORAGE_MIB = 6 * 1024
const DEFAULT_CPU_CORES = 4
const DEFAULT_VM_HEAP_MIB = 256
const MIN_RAM_MIB = 2048
const MAX_VM_HEAP_MIB = 1024

/**
 * 已实测 RAM 自动抬高的组合边界（报告 2026-10-08 §3.4）：Emulator 37.2.12（build
 * 16428233）× pixel_8 × system-images;android-34;default;arm64-v8a 会把 2048 MiB
 * 自动提高到 2560 MiB。只对该组合按 2560 生效，不能推广到其他画像/镜像/版本——
 * 扩范围前必须实测对应版本策略。
 */
const VERIFIED_RAM_FLOOR = {
  emulatorVersions: ['37.2.12', '37.2.12.0'],
  emulatorBuildId: '16428233',
  imageRevision: 2,
  profileId: 'pixel_8',
  imagePackageName: 'system-images;android-34;default;arm64-v8a',
  minMiB: 2560
} as const

/** RAM 有效下限（创建与编辑共用同一规则）：已实测组合 2560，其余 2048 */
export const effectiveRamMin = (input: {
  profileId: string
  imagePackageName: string
  emulatorVersion: string | null
  emulatorBuildId?: string | null
  imageRevision?: number | null
}): number => {
  if (
    input.emulatorVersion !== null &&
    (VERIFIED_RAM_FLOOR.emulatorVersions as readonly string[]).includes(input.emulatorVersion) &&
    input.emulatorBuildId === VERIFIED_RAM_FLOOR.emulatorBuildId &&
    input.imageRevision === VERIFIED_RAM_FLOOR.imageRevision &&
    input.profileId === VERIFIED_RAM_FLOOR.profileId &&
    input.imagePackageName === VERIFIED_RAM_FLOOR.imagePackageName
  ) {
    return VERIFIED_RAM_FLOOR.minMiB
  }
  return MIN_RAM_MIB
}

const versionParser = new XMLParser({
  ignoreDeclaration: true,
  removeNSPrefix: true,
  ignoreAttributes: false,
  parseTagValue: false,
  trimValues: true
})

/** 所装 emulator 版本（<sdk>/emulator/package.xml 的 revision）；读不到 = null */
export const readEmulatorVersion = async (
  sdkRoot: string,
  deps: { readFile?: (path: string) => Promise<string> } = {}
): Promise<string | null> => {
  const read = deps.readFile ?? ((path: string) => readFile(path, 'utf8'))
  try {
    const parsed = versionParser.parse(await read(join(sdkRoot, 'emulator', 'package.xml'))) as {
      repository?: { localPackage?: { revision?: Record<string, unknown> } }
    }
    const revision = parsed.repository?.localPackage?.revision
    const major = revision?.major
    if (typeof major !== 'string' && typeof major !== 'number') return null
    const minor = revision?.minor
    const micro = revision?.micro
    return [major, minor ?? '0', micro ?? '0'].join('.')
  } catch {
    return null
  }
}

const hostCpuCores = (): number => {
  const count = cpus().length
  return count > 0 ? count : 4
}

const enabled = (min: number | null = null, max: number | null = null): SettingFieldCapability => ({
  disabledReason: null,
  min,
  max,
  step: min !== null && max !== null ? 1 : null
})

const disabled = (reason: string): SettingFieldCapability => ({
  disabledReason: reason,
  min: null,
  max: null,
  step: null
})

/**
 * 能力集：默认值 + 字段边界。RAM 默认跟随画像（XML ramMiB）并核验镜像
 * 最低要求（Android Q+ 镜像 2GB，PRD B）；CPU 上限取宿主逻辑核数。
 * 皮肤/真实摄像头/Quick 按各自批次开放前禁用并说明。
 */
export const buildCapabilities = (input: {
  profile: Pick<DeviceProfile, 'id' | 'ramMiB' | 'formFactor'>
  imagePackageName: string
  emulatorVersion: string | null
  emulatorBuildId?: string | null
  imageRevision?: number | null
}): WizardCapabilities => {
  // RAM 地板（Android Q+ 镜像 2GB，PRD B）只约束手机/平板；wear/tv 等形态
  // 尊重画像官方 RAM（review P3：此前所有形态一律抬 2GB），缺失时回 2048
  const profileRam = input.profile.ramMiB
  const minRam =
    input.profile.formFactor === 'phone' || input.profile.formFactor === 'tablet'
      ? effectiveRamMin({ ...input, profileId: input.profile.id })
      : Math.min(profileRam ?? MIN_RAM_MIB, MIN_RAM_MIB)
  const ramDefault =
    input.profile.formFactor === 'phone' || input.profile.formFactor === 'tablet'
      ? Math.max(profileRam ?? minRam, minRam)
      : (profileRam ?? MIN_RAM_MIB)
  const defaults: DeviceAdvancedSettings = {
    skinRef: null,
    frontCamera: { mode: 'emulated', deviceId: null },
    rearCamera: { mode: 'emulated', deviceId: null },
    networkSpeed: null,
    networkLatency: null,
    orientation: null,
    bootMode: 'cold',
    internalStorageMiB: DEFAULT_INTERNAL_STORAGE_MIB,
    cpuCores: DEFAULT_CPU_CORES,
    graphics: 'auto',
    ramMiB: ramDefault,
    vmHeapMiB: Math.min(DEFAULT_VM_HEAP_MIB, Math.floor(ramDefault / 2)),
    preferredAbi: 'optimal'
  }
  return {
    capabilityContextId: `${input.profile.id}|${input.imagePackageName}|${input.emulatorVersion ?? 'none'}`,
    emulatorVersion: input.emulatorVersion,
    defaults,
    fields: {
      skinRef: disabled(msg('capSkinNone')),
      // 摄像头字段开放（批次 8 已交付枚举/占用核验/启动重核验）；webcam 选项
      // 由 buildEnrichedCapabilities 按宿主枚举注入 webcamDeviceIds
      frontCamera: enabled(),
      rearCamera: enabled(),
      networkSpeed: enabled(),
      networkLatency: enabled(),
      orientation:
        input.profile.formFactor === 'wear' || input.profile.formFactor === 'tv'
          ? disabled(msg('capOrientationUnsupported'))
          : enabled(),
      bootMode: disabled(msg('capQuickBootGate')),
      internalStorageMiB: enabled(2048, 64 * 1024),
      cpuCores: enabled(1, hostCpuCores()),
      graphics: enabled(),
      ramMiB: enabled(minRam, 32 * 1024),
      vmHeapMiB: enabled(64, MAX_VM_HEAP_MIB),
      preferredAbi: disabled(msg('abiReadOnlyCrossArch'))
    },
    quickBootAvailable: false,
    quickBootDisabledReason: msg('capQuickBootGateWatching'),
    webcamDeviceIds: [],
    skinIds: []
  }
}

export interface EnrichedCapabilityDeps {
  scanSdkSkins?: typeof scanSdkSkins
  scanImportedSkins?: typeof scanImportedSkins
  listWebcams?: typeof listWebcams
  readFile?: (path: string) => Promise<string>
}

/**
 * 能力构建唯一入口（review P1 修复：双路径分叉）——buildCapabilities 打底，
 * 再补齐皮肤清单与宿主摄像头枚举并解锁 skinRef 字段。向导能力查询
 * （sdk:wizard-capabilities）与创建事务（createDevice）共用本函数，两侧
 * 校验口径恒一致：UI 放行的 skinRef/webcam 设置，创建侧不再因枚举为空被拒。
 * 枚举失败不禁用字段（摄像头只是没有 webcam 选项；皮肤字段保持禁用带原因）。
 */
export const buildEnrichedCapabilities = async (
  input: {
    profile: Pick<DeviceProfile, 'id' | 'ramMiB' | 'formFactor'>
    imagePackageName: string
    emulatorVersion: string | null
    emulatorBuildId?: string | null
    imageRevision?: number | null
  },
  sdkRoot: string,
  userData: string,
  deps: EnrichedCapabilityDeps = {}
): Promise<WizardCapabilities> => {
  let emulatorBuildId: string | null = null
  let imageRevision: number | null = null
  const read = deps.readFile ?? ((path: string) => readFile(path, 'utf8'))
  try {
    const emulatorSource = await read(join(sdkRoot, 'emulator', 'source.properties'))
    emulatorBuildId = emulatorSource.match(/^Pkg\.BuildId\s*=\s*(\d+)\s*$/m)?.[1] ?? null
    // imagePackageName originates from the catalog; still reject traversal at this read boundary.
    const segments = input.imagePackageName.split(';')
    if (
      segments.length === 4 &&
      segments[0] === 'system-images' &&
      segments.every((part) => /^[A-Za-z0-9_.-]+$/.test(part) && part !== '.' && part !== '..')
    ) {
      const source = await read(join(sdkRoot, ...segments, 'source.properties'))
      const revision = source.match(/^Pkg\.Revision\s*=\s*(\d+)\s*$/m)?.[1]
      imageRevision = revision === undefined ? null : Number(revision)
    }
  } catch {
    // Evidence missing: do not expand the verified floor to unknown builds/images.
  }
  const capabilities = buildCapabilities({ ...input, emulatorBuildId, imageRevision })
  const [sdkSkins, importedSkins] = await Promise.all([
    (deps.scanSdkSkins ?? scanSdkSkins)(sdkRoot),
    (deps.scanImportedSkins ?? scanImportedSkins)(userData)
  ])
  capabilities.skinIds = [...sdkSkins, ...importedSkins].map((record) => record.skinRef)
  capabilities.fields.skinRef =
    capabilities.skinIds.length > 0
      ? { disabledReason: null, min: null, max: null, step: null }
      : { disabledReason: msg('capSkinNone'), min: null, max: null, step: null }
  const recommendedName = officialSkinName(input.profile.id)
  const selectedSkin = [...sdkSkins, ...importedSkins].find(
    (record) => record.name === recommendedName
  )
  capabilities.recommendedSkin =
    recommendedName === null
      ? null
      : { name: recommendedName, skinRef: selectedSkin?.skinRef ?? null }
  capabilities.defaults.skinRef = selectedSkin?.skinRef ?? null
  try {
    capabilities.cameraSnapshot = deps.listWebcams
      ? { permission: 'unknown', devices: await deps.listWebcams(sdkRoot), error: null }
      : await readCameraSnapshot(sdkRoot)
    capabilities.webcamDeviceIds = capabilities.cameraSnapshot.devices.map((entry) => entry.id)
  } catch (error) {
    capabilities.webcamDeviceIds = []
    capabilities.cameraSnapshot = {
      permission: 'unknown',
      devices: [],
      error: msg('capCameraEnumFailed', {
        message: error instanceof Error ? error.message : String(error)
      })
    }
  }
  return capabilities
}
