import { ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import type {
  ProcessorAuth,
  ProcessorFrame,
  ProcessorInit,
  ProcessorPacket,
  RecordingCommand,
  RecordingSnapshot
} from '@shared/recording'
export const recordingApi = {
  resetPrompts: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.recordingResetPrompts),
  start: (deviceId: string): Promise<RecordingSnapshot> =>
    ipcRenderer.invoke(IPC_CHANNELS.recordingStart, { deviceId }),
  command: (taskId: string, command: RecordingCommand): Promise<RecordingSnapshot> =>
    ipcRenderer.invoke(IPC_CHANNELS.recordingCommand, { taskId, command }),
  get: (): Promise<RecordingSnapshot> => ipcRenderer.invoke(IPC_CHANNELS.recordingGet),
  onChanged: (listener: (snapshot: RecordingSnapshot) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: RecordingSnapshot): void =>
      listener(snapshot)
    ipcRenderer.on(IPC_CHANNELS.recordingChanged, handler)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.recordingChanged, handler)
    }
  }
}
export const recordingProcessorApi = {
  ready: (): Promise<ProcessorInit> => ipcRenderer.invoke(IPC_CHANNELS.recordingProcessorReady),
  size: (auth: ProcessorAuth, width: number, height: number): Promise<boolean> =>
    ipcRenderer.invoke(IPC_CHANNELS.recordingProcessorSize, { ...auth, width, height }),
  pull: (auth: ProcessorAuth, seq: number): Promise<ProcessorFrame[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.recordingProcessorPull, { ...auth, seq }),
  push: (auth: ProcessorAuth, seq: number, packet: ProcessorPacket): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.recordingProcessorPush, { ...auth, seq, packet }),
  complete: (auth: ProcessorAuth): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.recordingProcessorComplete, auth),
  failed: (auth: ProcessorAuth, error: string): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.recordingProcessorFailed, { ...auth, error })
}
