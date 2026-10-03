import { ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import type { PoCGpuMode, PoCInjectInput, PoCLogEntry } from '@shared/types'

/** PoC dev harness 白名单（stage 04 步骤 1；产品化后随 harness 一起移除） */
export const pocApi = {
  setup: (): Promise<string> => ipcRenderer.invoke(IPC_CHANNELS.pocSetup),
  emulatorStart: (mode: PoCGpuMode): Promise<string> =>
    ipcRenderer.invoke(IPC_CHANNELS.pocEmulatorStart, mode),
  emulatorStop: (): Promise<string> => ipcRenderer.invoke(IPC_CHANNELS.pocEmulatorStop),
  /** main 起流后经 onPacket 持续推送视频包；maxSize>0 时限制流分辨率长边 */
  streamStart: (maxSize: number): Promise<string> =>
    ipcRenderer.invoke(IPC_CHANNELS.pocStreamStart, maxSize),
  stopStream: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.pocStopStream),
  inject: (input: PoCInjectInput): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.pocInject, input),
  report: (report: unknown): Promise<string> => ipcRenderer.invoke(IPC_CHANNELS.pocReport, report),
  teardown: (): Promise<string> => ipcRenderer.invoke(IPC_CHANNELS.pocTeardown),
  onLog: (callback: (entry: PoCLogEntry) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, entry: PoCLogEntry): void => {
      callback(entry)
    }
    ipcRenderer.on(IPC_CHANNELS.pocLog, listener)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.pocLog, listener)
    }
  },
  onPacket: (callback: (packet: { type: string; data: Uint8Array }) => void): (() => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      packet: { type: string; data: Uint8Array }
    ): void => {
      callback(packet)
    }
    ipcRenderer.on(IPC_CHANNELS.pocStreamPort, listener)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.pocStreamPort, listener)
    }
  }
}
