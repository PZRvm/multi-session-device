import { ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import type { CreateDeviceInput, Device } from '@shared/types'

export const devicesApi = {
  list: (): Promise<Device[]> => ipcRenderer.invoke(IPC_CHANNELS.devicesList),
  create: (input: CreateDeviceInput): Promise<Device[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.devicesCreate, input),
  rename: (id: string, name: string): Promise<Device[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.devicesRename, { id, name }),
  remove: (id: string): Promise<Device[]> => ipcRenderer.invoke(IPC_CHANNELS.devicesDelete, { id }),
  setRunning: (id: string, running: boolean): Promise<Device[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.devicesSetRunning, { id, running }),
  /** 主进程 changed 推送订阅，返回解绑函数 */
  onChanged: (callback: (devices: Device[]) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, devices: Device[]): void => {
      callback(devices)
    }
    ipcRenderer.on(IPC_CHANNELS.devicesChanged, listener)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.devicesChanged, listener)
    }
  }
}
