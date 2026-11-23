import { ipcRenderer } from 'electron'
import { UPDATE_CHANNELS, type UpdateSnapshot, type UpdatesApi } from '@shared/updates'

export const updatesApi: UpdatesApi = {
  getState: () => ipcRenderer.invoke(UPDATE_CHANNELS.state),
  check: () => ipcRenderer.invoke(UPDATE_CHANNELS.check),
  showDetails: () => ipcRenderer.invoke(UPDATE_CHANNELS.details),
  download: () => ipcRenderer.invoke(UPDATE_CHANNELS.download),
  install: () => ipcRenderer.invoke(UPDATE_CHANNELS.install),
  onChanged(callback) {
    const listener = (_event: Electron.IpcRendererEvent, snapshot: UpdateSnapshot): void =>
      callback(snapshot)
    ipcRenderer.on(UPDATE_CHANNELS.changed, listener)
    return () => ipcRenderer.removeListener(UPDATE_CHANNELS.changed, listener)
  }
}
