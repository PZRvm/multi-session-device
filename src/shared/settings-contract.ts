import type {
  CameraConfig,
  DeviceAdvancedSettings,
  GpuMode,
  NetworkPreset,
  WizardCapabilities
} from './types'

/**
 * 设置契约的纯函数层（main 与 renderer 共用单源）：枚举表、归一化校验、
 * config/argv 白名单映射。不依赖 Electron/Node 专有 API。
 * 枚举与边界锁定自所装 emulator 36.1.9 的 -help 实测（fixtures README）。
 */

/** -gpu 全集（emulator 36.1.9 实测；UI 暴露用户可懂的子集） */
export const GPU_MODES: GpuMode[] = [
  'auto',
  'auto-no-window',
  'host',
  'swiftshader_indirect',
  'angle_indirect',
  'guest'
]

/** -netspeed / -netdelay 预设（emulator 36.1.9 实测） */
export const NETWORK_SPEED_PRESETS: NetworkPreset[] = [
  'gsm',
  'hscsd',
  'gprs',
  'umts',
  'edge',
  'hsdpa',
  'lte',
  'evdo',
  '5g',
  'full'
]
export const NETWORK_DELAY_PRESETS: NetworkPreset[] = [
  'gsm',
  'hscsd',
  'gprs',
  'umts',
  'edge',
  'hsdpa',
  'lte',
  'evdo',
  '5g',
  'none'
]

export interface NormalizedSettings {
  settings: DeviceAdvancedSettings | null
  /** 字段名 → 中文错误（不合法值/越界）；空对象 = 通过 */
  errors: Record<string, string>
}

const isGpuMode = (value: unknown): value is GpuMode =>
  typeof value === 'string' && (GPU_MODES as string[]).includes(value)

const isNetworkPreset = (value: unknown): value is NetworkPreset =>
  typeof value === 'string' &&
  ([...NETWORK_SPEED_PRESETS, ...NETWORK_DELAY_PRESETS] as string[]).includes(value)

const normalizeCamera = (value: unknown, webcamIds: string[]): CameraConfig | null => {
  if (typeof value !== 'object' || value === null) return null
  const config = value as Record<string, unknown>
  if (config.mode === 'none' || config.mode === 'emulated' || config.mode === 'virtualScene') {
    return { mode: config.mode, deviceId: null }
  }
  // webcam：deviceId 必须是能力接口枚举到的宿主摄像头 id
  if (config.mode === 'webcam') {
    const deviceId = config.deviceId
    if (typeof deviceId === 'string' && webcamIds.includes(deviceId)) {
      return { mode: 'webcam', deviceId }
    }
  }
  return null
}

/**
 * 归一化用户输入：NaN/负数/越界/非法枚举逐字段报中文错误；ramMiB 对齐
 * 镜像最低要求、vmHeapMiB 不超过 RAM 的一半、存储 MiB 必须整除单位换算
 * （MB/GB 按 1024 换算，除不尽的输入报错不截断）。入参为 null 时返回 null。
 */
