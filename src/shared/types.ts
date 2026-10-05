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

export interface Device extends DeviceMeta {
  /** 外观提示（派生、可缺席）：缺省 generic，renderer 侧不落盘不迁移 */
  frameKind?: DeviceFrameKind
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

/** 新建向导第三步的产物——主进程补 id/createdAt/status */
export interface CreateDeviceInput {
  profileId: string
  profileLabel: string
  apiLevel: number
  variant: ImageVariant
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

/** 系统镜像清单条目（步骤 3 向导数据；manifest 解析 + SDK 根已装探测） */
export interface ImageEntry {
  /** manifest 包路径，如 system-images;android-36;google_apis;arm64-v8a */
  packageName: string
  apiLevel: number
  variant: ImageVariant
  abi: 'arm64-v8a'
  installed: boolean
  /** 下载体积（字节，manifest archives.complete.size） */
  sizeBytes: number
}

/** 设备画像（avdmanager list device 的手机/平板条目） */
export interface DeviceProfile {
  id: string
  name: string
}
