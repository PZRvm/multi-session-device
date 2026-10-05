/** 应用与原生窗口共用的亮暗选择 */
export type ThemeMode = 'system' | 'light' | 'dark'

/** 原生对话框入参——Electron MessageBoxOptions 的白名单子集 */
export interface DialogOptions {
  title: string
  message: string
  /** 补充说明，可多行（如删除后果清单） */
  detail?: string
  /** 按钮文案，下标即返回值；单按钮 = 提示弹窗，多按钮 = 确认框（最多 3 个） */
  buttons: string[]
  /** 取消/Esc 对应的按钮下标 */
  cancelId?: number
}

export interface DialogResult {
  /** 被点按钮的下标；Esc/关闭返回 cancelId */
  response: number
  checkboxChecked: boolean
}

/** 系统镜像变体（avdmanager tag 的白名单子集，闭集守卫用；v1 store 兼容读取） */
export type ImageVariant = 'aosp' | 'google_apis' | 'google_play'

/**
 * 附加设置封闭类型（plan 设计 4）：不开放任意 config 键、命令字符串或宿主路径。
 * 枚举与边界由批次 6 的能力接口（WizardCapabilities）按所装 emulator 锁定，
 * 此处只定型字段与已验证枚举。
 */
export interface DeviceAdvancedSettings {
  /** 机型皮肤（SDK 自带 id 或导入皮肤 id）；null = 通用外框 */
  skinRef: string | null
  /** 前/后摄像头：none / emulated / virtualScene / webcam（资源 id 由能力接口枚举） */
  frontCamera: CameraConfig
  rearCamera: CameraConfig
  networkSpeed: NetworkPreset | null
  networkLatency: NetworkPreset | null
  /** 初始朝向；null = 跟随画像默认 */
  orientation: 'portrait' | 'landscape' | null
  /** Cold = 首启不加载快照；Quick 通过稳定性门槛前不可选（批次 9） */
  bootMode: 'cold' | 'quick'
  internalStorageMiB: number
  cpuCores: number
  graphics: GpuMode
  ramMiB: number
  vmHeapMiB: number
  /** Optimal 解析为选中包 ABI；显式仅 arm64（本期） */
  preferredAbi: 'optimal' | 'arm64-v8a'
}

export interface CameraConfig {
  mode: 'none' | 'emulated' | 'virtualScene' | 'webcam'
  /** webcam 模式下的宿主摄像头 id（webcam0…，能力接口枚举） */
  deviceId: string | null
}

/** -netspeed / -netdelay 的预设枚举（emulator 36.1.9 -help 实测，fixtures README） */
export type NetworkPreset =
  'gsm' | 'hscsd' | 'gprs' | 'umts' | 'edge' | 'hsdpa' | 'lte' | 'evdo' | '5g' | 'full' | 'none'

/** -gpu 模式（emulator 36.1.9 -help 实测；无 host_indirect） */
export type GpuMode =
  'auto' | 'auto-no-window' | 'host' | 'swiftshader_indirect' | 'angle_indirect' | 'guest'

/** 屏幕摘要（列表展示用，完整数据在画像元数据里） */
export interface DeviceScreenSummary {
  widthPx: number | null
  heightPx: number | null
  diagonalInches: number | null
}

/**
 * 设备元数据 v2——devices.json 持久化的全部字段（plan 设计 5）。
 * 精确镜像身份贯穿创建与读取；advancedSettings/skinRef 由批次 6/7 填充。
 */
export interface DeviceMeta {
  id: string
  name: string
  profileId: string
  profileLabel: string
  /** 完整包名（system-images;<平台>;<tag>;<abi>）——唯一镜像身份 */
  imagePackageName: string
  /** API 显示值（"36" / "36.1"），从镜像身份派生后冗余存储 */
  apiDisplay: string | null
  /** 画像形态；v1 兼容读出为 'unknown'（旧记录只有手机/平板画像，不硬猜） */
  formFactor: DeviceFormFactor
  screenSummary: DeviceScreenSummary | null
  /** 归一化附加设置；null = 未配置，运行走 legacy 默认（Cold/host） */
  advancedSettings: DeviceAdvancedSettings | null
  /**
   * 上次正常停止且快照核验通过的时间（epoch ms）；null = 从未有效快照。
   * Quick Boot 恢复的前置条件（plan 设计 8）——设置变化后由 main 重置。
   */
  snapshotReadyAt: number | null
  createdAt: number
}

