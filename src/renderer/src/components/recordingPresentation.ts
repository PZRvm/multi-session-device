import { isRecordingActive, type RecordingTask } from '@shared/recording'

export const activeRecording = (
  tasks: RecordingTask[],
  deviceId: string
): RecordingTask | undefined =>
  tasks.find((task) => task.deviceId === deviceId && isRecordingActive(task.state))

export const selectedRecording = (
  tasks: RecordingTask[],
  deviceId: string
): RecordingTask | undefined => {
  const own = tasks.filter((task) => task.deviceId === deviceId)
  return (
    activeRecording(tasks, deviceId) ??
    own.find((task) => ['queued', 'processing'].includes(task.state)) ??
    own.findLast((task) => ['error', 'cancelled'].includes(task.state))
  )
}
export const recordingDuration = (ms: number): string => {
  const seconds = Math.floor(ms / 1000)
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
    .map((value) => String(value).padStart(2, '0'))
    .join(':')
}
