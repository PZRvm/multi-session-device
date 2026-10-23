import type { SettingsLocale } from './i18n/locale'
import type { ThemeSystemId } from './themeSystems'

/** 应用与原生窗口共用的亮暗选择 */
export type ThemeMode = 'system' | 'light' | 'dark'

/** 主题选择快照——theme.json 落盘与 IPC 传输的载荷（色系 + 亮暗三态） */
export interface ThemeSelection {
  systemId: ThemeSystemId
  mode: ThemeMode
}

/** boot 同步下发的主题初值：快照 + fresh（本次启动 theme.json 是否不存在，legacy 收编判定） */
export interface ThemeInitialState extends ThemeSelection {
  fresh: boolean
}

/** 语言选择快照——locale.json 落盘与 IPC 传输的载荷（单字段对象：未来加字段不破协议） */
export interface LocaleSelection {
  locale: SettingsLocale
}

/** boot 同步下发的语言初值：与主题初值对齐的命名；语言无 legacy 存量，无 fresh 附加字段 */
export type LocaleInitialState = LocaleSelection

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
  /** 稳定宿主身份；旧记录缺省保持 webcamN 兼容 */
  hostDeviceId?: string
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
  /** 用户明确请求恢复默认挖孔；下次冷启动执行，成功后移除此标记 */
  cutoutResetPending?: boolean
  /**
   * 设备出身（持久）：创建时的 SDK 来源桶。缺席（共享模式出现前的存量）读取时
   * 视作 app-owned——不迁移、不改 store 版本（formFactor v1 兼容同款）。
   * 只作展示与指路文案，零参与启动判定（能否启动唯一事实源是实时镜像核验）。
   */
  imageSourceOrigin?: 'app-owned' | 'shared-studio'
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
 * 设备外观类别：投屏外框的展示提示（手机/平板/未知中性）。由 main 从 SDK 画像
 * 元数据按 profileId 派生进内存快照，不入盘、不进 AVD 硬件配置；缺省按 generic
 * 兜底，旧快照无此字段亦兼容。
 */
export type DeviceFrameKind = 'phone' | 'tablet' | 'generic'

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

// ---- 持久化对账域（plan 2026-10-05-avd-reconciliation）----

/** 设备文件健康：checking = 检查进行中（creating 行/启动前即时核验）；其余为归因后的稳定结果 */
export type DeviceAvailabilityState =
  'checking' | 'valid' | 'missing' | 'broken' | 'inaccessible' | 'unsafe'

export type DeviceHealthComponent = 'avd' | 'image'

/** 单条健康原因：severity=error 阻断启动；warning 只提示（如镜像身份与元数据不一致） */
export interface DeviceHealthIssue {
  component: DeviceHealthComponent
  code: string
  message: string
  severity: 'error' | 'warning'
}

/** 文件健康（内存态、不入盘）：独立于 status/lastError，运行中设备异常不清画面只挂原因 */
export interface DeviceAvailability {
  state: DeviceAvailabilityState
  issues: DeviceHealthIssue[]
  checkedAt: number | null
}

/** 元数据库健康：ok = 可写；read-only = 条目级异常冻结写入（行可读可启动）；error = 无可信列表 */
export type StoreHealthState = 'ok' | 'read-only' | 'error'

export interface StoreHealthIssue {
  code: string
  /** 坏条目在 devices 数组中的原始下标（条目级问题携带） */
  entryIndex?: number
  message: string
}

export interface StoreHealth {
  state: StoreHealthState
  issues: StoreHealthIssue[]
}

/** avdHome 顶层的孤立/异常关联文件组：只列出与说明，不提供自动清理——
 *  path 供「在 Finder 中显示」（用户自行处置） */
export interface ReconcileOrphanEntry {
  /** 文件基名（UUID 形态；非 UUID 名只计入数量不进此表） */
  id: string
  kind: 'orphan' | 'metadata-linked'
  detail: string
  /** 组内主文件绝对路径（.ini 优先，缺则 .avd 目录）；仅本机展示用 */
  path: string
}

