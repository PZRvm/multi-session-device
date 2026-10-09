import type {
  CameraConfig,
  DeviceAdvancedSettings,
  GpuMode,
  NetworkPreset,
  UpdateDeviceSettings,
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

/** -netspeed 与 -netdelay 的合法值不同（speed 无 none、delay 无 full）——逐字段校验（review P3：并集放行了 -netspeed none） */
const isNetworkSpeed = (value: unknown): value is NetworkPreset =>
  typeof value === 'string' && (NETWORK_SPEED_PRESETS as string[]).includes(value)

const isNetworkDelay = (value: unknown): value is NetworkPreset =>
  typeof value === 'string' && (NETWORK_DELAY_PRESETS as string[]).includes(value)

/**
 * 已存设置的纯形状守卫（store 读取诊断用）：只验形状与枚举闭集，不做能力归一化——
 * 旧记录未保存 hostDeviceId、null 设置、Quick 已存值与 unknown 形态都合法；
 * 不按今天的能力清单重新归一化，也不因 Quick 当前禁用把合法已存值判损坏。
 */
export const isStoredAdvancedSettings = (value: unknown): value is DeviceAdvancedSettings => {
  if (typeof value !== 'object' || value === null) return false
  const settings = value as Record<string, unknown>
  const camera = (entry: unknown): boolean => {
    if (typeof entry !== 'object' || entry === null) return false
    const config = entry as Record<string, unknown>
    if (
      config.mode !== 'none' &&
      config.mode !== 'emulated' &&
      config.mode !== 'virtualScene' &&
      config.mode !== 'webcam'
    ) {
      return false
    }
    if (config.deviceId !== null && typeof config.deviceId !== 'string') return false
    if (config.hostDeviceId !== undefined && typeof config.hostDeviceId !== 'string') return false
    // webcam 必须带字符串 deviceId（归一化产出的形状）：null/缺省会让启动核验
    // 被跳过、argv 静默回落默认摄像头（review P3——「读不到摄像头」零诊断）
    if (config.mode === 'webcam') {
      return typeof config.deviceId === 'string' && config.deviceId.length > 0
    }
    return config.deviceId === null
  }
  const intAtLeast = (entry: unknown, min: number): boolean =>
    typeof entry === 'number' && Number.isInteger(entry) && entry >= min
  return (
    (settings.skinRef === null || typeof settings.skinRef === 'string') &&
    camera(settings.frontCamera) &&
    camera(settings.rearCamera) &&
    (settings.networkSpeed === null || isNetworkSpeed(settings.networkSpeed)) &&
    (settings.networkLatency === null || isNetworkDelay(settings.networkLatency)) &&
    (settings.orientation === null ||
      settings.orientation === 'portrait' ||
      settings.orientation === 'landscape') &&
    (settings.bootMode === 'cold' || settings.bootMode === 'quick') &&
    intAtLeast(settings.internalStorageMiB, 0) &&
    intAtLeast(settings.cpuCores, 1) &&
    isGpuMode(settings.graphics) &&
    intAtLeast(settings.ramMiB, 1) &&
    intAtLeast(settings.vmHeapMiB, 1) &&
    (settings.preferredAbi === 'optimal' || settings.preferredAbi === 'arm64-v8a')
  )
}

const normalizeCamera = (value: unknown, capabilities: WizardCapabilities): CameraConfig | null => {
  if (typeof value !== 'object' || value === null) return null
  const config = value as Record<string, unknown>
  if (config.mode === 'none' || config.mode === 'emulated' || config.mode === 'virtualScene') {
    return { mode: config.mode, deviceId: null }
  }
  // webcam：deviceId 必须是能力接口枚举到的宿主摄像头 id
  if (config.mode === 'webcam') {
    const deviceId = config.deviceId
    if (typeof deviceId === 'string' && capabilities.webcamDeviceIds.includes(deviceId)) {
      const host = capabilities.cameraSnapshot?.devices.find(
        (entry) => entry.id === deviceId
      )?.deviceLabel
      if (config.hostDeviceId !== undefined && config.hostDeviceId !== host) return null
      return { mode: 'webcam', deviceId, ...(host ? { hostDeviceId: host } : {}) }
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

  const frontCamera = normalizeCamera(raw.frontCamera, capabilities)
  if (frontCamera === null) {
    errors.frontCamera = '前摄像头取值不合法（none/emulated/virtualScene/webcam<枚举 id>）'
  }
  const rearCamera = normalizeCamera(raw.rearCamera, capabilities)
  if (rearCamera === null) {
    errors.rearCamera = '后摄像头取值不合法（none/emulated/virtualScene/webcam<枚举 id>）'
  }

  if (!isGpuMode(raw.graphics)) errors.graphics = 'GPU 模式取值不合法'
  if (raw.orientation !== null) {
    if (raw.orientation !== 'portrait' && raw.orientation !== 'landscape') {
      errors.orientation = '初始朝向取值不合法'
    } else if (capabilities.fields.orientation?.disabledReason != null) {
      // main 复核字段禁用态（review P3）：wear/tv 等不支持固定朝向的形态，
      // 伪造入参不写进 config
      errors.orientation = capabilities.fields.orientation.disabledReason
    }
  }
  if (raw.networkSpeed !== null && !isNetworkSpeed(raw.networkSpeed)) {
    errors.networkSpeed = '网络速度取值不合法'
  }
  if (raw.networkLatency !== null && !isNetworkDelay(raw.networkLatency)) {
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
 * 摄像头 → config.ini 值：virtualscene 仅小写被 emulator 识别（37.2.12 隔离实测，
 * camelCase 会静默变成零摄像头）；webcam 缺资源号时回退 emulated。
 */
export const cameraConfigText = (camera: CameraConfig): string =>
  camera.mode === 'webcam'
    ? (camera.deviceId ?? 'emulated')
    : camera.mode === 'virtualScene'
      ? 'virtualscene'
      : camera.mode

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
    'hw.camera.front': cameraConfigText(settings.frontCamera),
    'hw.camera.back': cameraConfigText(settings.rearCamera)
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
  // -camera-* 参数不接受 virtualscene（37.2.12 实测 exit 1）：virtualScene 与
  // emulated 都不传参，交给 config.ini 承载；none/webcamN 可传参。
  const cameraValue = (camera: CameraConfig): string | null =>
    camera.mode === 'webcam'
      ? camera.deviceId
      : camera.mode === 'emulated' || camera.mode === 'virtualScene'
        ? null
        : camera.mode
  const front = cameraValue(settings.frontCamera)
  if (front !== null) args.push('-camera-front', front)
  const rear = cameraValue(settings.rearCamera)
  if (rear !== null) args.push('-camera-back', rear)
  if (settings.bootMode === 'cold') {
    args.push('-no-snapshot')
  }
  return args
}

// ---- 编辑差异闭集（plan 2026-10-08-device-config-edit）----

/** 编辑可写字段白名单：内部存储与应用 ABI 不在其中（恒不可写） */
export const EDITABLE_SETTING_KEYS = [
  'skinRef',
  'frontCamera',
  'rearCamera',
  'networkSpeed',
  'networkLatency',
  'orientation',
  'bootMode',
  'cpuCores',
  'graphics',
  'ramMiB',
  'vmHeapMiB'
] as const

/** 编辑仅归一化真实差异；未修改的旧字段（含失效资源）逐字保留。 */
export const normalizeEditedSettings = (
  original: DeviceAdvancedSettings,
  diff: UpdateDeviceSettings,
  capabilities: WizardCapabilities,
  syncFields: readonly (keyof UpdateDeviceSettings)[] = []
): NormalizedSettings => {
  const changed = EDITABLE_SETTING_KEYS.filter(
    (key) =>
      key in diff &&
      (syncFields.includes(key) || JSON.stringify(original[key]) !== JSON.stringify(diff[key]))
  )
  if (changed.length === 0) return { settings: original, errors: {} }
  const merged = { ...original, ...diff }
  const normalized = normalizeAdvancedSettings(merged, capabilities)
  const checked = new Set<string>(changed)
  if (checked.has('ramMiB') || checked.has('vmHeapMiB')) {
    checked.add('ramMiB')
    checked.add('vmHeapMiB')
  }
  const errors = Object.fromEntries(
    Object.entries(normalized.errors).filter(([key]) => checked.has(key))
  )
  const settings = { ...original }
  for (const key of changed) {
    const disabled = capabilities.fields[key]?.disabledReason
    if (
      disabled &&
      !(key === 'skinRef' && diff.skinRef === null) &&
      !(key === 'bootMode' && diff.bootMode === 'cold')
    ) {
      errors[key] = disabled
    }
    ;(settings as unknown as Record<string, unknown>)[key] = normalized.settings![key]
  }
  if (original.bootMode === 'quick') settings.bootMode = 'cold'
  return { settings, errors }
}

const isUpdateCamera = (value: unknown): value is CameraConfig => {
  if (typeof value !== 'object' || value === null) return false
  const camera = value as Record<string, unknown>
  if (
    camera.mode !== 'none' &&
    camera.mode !== 'emulated' &&
    camera.mode !== 'virtualScene' &&
    camera.mode !== 'webcam'
  ) {
    return false
  }
  if (camera.hostDeviceId !== undefined && typeof camera.hostDeviceId !== 'string') return false
  if (camera.mode === 'webcam') return typeof camera.deviceId === 'string' && camera.deviceId !== ''
  return camera.deviceId === null || camera.deviceId === undefined
}

/**
 * 编辑差异载荷守卫（main 侧入口，renderer 载荷不可信）：只接纳白名单键，
 * 形状逐键校验；存储/ABI 键出现即拒绝（即使值与原值相同——闭集不接受协商），
 * 未知键一律拒绝。返回原样定型的差异对象。
 */
export const sanitizeUpdateSettings = (raw: unknown): UpdateDeviceSettings => {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('附加设置载荷不合法')
  }
  const diff: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (key === 'internalStorageMiB' || key === 'preferredAbi') {
      throw new Error(key === 'internalStorageMiB' ? '内部存储不允许修改' : '应用 ABI 不允许修改')
    }
    if (!(EDITABLE_SETTING_KEYS as readonly string[]).includes(key)) {
      throw new Error(`附加设置包含非法字段（${key}）`)
    }
    let valid = false
    switch (key) {
      case 'skinRef':
        valid = value === null || typeof value === 'string'
        break
      case 'frontCamera':
      case 'rearCamera':
        valid = isUpdateCamera(value)
        break
      case 'networkSpeed':
        valid = value === null || isNetworkSpeed(value)
        break
      case 'networkLatency':
        valid = value === null || isNetworkDelay(value)
        break
      case 'orientation':
        valid = value === null || value === 'portrait' || value === 'landscape'
        break
      case 'bootMode':
        valid = value === 'cold' || value === 'quick'
        break
      case 'cpuCores':
      case 'ramMiB':
      case 'vmHeapMiB':
        valid = typeof value === 'number' && Number.isInteger(value) && value > 0
        break
      case 'graphics':
        valid = isGpuMode(value)
        break
    }
    if (!valid) throw new Error(`附加设置字段取值不合法（${key}）`)
    diff[key] = value
  }
  return diff as UpdateDeviceSettings
}
