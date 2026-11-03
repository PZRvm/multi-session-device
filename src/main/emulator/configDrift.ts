import type {
  CameraConfig,
  DeviceAdvancedSettings,
  DeviceConfigField,
  DeviceConfigMismatch,
  GpuMode,
  UpdateDeviceSettings
} from '@shared/types'
import { GPU_MODES } from '@shared/settings-contract'

/** config 的 RAM/heap 裸整数单位为 MiB；M/G 后缀按相同容量比较。 */
export const configMiB = (raw: string): number | null => {
  const match = raw.trim().match(/^([1-9]\d*)(M(?:iB)?|G(?:iB)?)?$/i)
  if (match === null) return null
  const value = Number(match[1]) * (match[2]?.toUpperCase().startsWith('G') ? 1024 : 1)
  return Number.isSafeInteger(value) ? value : null
}

const cameraValue = (raw: string, stored: CameraConfig): CameraConfig | null => {
  // emulator 只识别小写；历史 camelCase 进入未知值同步路径，保存时修正字面量。
  if (raw === 'virtualscene') return { mode: 'virtualScene', deviceId: null }
  if (raw === 'none' || raw === 'emulated') return { mode: raw, deviceId: null }
  if (!/^webcam\d+$/.test(raw)) return null
  return stored.mode === 'webcam' && stored.deviceId === raw
    ? stored
    : { mode: 'webcam', deviceId: raw }
}

/** 仅比较应用已经映射的可写配置；缺失键沿用既有默认/继承语义。 */
export const configMismatchesOf = (
  stored: DeviceAdvancedSettings | null,
  config: Map<string, string>,
  deps: { skinIds: string[]; skinDirectoryFor: (ref: string) => string }
): DeviceConfigMismatch[] => {
  if (stored === null) return []
  const result: DeviceConfigMismatch[] = []
  const compare = (field: DeviceConfigField, key: string, value: unknown, label?: string): void => {
    const raw = config.get(key)
    if (raw === undefined) return
    if (JSON.stringify(stored[field]) === JSON.stringify(value)) return
    result.push({
      field,
      actualLabel: label ?? raw.slice(0, 120),
      actualSettings: value === undefined ? null : ({ [field]: value } as UpdateDeviceSettings)
    })
  }
  const cpu = config.get('hw.cpu.ncore') ?? ''
  compare(
    'cpuCores',
    'hw.cpu.ncore',
    /^[1-9]\d*$/.test(cpu) && Number.isSafeInteger(Number(cpu)) ? Number(cpu) : undefined
  )
  for (const [field, key] of [
    ['ramMiB', 'hw.ramSize'],
    ['vmHeapMiB', 'vm.heapSize']
  ] as const) {
    const value = configMiB(config.get(key) ?? '')
    compare(field, key, value ?? undefined, value === null ? undefined : `${value} MiB`)
  }
  const gpu = config.get('hw.gpu.mode')
  compare('graphics', 'hw.gpu.mode', GPU_MODES.includes(gpu as GpuMode) ? gpu : undefined)
  for (const [field, key] of [
    ['frontCamera', 'hw.camera.front'],
    ['rearCamera', 'hw.camera.back']
  ] as const) {
    compare(field, key, cameraValue(config.get(key) ?? '', stored[field]) ?? undefined)
  }
  if (stored.orientation !== null) {
    const raw = config.get('hw.initialOrientation')
    compare(
      'orientation',
      'hw.initialOrientation',
      raw === 'portrait' || raw === 'landscape' ? raw : undefined
    )
  }
  if (stored.skinRef !== null) {
    const name = config.get('skin.name')
    // 同名沿用既有语义；采用另一皮肤时必须能验证其枚举身份及路径。
    if (name !== undefined && name !== stored.skinRef.replace(/^(sdk|imported|downloaded):/, '')) {
      const path = config.get('skin.path')
      const candidates = deps.skinIds.filter(
        (ref) =>
          ref.replace(/^(sdk|imported|downloaded):/, '') === name &&
          (path ? path === deps.skinDirectoryFor(ref) : ref.startsWith('sdk:'))
      )
      compare('skinRef', 'skin.name', candidates.length === 1 ? candidates[0] : undefined)
    }
  }
  return result
}

/** patch 以文件中可识别的值为基线，采用时保留原字面量和未知键。 */
export const configBaseline = (
  stored: DeviceAdvancedSettings,
  mismatches: DeviceConfigMismatch[]
): DeviceAdvancedSettings =>
  Object.assign(
    {},
    stored,
    ...mismatches.flatMap((item) => (item.actualSettings === null ? [] : [item.actualSettings]))
  )
