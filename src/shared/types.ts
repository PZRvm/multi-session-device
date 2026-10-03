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

/** 运行态不入盘：重启一律回到「停止」，主进程内存持有 */
export type DeviceStatus = 'stopped' | 'running'

export interface Device extends DeviceMeta {
  status: DeviceStatus
}

/** 新建向导第三步的产物——主进程补 id/createdAt/status */
export interface CreateDeviceInput {
  profileId: string
  profileLabel: string
  apiLevel: number
  variant: ImageVariant
  name: string
}

// ---- PoC dev harness 消息（stage 04 步骤 1；步骤 5 产品化后随 harness 一起移除）----

export type PoCGpuMode = 'host' | 'swiftshader_indirect'

/** 归一化坐标（0..1，相对画面尺寸），main 侧按视频分辨率换算设备像素 */
export interface PoCTapInput {
  kind: 'tap'
  x: number
  y: number
}

export interface PoCSwipeInput {
  kind: 'swipe'
  x1: number
  y1: number
  x2: number
  y2: number
  durationMs: number
}

export type PoCInjectInput = PoCTapInput | PoCSwipeInput

export interface PoCLogEntry {
  ts: number
  message: string
}

export interface PoCReport {
  gpuMode: PoCGpuMode
  videoWidth: number
  videoHeight: number
  scrcpyServerVersion: string
  idle: { durationMs: number; frames: number; fps: number }
  interaction: { durationMs: number; frames: number; fps: number; swipes: number }
  latency: {
    samples: number
    timeouts: number
    minMs: number
    medianMs: number
    p95Ms: number
    maxMs: number
  }
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

/** avdmanager 设备画像（向导第一步） */
export interface DeviceProfile {
  id: string
  name: string
}
