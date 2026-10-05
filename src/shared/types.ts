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

/** 系统镜像变体（avdmanager tag 的白名单子集，闭集守卫用） */
export type ImageVariant = 'aosp' | 'google_apis' | 'google_play'

/** 设备元数据——devices.json 持久化的全部字段（stage 03 mock，stage 04 接真数据） */
export interface DeviceMeta {
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