/** v1 store 记录形状（只用于合法旧文件的兼容读取与派生） */
export interface DeviceMetaLegacy {
  id: string
  name: string
  profileId: string
  profileLabel: string
  apiLevel: number
  variant: ImageVariant
  createdAt: number
}

/**
 * 运行态不入盘：重启一律回到「停止」，主进程内存持有。
 * creating/deleting 是创建/删除事务的临时态；starting 可取消；stopping 是停止/取消/
 * 异常回收共用的过渡态，停止失败时保留在 stopping 并附 lastError 等待重试。
 */
export type DeviceStatus = 'creating' | 'stopped' | 'starting' | 'running' | 'stopping' | 'deleting'

/** 运行故障原因（不入盘，随快照发布；code 是闭集外仍可扩展的字符串） */
export interface DeviceError {
  code: string
  message: string
}

export interface Device extends DeviceMeta {
  status: DeviceStatus
  /** 最近一次运行/命令失败；下次命令成功接纳时清除 */
  lastError?: DeviceError
  /** 运行实例的 adb serial（emulator-<console 端口>）；starting/running 发布，停止清空 */
  serial?: string
  /** 本次启动代次——取消与迟到 boot/退出回调用它防串台 */
  runId?: string
  /** 本次启动时间（快照核验基准）；运行态不入盘 */
  startedAt?: number
}

/** 带代次的全量快照：list、命令响应与 changed 推送共用；renderer 忽略较旧 revision */
export interface DeviceSnapshot {
  revision: number
  devices: Device[]
}

/** 创建命令结果：按明确 id 选中新设备，避免并发创建时取数组尾部选错 */
export interface CreateDeviceResult {
  createdId: string
  snapshot: DeviceSnapshot
}

/** 后台运行故障推送（main → 主窗）：renderer 按 eventId 去重弹原生 dialog */
export interface RuntimeErrorMessage {
  eventId: string
  deviceId: string
  runId?: string
  code: string
  message: string
}

/** 新建向导配置页的产物——主进程补 id/createdAt/status；镜像身份以精确包名为准 */
export interface CreateDeviceInput {
  profileId: string
  profileLabel: string
  /** 完整包名（system-images;<平台>;<tag>;<abi>），创建前由 main 从可信目录核验 */
  imagePackageName: string
  name: string
  /** 归一化附加设置；null = 未配置（沿用 legacy 默认路径） */
  advancedSettings: DeviceAdvancedSettings | null
}

/** 单个设置字段的能力描述（枚举/范围/禁用原因） */
export interface SettingFieldCapability {
  /** 字段禁用时的中文原因；null = 可用 */
  disabledReason: string | null
  /** 数值字段边界（MiB / 核数）；null = 非数值字段 */
  min: number | null
  max: number | null
  step: number | null
}

/**
 * 向导能力（sdk:wizard-capabilities 返回）：按 SDK/工具版本、宿主、
 * profileId/imagePackageName 生成 defaults 与字段能力。上下文标识用于
 * 陈旧判定——切换画像/镜像/工具升级后 capabilityContextId 变化即失效。
 */
export interface WizardCapabilities {
  /** 能力上下文标识（画像 id + 包名 + emulator 版本指纹） */
  capabilityContextId: string
  /** 所装 emulator 版本（package.xml 读取）；null = 未安装/未知 */
  emulatorVersion: string | null
  defaults: DeviceAdvancedSettings
  fields: Record<string, SettingFieldCapability>
  /** Quick Boot 开放状态：门槛未过（批次 9）前禁用并说明 */
  quickBootAvailable: boolean
  quickBootDisabledReason: string | null
  /** 本地摄像头枚举（批次 8 真实取景链路；本批次仅 emulated/none 可选） */
  webcamDeviceIds: string[]
  /** 可选皮肤 id（批次 7 接入；空 = 暂无） */
  skinIds: string[]
}