/** 一轮对账的完整报告：详情经 devices:reconciliation-report 拉取，随快照只带摘要 */
export interface ReconcileReport {
  /** 对应发布此报告时的列表代次 */
  revision: number
  /** 异常内容签名（null = 无异常）；时间戳不入签名，供提示去重 */
  signature: string | null
  checkedAt: number
  storeHealth: StoreHealth
  deviceIssues: Array<{ id: string; name: string; availability: DeviceAvailability }>
  orphanEntries: ReconcileOrphanEntry[]
  /** 非 UUID 命名的 .ini/.avd 形态文件数量（不拼接其路径） */
  unrecognizedCount: number
  /** creating/deleting/回滚中暂缓判断的设备 id */
  pendingIds: string[]
  scanError: string | null
  /** 该签名异常尚待主窗提示（已确认/已展示过的不重复弹） */
  pendingNotification: boolean
}

/** 快照内嵌的对账摘要：renderer 据此驱动汇总条与提示，不携带报告详情 */
export interface ReconciliationSummary {
  signature: string | null
  /**
   * 全量口径的文件异常设备数（review P3-2 注）：主窗汇总条已改视图口径（经
   * DeviceHealthNotice.unavailableCount prop 传入），此字段供主进程侧与详情
   * 报告链路使用——渲染层勿再直读它做主窗展示。
   */
  unavailableCount: number
  /** 本轮扫描自身失败（null = 无）；非空时结果不可信，通知不适用视图静默（P3-4） */
  scanError?: string | null
  orphanCount: number
  storeState: StoreHealthState
  pendingNotification: boolean
}

export interface Device extends DeviceMeta {
  /** 外观提示（派生、可缺席）：缺省 generic，renderer 侧不落盘不迁移 */
  frameKind?: DeviceFrameKind
  /** 文件健康（内存派生、不入盘）；load 后稳定设备必有结果，creating 行为 checking */
  availability?: DeviceAvailability
  status: DeviceStatus
  /** 最近一次运行/命令失败；下次命令成功接纳时清除 */
  lastError?: DeviceError
  /**
   * 本次启动的摄像头回退说明（仅内存不入盘）：启动仲裁命中冲突或死绑定时，
   * 该槽位以虚拟场景运行；停止/取消/意外退出清除。
   */
  cameraNotice?: string
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
  storeHealth: StoreHealth
  reconciliation: ReconciliationSummary
  /**
   * 组快照时的活动来源桶（出身过滤视图谓词依赖，plan 2026-10-12-device-list-origin-view-filter）。
   * 与 devices 同帧到达，无中间态；boot 侧 restoreSdkSource 先于首帧快照。
   */
  sourceBucket: 'app-owned' | 'shared-studio'
}

/** 人工重查（devices:reconcile）结果：合并后的快照与本轮报告 */
export interface ReconcileResult {
  snapshot: DeviceSnapshot
  report: ReconcileReport
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
  cameraSnapshot?: CameraSnapshot
  recommendedSkin?: { name: string; skinRef: string | null } | null
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
  } | null
  landscape?: DeviceSkinSummary['portrait']
}

/** 皮肤下载进度推送 */
export interface SdkSkinProgress {
  skinName: string
  percent: number
}

// ---- 设备配置编辑域（plan 2026-10-08-device-config-edit）----

/** 向导窗口上下文：窗口创建时固定 create/edit，不静默切换已有窗口 */
export type WizardContext = { kind: 'create' } | { kind: 'edit'; deviceId: string }

/** 编辑回填字段的取值来源：界面据此说明，不假称实际生效值 */
export type DeviceEditFieldSource = 'metadata' | 'config' | 'schema' | 'legacy' | 'unknown'

/** 单个回填字段的说明（自动值/未知值/外部不一致时的中文提示） */
export interface DeviceEditFieldNote {
  source: DeviceEditFieldSource
  /** null = 无异常；有值时编辑页逐字段提示 */
  warning: string | null
}

/** 内部存储只读展示：已有设备一律不可改，值未知时 valueMiB=null（不以默认值冒充） */
export interface DeviceEditStorageInfo {
  valueMiB: number | null
  note: string
}

