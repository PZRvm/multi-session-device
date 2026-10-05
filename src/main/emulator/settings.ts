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

const DEFAULT_INTERNAL_STORAGE_MIB = 6 * 1024
const DEFAULT_CPU_CORES = 4
const DEFAULT_VM_HEAP_MIB = 256
const MIN_RAM_MIB = 2048
const MAX_VM_HEAP_MIB = 1024

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
}): WizardCapabilities => {
  const ramDefault =
    input.profile.ramMiB !== null && input.profile.ramMiB >= MIN_RAM_MIB
      ? input.profile.ramMiB
      : Math.max(input.profile.ramMiB ?? 0, MIN_RAM_MIB)
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
    vmHeapMiB: DEFAULT_VM_HEAP_MIB,
    preferredAbi: 'optimal'
  }
  return {
    capabilityContextId: `${input.profile.id}|${input.imagePackageName}|${input.emulatorVersion ?? 'none'}`,
    emulatorVersion: input.emulatorVersion,
    defaults,
    fields: {
      skinRef: disabled('机型皮肤即将支持（导入与受控下载就绪后开放）'),
      frontCamera: disabled('真实宿主摄像头即将支持；当前可选模拟或关闭'),
      rearCamera: disabled('真实宿主摄像头即将支持；当前可选模拟或关闭'),
      networkSpeed: enabled(),
      networkLatency: enabled(),
      orientation:
        input.profile.formFactor === 'wear' || input.profile.formFactor === 'tv'
          ? disabled('该形态不支持固定初始朝向')
          : enabled(),
      bootMode: disabled('Quick Boot 尚未通过稳定性门槛，当前按 Cold Boot 创建'),
      internalStorageMiB: enabled(2048, 64 * 1024),
      cpuCores: enabled(1, hostCpuCores()),
      graphics: enabled(),
      ramMiB: enabled(MIN_RAM_MIB, 32 * 1024),
      vmHeapMiB: enabled(64, MAX_VM_HEAP_MIB),
      preferredAbi: disabled('跨架构镜像属二期；Optimal 即解析为选中包 ABI')
    },
    quickBootAvailable: false,
    quickBootDisabledReason:
      'Quick Boot 尚未通过稳定性门槛（连续恢复测试进行中），当前按 Cold Boot 创建',
    webcamDeviceIds: [],
    skinIds: []
  }
}