/** 皮肤清单条目（main → renderer 只读摘要；renderer 不拿任意路径读取能力） */
export interface DeviceSkinSummary {
  id: string
  name: string
  skinRef: string
  source: 'sdk' | 'imported' | 'downloaded'
  portrait: {
    frameWidth: number
    frameHeight: number
    screenWidth: number
    screenHeight: number
  }
}

/** 皮肤下载进度推送 */
export interface SdkSkinProgress {
  skinName: string
  percent: number
}

// ---- 投屏与操控域（stage 04 步骤 5；scrcpy 3.3.3 + H.264 + adb forward 裸 TCP）----

export interface ScreenFormat {
  codec: 'h264'
  width: number
  height: number
}

export type ScreenStatus = 'connecting' | 'ready' | 'error' | 'closed'

/** 所有 screen 消息共用的归属字段——main 按 token/generation/代次守卫，旧归属一律拒收 */
export interface ScreenEnvelope {
  deviceId: string
  runId: string
  streamId: string
  generation: number
  /** renderer 视图代次（renderer 生成、activate 时登记） */
  viewToken: string
}

export interface ScreenStateMessage extends ScreenEnvelope {
  status: ScreenStatus
  format?: ScreenFormat
  error?: string
}

export type ScreenPacketType = 'configuration' | 'data'

export interface ScreenPacketMessage extends ScreenEnvelope {
  /** 会话内单调递增；renderer 据此发现丢弃产生的空洞并重同步 */
  seq: number
  type: ScreenPacketType
  /** 编码器 PTS（µs） */
  pts?: number
  keyframe?: boolean
  data: Uint8Array
}

export interface ScreenAckMessage {
  viewToken: string
  generation: number
  throughSeq: number
}

/** 工具条物理键（main 白名单映射 Android keycode，成对 Down/Up） */
export type ScreenToolbarButton =
  'back' | 'home' | 'overview' | 'power' | 'volume-up' | 'volume-down'

/** 画布键盘白名单（renderer 传逻辑名，main 映射 keycode） */
export type ScreenKeycodeName =
  | 'enter'
  | 'backspace'
  | 'tab'
  | 'arrow-up'
  | 'arrow-down'
  | 'arrow-left'
  | 'arrow-right'
  | 'escape'

export type ScreenInput =
  | {
      kind: 'touch'
      action: 'down' | 'move' | 'up' | 'cancel'
      /** renderer 稳定指针 id（0/1） */
      pointerId: number
      /** 已归一化坐标（0..1） */
      x: number
      y: number
      pressure: number
    }
  | { kind: 'button'; button: ScreenToolbarButton }
  | { kind: 'keycode'; key: ScreenKeycodeName; down: boolean }
  /** 普通文本（injectText 分段）；ime=true 为 IME 组合提交（走设备剪贴板+粘贴） */
  | { kind: 'text'; text: string; ime: boolean }
  | { kind: 'rotate' }
  | { kind: 'release-all' }

export interface ScreenInputRequest extends ScreenEnvelope {
  /** renderer 声明的画面尺寸（main 校验与当前 generation 一致后才换算像素） */
  width: number
  height: number
  input: ScreenInput
}

// ---- SDK 域（stage 04 步骤 2/3 共用）----

export type SdkComponentName = 'licenses' | 'jre' | 'cmdline-tools' | 'platform-tools' | 'emulator'

export interface SdkComponentStatus {
  present: boolean
  version?: string
}

/** SDK 根四件套 + 许可状态（detectSdk 快照，renderer 镜像展示用） */
export interface SdkSnapshot {
  root: string
  jre: SdkComponentStatus
  cmdlineTools: SdkComponentStatus
  platformTools: SdkComponentStatus
  emulator: SdkComponentStatus
  licensed: boolean
}

export interface SdkProgress {
  stage: SdkComponentName | 'done'
  percent?: number
  message: string
}

/** 镜像下载进度（sdkmanager 跑包） */
export interface SdkImageProgress {
  packageName: string
  percent: number
  message: string
}