/** 可参与文件偏差同步的设置；存储、ABI 与仅运行参数不在此列。 */
export type DeviceConfigField =
  | 'cpuCores'
  | 'ramMiB'
  | 'vmHeapMiB'
  | 'graphics'
  | 'frontCamera'
  | 'rearCamera'
  | 'orientation'
  | 'skinRef'

export interface DeviceConfigMismatch {
  field: DeviceConfigField
  actualLabel: string
  /** 单字段的类型化配置值；null 表示无法可靠识别，不能采用。 */
  actualSettings: UpdateDeviceSettings | null
}

/** 编辑快照（devices:read-config）：回填草稿 + 固定身份 + 能力 + 指纹；只读不落盘 */
export interface DeviceEditSnapshot {
  deviceId: string
  /** 固定身份（机型/API/镜像只读展示，不接受修改） */
  identity: {
    name: string
    profileId: string
    profileLabel: string
    imagePackageName: string
    apiDisplay: string | null
    formFactor: DeviceFormFactor
  }
  /** 回填草稿（编辑表单初值）；内部存储字段是只读占位，不进入更新提交 */
  settings: DeviceAdvancedSettings | null
  /** 旧配置无法无损表达时仅允许改名，不生成默认附加设置 */
  settingsBlockedReason?: string | null
  /** 字段来源与警告（键 = DeviceAdvancedSettings 字段名） */
  fieldNotes: Record<string, DeviceEditFieldNote>
  configMismatches?: DeviceConfigMismatch[]
  internalStorage: DeviceEditStorageInfo
  /** 按已存画像×镜像×emulator 生成的编辑能力（与创建同规则） */
  capabilities: WizardCapabilities
  /** 文件/事务/设备库保存阻断；运行态由 status 独立表达 */
  saveBlockedReason: string | null
  /** 运行态独立于文件/事务阻断；设备停止后实时解除 */
  status?: DeviceStatus
  /** 原配置字节 + 设备持久字段指纹；保存时带回复验（写前 CAS） */
  fingerprint: string
}

/** 可写字段差异闭集——内部存储与应用 ABI 恒不可写，伪造载荷直接拒绝 */
export interface UpdateDeviceSettings {
  skinRef?: string | null
  frontCamera?: CameraConfig
  rearCamera?: CameraConfig
  networkSpeed?: NetworkPreset | null
  networkLatency?: NetworkPreset | null
  orientation?: 'portrait' | 'landscape' | null
  bootMode?: 'cold' | 'quick'
  cpuCores?: number
  graphics?: GpuMode
  ramMiB?: number
  vmHeapMiB?: number
}

/** 配置更新命令：仅名称与白名单字段差异；画像/镜像/存储/ABI/任意 config 键不接受 */
export interface UpdateDeviceInput {
  id: string
  fingerprint: string
  name?: string
  advancedSettings?: UpdateDeviceSettings
  /** 显式选择恢复 Android 默认挖孔，不从换肤动作推断用户意图 */
  resetDisplayCutout?: boolean
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
  /** 接收端依赖断裂或解码拥堵：请求丢弃旧链，从新配置与关键帧重建。 */
  resync?: true
}

/** 工具条物理键（main 白名单映射 Android keycode，成对 Down/Up） */
export type ScreenToolbarButton = 'back' | 'home' | 'overview' | 'volume-up' | 'volume-down'

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
  | { kind: 'text'; text: string; ime: boolean; source?: 'paste' | 'composition' }
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

// ---- SDK 来源域（plan 2026-10-11-sdk-source-switching）----

/** SDK 来源三态：托管（默认，应用数据目录）/ 共享 Studio SDK（只读）/ 自选路径（应用可写根） */
export type SdkSourceMode = 'managed' | 'custom' | 'shared-studio'

/** Android Studio / SDK 检测结果（检测链逐级核验；studioFound 驱动共享选项禁用态） */
export interface StudioSdkDetection {
  /** Studio 本体是否在场（/Applications 扫描 + mdfind 兜底） */
  studioFound: boolean
  studioAppPath: string | null
  /** Studio 自带 JRE 家目录（jbr/Contents/Home；bin/java 在场才算）——共享模式 Java 来源 */
  jbrHome: string | null
  /** 已核验 SDK 候选路径；null = 四级链（配置文件→env→默认目录→PATH adb）均未定位 */
  sdkCandidate: string | null
  candidateSource: 'studio-config' | 'env' | 'default-dir' | 'path-adb' | null
  /** 平台默认 SDK 路径（自选路径预填用） */
  defaultSdkPath: string
}

