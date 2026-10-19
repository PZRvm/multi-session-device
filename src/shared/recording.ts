/** 录制 UI 镜像不包含 serial、临时路径或文件句柄。 */
export type RecordingState =
  | 'starting'
  | 'awaiting-silent-choice'
  | 'recording'
  | 'pausing'
  | 'paused'
  | 'resuming'
  | 'stopping'
  | 'queued'
  | 'processing'
  | 'saved'
  | 'error'
  | 'cancelled'
export interface RecordingTask {
  taskId: string
  deviceId: string
  deviceName: string
  state: RecordingState
  audio: 'preparing' | 'available' | 'silent'
  durationMs: number
  bytes: number
  width: number
  height: number
  progress: number
  canRetry?: boolean
  fileName?: string
  error?: string
  interruption?: string
}
export interface RecordingSnapshot {
  revision: number
  limit: number
  tasks: RecordingTask[]
}
export const isRecordingActive = (state: RecordingState): boolean =>
  [
    'starting',
    'awaiting-silent-choice',
    'recording',
    'pausing',
    'paused',
    'resuming',
    'stopping'
  ].includes(state)
export type RecordingCommand = 'pause' | 'resume' | 'stop' | 'reveal' | 'dismiss' | 'retry'

/** 独立处理页只接收内存数据；job 的所有文件路径留在 main。 */
export interface ProcessorAuth {
  jobId: string
  token: string
}
export interface ProcessorInit extends ProcessorAuth {
  width: number
  height: number
}
export interface ProcessorFrame {
  data: Uint8Array
  keyframe: boolean
  codec: string
  boundary: boolean
  timestamp: number
  duration: number
}
export interface ProcessorPacket {
  data: Uint8Array
  type: 'key' | 'delta'
  timestamp: number
  duration: number
  config?: { codec: string; codedWidth?: number; codedHeight?: number; description?: Uint8Array }
}
