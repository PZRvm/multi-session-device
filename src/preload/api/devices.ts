import { ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import type {
  CreateDeviceInput,
  CreateDeviceResult,
  DeviceEditSnapshot,
  DeviceSnapshot,
  ExternalDevice,
  ReconcileReport,
  ReconcileResult,
  RuntimeErrorMessage,
  UpdateDeviceInput
} from '@shared/types'

export const devicesApi = {
  list: (): Promise<DeviceSnapshot> => ipcRenderer.invoke(IPC_CHANNELS.devicesList),
  create: (input: CreateDeviceInput): Promise<CreateDeviceResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.devicesCreate, input),
  /** 编辑窗读取配置快照（回填草稿 + 编辑能力 + 指纹；仅绑定该设备的编辑窗） */
  readConfig: (id: string): Promise<DeviceEditSnapshot> =>
    ipcRenderer.invoke(IPC_CHANNELS.devicesReadConfig, { id }),
  /** 编辑窗提交名称/白名单字段差异（写前指纹复验 + 跨文件事务） */
  updateConfig: (input: UpdateDeviceInput): Promise<DeviceSnapshot> =>
    ipcRenderer.invoke(IPC_CHANNELS.devicesUpdateConfig, input),
  rename: (id: string, name: string): Promise<DeviceSnapshot> =>
    ipcRenderer.invoke(IPC_CHANNELS.devicesRename, { id, name }),
  remove: (id: string): Promise<DeviceSnapshot> =>
    ipcRenderer.invoke(IPC_CHANNELS.devicesDelete, { id }),
  /** 接纳即返回（不等待 boot 完成），后续状态经 onChanged 推送 */
  start: (id: string): Promise<DeviceSnapshot> =>
    ipcRenderer.invoke(IPC_CHANNELS.devicesStart, { id }),
  stop: (id: string): Promise<DeviceSnapshot> =>
    ipcRenderer.invoke(IPC_CHANNELS.devicesStop, { id }),
  cancelStart: (id: string): Promise<DeviceSnapshot> =>
    ipcRenderer.invoke(IPC_CHANNELS.devicesCancelStart, { id }),
  /** 复制当前登记 serial——受控通道，main 校验运行态后写入剪贴板 */
  copySerial: (id: string): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.devicesCopySerial, { id }),
  /** 人工重查：受控重读元数据 + AVD/镜像只读核验，返回合并快照与本轮报告 */
  reconcile: (): Promise<ReconcileResult> => ipcRenderer.invoke(IPC_CHANNELS.devicesReconcile),
  /** 最近一次对账报告（不触发隐式扫描；无报告返回 null） */
  reconciliationReport: (): Promise<ReconcileReport | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.devicesReconciliationReport),
  /** 确认已展示某签名的异常汇总（迟到签名不消费新异常） */
  acknowledgeReconciliation: (signature: string): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.devicesReconciliationAck, { signature }),
  /** 带代次快照推送订阅，返回解绑函数 */
  onChanged: (callback: (snapshot: DeviceSnapshot) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, snapshot: DeviceSnapshot): void => {
      callback(snapshot)
    }
    ipcRenderer.on(IPC_CHANNELS.devicesChanged, listener)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.devicesChanged, listener)
    }
  },
  /** 后台运行故障（崩溃/停止失败）订阅，返回解绑函数 */
  onRuntimeError: (callback: (message: RuntimeErrorMessage) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, message: RuntimeErrorMessage): void => {
      callback(message)
    }
    ipcRenderer.on(IPC_CHANNELS.devicesRuntimeError, listener)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.devicesRuntimeError, listener)
    }
  },
  // ---- 真机域（plan 2026-10-13-real-device-usb-and-apk-install；仅主窗可用）----
  /** 外部设备快照（main 内存缓存；track-devices-l 跟踪） */
  listExternal: (): Promise<ExternalDevice[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.devicesExternalList),
  /** 外部设备变化订阅（main 侧 diff，变化才推全量），返回解绑函数 */
  onExternalChanged: (callback: (devices: ExternalDevice[]) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, devices: ExternalDevice[]): void => {
      callback(devices)
    }
    ipcRenderer.on(IPC_CHANNELS.devicesExternalChanged, listener)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.devicesExternalChanged, listener)
    }
  }
}