/** 共享模式下的保留应用根（非活动、有可识别 SDK 内容；清除入口数据源） */
export interface SdkRetainedRoot {
  root: string
  bytes: number
  /** config.ini 镜像引用仍指向该根的设备数（清除警告口径） */
  boundDevices: number
}

/** sdk:source-get 快照：来源态 + 三根 + 检测缓存（读缓存不触发扫描） */
export interface SdkSourceSnapshot {
  source: SdkSourceMode
  managedRoot: string
  customPath: string | null
  sharedPath: string | null
  /** 应用 avdHome（杀软白名单建议卡片展示用；main 侧单源 avdHomePath()） */
  avdHome: string
  detection: StudioSdkDetection | null
  /** 未收尾迁移的 journal 视图（崩溃恢复横幅用）；null = 无在途/中断迁移 */
  migration: SdkMigrationView | null
  /** journal 文件损坏（在但不可解析）：半迁移状态须拦切换，横幅只提供回滚 */
  journalCorrupt: boolean
  /** 共享模式下的保留应用根清单（非共享态按不变量为空数组） */
  retainedRoots: SdkRetainedRoot[]
}

/** sdk:source-set 矩阵判定结果（direct 分支已执行并返回新快照） */
export type SdkSourceSwitchEvaluation =
  | { action: 'direct'; snapshot: SdkSourceSnapshot }
  | {
      action: 'needs-migration'
      fromRoot: string
      toRoot: string
      bytes: number
      boundDevices: number
    }
  | {
      action: 'needs-choice'
      targetRoot: string
      targetBytes: number
      loserRoot: string
      loserBytes: number
      loserBoundDevices: number
    }
  | {
      action: 'rejected'
      code:
        | 'no-change'
        | 'running-sessions'
        | 'journal-pending'
        | 'busy'
        | 'studio-not-found'
        | 'studio-sdk-not-located'
        | 'target-junk'
        | 'custom-path-required'
        | 'studio-path-use-shared'
    }

// ---- SDK 迁移域（plan 2026-10-11-sdk-source-switching §3）----

/** 迁移 journal 的顶层条目（每完成一条落盘） */
export interface SdkMigrationEntry {
  name: string
  bytes: number
  files: number
  done: boolean
}

/** userData/sdk-migration.json 载荷：逐条目记账，崩溃后据此续跑或回滚 */
export interface SdkMigrationJournalFile {
  version: 1
  fromRoot: string
  toRoot: string
  targetSource: 'managed' | 'custom'
  /** 迁移替换分支：目标原有内容是否已删（恢复不重复删） */
  targetCleared: boolean
  entries: SdkMigrationEntry[]
  phase: 'scan' | 'moving' | 'relink' | 'done' | 'failed'
  movedBytes: number
  totalBytes: number
  error?: string
}

/** renderer 可见的迁移视图（sdk:source-get 附带；进度经 sdk:migrate-progress 推送） */
export interface SdkMigrationView {
  fromRoot: string
  toRoot: string
  targetSource: 'managed' | 'custom'
  phase: SdkMigrationJournalFile['phase']
  doneEntries: number
  totalEntries: number
  movedBytes: number
  totalBytes: number
}

/** 迁移进度事件（100ms 节流推送；复刻 sdk:progress 形态） */
export interface SdkMigrationProgress {
  phase: 'scan' | 'moving' | 'relink' | 'cleanup' | 'done' | 'failed' | 'cancelled'
  percent: number
  movedBytes: number
  totalBytes: number
  currentEntry: string | null
  error?: string
}

/** 卸载终态广播（main → renderer）：完成（error 空）或失败；发起窗口可能已关 */
export interface SdkUninstallState {
  packageName: string
  /** 失败原因；空/未定义 = 卸载完成 */
  error?: string
}