/**
 * 结构化 API 版本——逐段比较，绝不转浮点（"36.1"、"35x" 都是真实平台段；
 * 35x 表示 android-35-ext15 的扩展平台）。平台目录段、API 显示值与 SDK extension
 * 分别存储（plan 2026-10-05-emulator-wizard 设计 2）。
 */
export interface ImageApiVersion {
  /** 包名平台段原文：android-36.1 / android-35-ext15 / android-canary-20260909 */
  platformSegment: string
  major: number | null
  minor: number | null
  /** Preview / canary 代号（CANARY、Baklava）；正式版 null */
  codename: string | null
  /** SDK extension level（manifest extension-level / 本地 ExtensionLevel） */
  extensionLevel: number | null
  /** base-extension 标记（minor SDK release） */
  baseExtension: boolean | null
}

/** 镜像服务类别（type-details tags 推导；多标签并存如 automotive + google_apis） */
export type ImageService = 'aosp' | 'google_apis' | 'google_play' | 'wear' | 'tv' | 'automotive'

export interface ImageRevision {
  major: number
  minor: number | null
  micro: number | null
}

/**
 * 系统镜像条目：packageName 是唯一选择/下载/创建键。同 API/服务的 16KB、
 * 扩展或不同 revision 不合并；远端与本地按包身份合并并保留版本差异。
 */
export interface ImageEntry {
  packageName: string
  displayName: string
  api: ImageApiVersion
  services: ImageService[]
  /** 特征标签原文（page_size_16kb / ai_glasses_compatible 等），不参与服务判定 */
  featureTags: string[]
  abi: string
  channel: number | null
  revision: ImageRevision | null
  /** 下载体积（字节，manifest archives.complete.size；本地-only 为 null） */
  sizeBytes: number | null
  /** 完整安装：package.xml + source.properties + system.img 核验通过 */
  installed: boolean
  /** remote+local = 远端清单与本地合并；local-only = 仅本地存在（离线/已下架） */
  source: 'remote+local' | 'local-only'
}

/** sdk:images 的返回：部分源失败保留其余来源并给警告；远端全挂时声明离线 */
export interface ImageCatalogResult {
  images: ImageEntry[]
  sourceWarnings: string[]
  offline: boolean
  fetchedAt: number
}

/** 画像形态（官方分类规则：特殊 tag 优先，无 tag 按屏幕尺寸判定；unknown = 数据不足不硬猜） */
export type DeviceFormFactor =
  'phone' | 'tablet' | 'wear' | 'desktop' | 'tv' | 'automotive' | 'unknown'

/** 画像屏幕元数据（官方 XML；缺失字段 null，不伪造） */
export interface DeviceScreenInfo {
  widthPx: number | null
  heightPx: number | null
  diagonalInches: number | null
  /** 逻辑 dpi：pixel-density 符号或数值，不以 xdpi/ydpi 替代 */
  logicalDpi: number | null
  /**
   * 圆屏与否。官方 XML 无显式标记，仅以 id 命名约定（*_round / *_square）区分，
   * 因此只在能从 id 判定时给 true/false，其余 null。
   */
  round: boolean | null
}

/** 设备画像：官方画像 XML 元数据 + avdmanager 可创建关联（plan 2026-10-05-emulator-wizard） */
export interface DeviceProfile {
  id: string
  name: string
  manufacturer: string | null
  /** 原始 tag id（android-wear / android-tv / android-automotive-playstore 等；空 = 无 tag） */
  tagIds: string[]
  formFactor: DeviceFormFactor
  screen: DeviceScreenInfo
  foldable: boolean
  /** 软件支持范围（XML api-level「14-」语义：min=14、max=null；-1 → null/null） */
  apiMin: number | null
  apiMax: number | null
  playSupported: boolean | null
  /** 官方 XML 与 avdmanager 输出均无弃用信号，当前恒 false；有信号源后接入 */
  deprecated: boolean
  hasFrontCamera: boolean | null
  hasBackCamera: boolean | null
  /** 官方 XML 硬件默认 RAM（按 unit 归一化到 MiB） */
  ramMiB: number | null
  /** avdmanager 当前可按此画像创建（id 出现在其输出中） */
  creatable: boolean
}