export const normalizeAdvancedSettings = (
  raw: DeviceAdvancedSettings | null,
  capabilities: WizardCapabilities
): NormalizedSettings => {
  if (raw === null) return { settings: null, errors: {} }
  const errors: Record<string, string> = {}

  const intIn = (field: string, value: number, min: number, max: number, label: string): number => {
    if (!Number.isInteger(value) || Number.isNaN(value)) {
      errors[field] = `${label}需要整数`
      return value
    }
    if (value < min || value > max) {
      errors[field] = `${label}需在 ${min}–${max} 之间`
    }
    return value
  }

  const storage = intIn(
    'internalStorageMiB',
    raw.internalStorageMiB,
    capabilities.fields.internalStorageMiB.min ?? 0,
    capabilities.fields.internalStorageMiB.max ?? Number.MAX_SAFE_INTEGER,
    '内部存储（MiB）'
  )
  // 存储换算可表示性：MiB 必须能被 1024 整除到 KB 级（sdkmanager 接受 6G/512M 形式，
  // 这里按 1024 换算后除不尽的 MiB 值明确报错，不静默截断）
  if (errors.internalStorageMiB === undefined && storage % 1 !== 0) {
    errors.internalStorageMiB = '内部存储无法按 1024 精确换算，请调整 MiB 值'
  }

  const ram = intIn(
    'ramMiB',
    raw.ramMiB,
    capabilities.fields.ramMiB.min ?? 0,
    capabilities.fields.ramMiB.max ?? Number.MAX_SAFE_INTEGER,
    'RAM（MiB）'
  )
  const heap = intIn(
    'vmHeapMiB',
    raw.vmHeapMiB,
    capabilities.fields.vmHeapMiB.min ?? 0,
    capabilities.fields.vmHeapMiB.max ?? Number.MAX_SAFE_INTEGER,
    'VM heap（MiB）'
  )
  if (Number.isFinite(ram) && Number.isFinite(heap) && heap > Math.floor(ram / 2)) {
    errors.vmHeapMiB = `VM heap 不能超过 RAM 的一半（${Math.floor(ram / 2)} MiB）`
  }
  const cpu = intIn(
    'cpuCores',
    raw.cpuCores,
    capabilities.fields.cpuCores.min ?? 1,
    capabilities.fields.cpuCores.max ?? Number.MAX_SAFE_INTEGER,
    'CPU 核数'
  )

  const frontCamera = normalizeCamera(raw.frontCamera, capabilities.webcamDeviceIds)
  if (frontCamera === null) {
    errors.frontCamera = '前摄像头取值不合法（none/emulated/virtualScene/webcam<枚举 id>）'
  }
  const rearCamera = normalizeCamera(raw.rearCamera, capabilities.webcamDeviceIds)
  if (rearCamera === null) {
    errors.rearCamera = '后摄像头取值不合法（none/emulated/virtualScene/webcam<枚举 id>）'
  }

  if (!isGpuMode(raw.graphics)) errors.graphics = 'GPU 模式取值不合法'
  if (
    raw.orientation !== null &&
    raw.orientation !== 'portrait' &&
    raw.orientation !== 'landscape'
  ) {
    errors.orientation = '初始朝向取值不合法'
  }
  if (raw.networkSpeed !== null && !isNetworkPreset(raw.networkSpeed)) {
    errors.networkSpeed = '网络速度取值不合法'
  }
  if (raw.networkLatency !== null && !isNetworkPreset(raw.networkLatency)) {
    errors.networkLatency = '网络延迟取值不合法'
  }
  if (raw.preferredAbi !== 'optimal' && raw.preferredAbi !== 'arm64-v8a') {
    errors.preferredAbi = 'ABI 取值不合法'
  }
  // Quick 未开放：强制回落 Cold（UI 已禁用，这里兜底防伪造入参）
  const bootMode: 'cold' | 'quick' =
    raw.bootMode === 'quick' && capabilities.quickBootAvailable ? 'quick' : 'cold'

  // 皮肤：必须在能力枚举内（sdk:* / imported:* / downloaded:*），否则拒绝
  if (raw.skinRef !== null && !capabilities.skinIds.includes(raw.skinRef)) {
    errors.skinRef = '皮肤不在可用清单中，请重新选择'
  }

  return {
    settings: {
      skinRef: raw.skinRef,
      frontCamera: frontCamera ?? { mode: 'emulated', deviceId: null },
      rearCamera: rearCamera ?? { mode: 'emulated', deviceId: null },
      networkSpeed: raw.networkSpeed,
      networkLatency: raw.networkLatency,
      orientation: raw.orientation,
      bootMode,
      internalStorageMiB: storage,
      cpuCores: cpu,
      graphics: isGpuMode(raw.graphics) ? raw.graphics : 'auto',
      ramMiB: ram,
      vmHeapMiB: heap,
      preferredAbi: raw.preferredAbi === 'arm64-v8a' ? 'arm64-v8a' : 'optimal'
    },
    errors
  }
}

/**
 * 设置 → AVD config.ini 白名单键值（首次启动前生效的持久字段）。
 * 网络/朝向摄像头启动参数见 settingsToRunnerArgs；未知键不在此出现。
 */
export const settingsToConfigPatch = (settings: DeviceAdvancedSettings): Record<string, string> => {
  const patch: Record<string, string> = {
    'hw.cpu.ncore': String(settings.cpuCores),
    'hw.ramSize': String(settings.ramMiB),
    'vm.heapSize': String(settings.vmHeapMiB),
    'hw.gpu.mode': settings.graphics,
    'disk.dataPartition.size': `${settings.internalStorageMiB}M`,
    'hw.camera.front':
      settings.frontCamera.mode === 'webcam'
        ? (settings.frontCamera.deviceId ?? 'webcam0')
        : settings.frontCamera.mode,
    'hw.camera.back':
      settings.rearCamera.mode === 'webcam'
        ? (settings.rearCamera.deviceId ?? 'webcam0')
        : settings.rearCamera.mode
  }
  if (settings.orientation !== null) {
    patch['hw.initialOrientation'] = settings.orientation
  }
  if (settings.skinRef !== null) {
    // sdk:<name> 写 skin.name（随 SDK 目录解析）；导入/下载皮肤由 main 补 skin.path
    patch['skin.name'] = settings.skinRef.replace(/^(sdk|imported|downloaded):/, '')
  }
  return patch
}

/** 设置 → emulator argv（运行字段；创建时写 config 的硬件值不被这里重复覆盖） */
export const settingsToRunnerArgs = (settings: DeviceAdvancedSettings): string[] => {
  const args: string[] = []
  if (settings.networkSpeed !== null) args.push('-netspeed', settings.networkSpeed)
  if (settings.networkLatency !== null) args.push('-netdelay', settings.networkLatency)
  // 用户显式选择 GPU 时不固定 host（auto 交由 emulator 自选）
  if (settings.graphics !== 'auto') args.push('-gpu', settings.graphics)
  const cameraValue = (camera: CameraConfig): string | null =>
    camera.mode === 'webcam' ? camera.deviceId : camera.mode === 'emulated' ? null : camera.mode
  const front = cameraValue(settings.frontCamera)
  if (front !== null) args.push('-camera-front', front)
  const rear = cameraValue(settings.rearCamera)
  if (rear !== null) args.push('-camera-back', rear)
  if (settings.bootMode === 'cold') {
    args.push('-no-snapshot')
  }
  return args
}
