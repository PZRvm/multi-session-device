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