/** 镜像下载进度（sdkmanager 跑包） */
export interface SdkImageProgress {
  packageName: string
  percent: number
  message: string
  /** 任务失败广播（发起窗口可能已关，广播给在听的窗口）；进度消息里为空 */
  error?: string
  /** 用户显式取消广播——取消不是失败，与 error 互斥 */
  canceled?: true
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
  /** type-details 原始 tag id 列表（直连安装生成 package.xml 用原形回填） */
  tagIds: string[]
  abi: string
  channel: number | null
  revision: ImageRevision | null
  /** 下载体积（字节，manifest archives.complete.size；本地-only 为 null） */
  sizeBytes: number | null
  /** zip 绝对地址（manifest url 拼 dl.google.com 基址；本地-only 为 null） */
  zipUrl: string | null
  /** manifest sha1 校验值（有值必校验；本地-only 为 null） */
  zipSha1: string | null
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
  /**
   * 镜像清单所属的 SDK 来源（plan 2026-10-12-shared-mode-wizard-installed-only）：
   * 由 sdk:images handler 按 sdk.json 填充，renderer 据此做共享态收窄；catalog
   * 模块本身模式无关（未填 = undefined，按非共享处理）。
   */
  sdkSource?: SdkSourceMode
  /**
   * 当前进行中的镜像下载任务（main 实时快照；null = 无）。向导重开时由此
   * 恢复下载状态——关闭向导不取消后台下载（plan 设计 3/9），后续进度走事件流。
   */
  activeDownload: { packageName: string; percent: number } | null
  /**
   * 当前进行中的卸载任务（同上口径）：重开向导由 spinner 恢复渲染，
   * 结束信号走 sdk:uninstall-state 广播。
   */
  activeUninstall: { packageName: string } | null
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

/** 宿主摄像头枚举与权限诊断（不打开取景） */
export interface HostWebcam {
  id: string
  deviceLabel: string
  name?: string
}
export interface CameraSnapshot {
  permission: 'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown'
  devices: HostWebcam[]
  error: string | null
}
export interface SkinImagePart {
  file: string
  x: number
  y: number
  rotation: number
}
export interface DeviceSkinOrientation {
  frameWidth: number
  frameHeight: number
  screenX: number | null
  screenY: number | null
  screenWidth: number
  screenHeight: number
  rotation: number | null
  backgrounds?: SkinImagePart[]
  /** 屏幕大小的透明前景，可遮住圆角及摄像头挖孔 */
  foregroundMask?: string
}
export interface DeviceSkinPresentation {
  name: string
  portrait: DeviceSkinOrientation | null
  landscape: DeviceSkinOrientation | null
  images: Array<{ file: string; url: string }>
}

// ---- 截屏域（plan 2026-10-10-screenshot-clipboard-save）----
/** capture 结果：图像本体已由主进程写系统剪贴板；base64 只供缩略图展示 */
export interface ScreenshotCaptureResult {
  pngBase64: string
  width: number
  height: number
}

/** save 结果：写入系统下载目录的文件名（含扩展名，不含目录） */
export interface ScreenshotSaveResult {
  fileName: string
}

// ---- APK 安装域（plan 2026-10-10-drag-apk-install）----

/** 拖拽安装结果（判别联合）：安装失败是「结果」不是「错误」——
 *  「仍要安装」重试需要机器可读标记，不能靠匹配文案 */
export type ApkInstallOutcome =
  { ok: true; fileName: string } | { ok: false; message: string; canBypassLowTargetSdk: boolean }

// ---- 真机域（plan 2026-10-13-real-device-usb-and-apk-install；stage06 第一批）----

/** 外部物理设备（USB / 无线）：id 即 serial（稳定唯一）；纯内存跟踪，不进 DeviceSnapshot */
export interface ExternalDevice {
  /** 与 serial 同值（renderer 以 id 键控画布与安装态） */
  id: string
  serial: string
  /** serial 含 ':' 即无线（ip:port 形态） */
  transport: 'usb' | 'wireless'
  state: 'device' | 'unauthorized' | 'offline'
  /** 长格式 model= 属性；短格式回退或属性缺席时为 null */
  model: string | null
}

// ---- 真机无线域（plan 2026-10-15-real-device-wireless；无状态：不存任何设备记录）----

/** 无线扫描候选（scanWireless 两源合并：mDNS 服务 + 本网段 5555 探活） */
export interface WirelessCandidate {
  /** mdns-connect = 可直连的官方无线调试服务；mdns-pairing = 配对服务；subnet-scan = 网段探活命中（无名字） */
  source: 'mdns-connect' | 'mdns-pairing' | 'subnet-scan'
  /** mDNS 实例名（可含空格）；网段扫描为 null，连上后 track 的 model 自然补全 */
  name: string | null
  host: string
  port: number
}

export interface WirelessConnectInput {
  host: string
  /** 缺省 5555（裁定钉死：adbd 每机各听各的，可配置零收益） */
  port?: number
}

export interface WirelessPairInput {
  host: string
  /** 配对端口是临时的、≠连接端口（配对成功后回扫描列表选 connect 条目） */
  port: number
  code: string
}

/** 转无线入参：USB 设备的 serial（device 态才可转） */
export interface WirelessPromoteInput {
  serial: string
}

/**
 * 连接/转无线的失败是「结果」不是「错误」（对齐 ApkInstallOutcome）：reason 机器
 * 可读，renderer 映射词条；cross-subnet 携带同网段检查结论（跨网段/TUN 劫持教训）。
 */
export type WirelessConnectOutcome =
  | { ok: true; serial: string }
  | {
      ok: false
      reason:
        | 'unreachable' // TCP 层连不上且同网段（Wi-Fi 断/地址错/省电深睡）
        | 'offline-race' // 重试耗尽仍 offline（adbd 切换窗口异常拉长）
        | 'cross-subnet' // 目标不在本机任何网段——连同一 Wi-Fi，或查代理 TUN
        | 'unauthorized' // RSA 未授权（手机侧弹框未允许）
        | 'no-wifi' // 转无线：手机 wlan0 无地址
        | 'not-found' // 转无线：USB serial 已不在线
      host: string
    }

export type WirelessPairOutcome = { ok: true } | { ok: false; message: string }

// ---- 网络开关域（plan 2026-10-12-network-switch-group）----
/** 开关目标：airplane = 飞行模式（真断网总闸）；wifi/data = 分 radio 场景开关 */
export type NetworkTarget = 'airplane' | 'wifi' | 'data'

/** 设备网络态（以设备读回为唯一事实源；单关任一 radio 不断网——另一路接管） */
export interface NetworkState {
  airplane: boolean
  wifi: boolean
  data: boolean
}

/** networkSet 返回：命令成功后的读回态；读回暂不可用为 null（渲染层等待轮询补推） */
export interface NetworkSetResult {
  state: NetworkState | null
}

/** networkChanged 推送载荷：设备网络态发生变化 */
export interface NetworkChangedMessage {
  deviceId: string
  state: NetworkState
}

// ---- 日志域（plan 2026-10-10-logcat-panel；任意窗口可订阅，与投屏域仅主窗不同）----

export interface LogcatLine {
  /** 会话内单调递增；renderer 据此排序与去重 */
  seq: number
  text: string
}

export interface LogcatBatchMessage {
  deviceId: string
  /** 会话代次：设备重启重建会话后变化；replay 首包到达即整体重置视图 */
  runId: string
  /** 订阅首包 = 环形缓冲尾回放；后续 false 为增量 */
  replay: boolean
  lines: LogcatLine[]
  /** 流控丢弃的最旧行数（>0 时 renderer 标记「已省略 N 行」） */
  dropped: number
}

export interface LogcatAckMessage {
  deviceId: string
  /** 已确认到的最大 seq（含） */
  upToSeq: number
}

/** 窗口上下文窄视图（logcatContext 等返回）：只暴露下拉/订阅所需字段子集，
 *  不含健康详情、镜像、附加设置等全量快照字段（plan 2026-10-10-logcat-panel review P3） */
export interface DeviceRuntimeView {
  id: string
  name: string
  status: Device['status']
  /** running 发布的 adb serial；停止清空 */
  serial?: string
  runId?: string
  /** 来源判别（review P3-2）：'external' = 真机（status 'running' 是「已连接」适配、
   *  runId 省略）；缺省 = AVD（devices.onChanged 派生视图不带本字段） */
  origin?: 'external'
}
