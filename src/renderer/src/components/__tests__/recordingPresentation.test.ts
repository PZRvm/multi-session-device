import { describe, expect, it } from 'vitest'
import type { RecordingTask } from '@shared/recording'
import { activeRecording, recordingDuration, selectedRecording } from '../recordingPresentation'

const task = (state: RecordingTask['state'], deviceId = 'device'): RecordingTask => ({
  taskId: `${deviceId}-${state}`,
  deviceId,
  deviceName: deviceId,
  state,
  audio: 'silent',
  durationMs: 0,
  bytes: 0,
  width: 0,
  height: 0,
  progress: 0
})

describe('recordingPresentation', () => {
  it('选择优先级：活动 > 排队/生成 > 终态，cancelled 也可被选中以便关闭', () => {
    const tasks = [task('cancelled'), task('error'), task('queued'), task('recording')]
    expect(selectedRecording(tasks, 'device')?.state).toBe('recording')
    expect(selectedRecording(tasks.slice(0, 3), 'device')?.state).toBe('queued')
    expect(selectedRecording(tasks.slice(0, 2), 'device')?.state).toBe('error')
    expect(selectedRecording([task('cancelled')], 'device')?.state).toBe('cancelled')
    expect(selectedRecording([], 'device')).toBeUndefined()
    expect(selectedRecording([task('recording', 'other')], 'device')).toBeUndefined()
  })

  it('activeRecording 只找该设备的进行中任务', () => {
    expect(activeRecording([task('paused')], 'device')?.state).toBe('paused')
    expect(activeRecording([task('error')], 'device')).toBeUndefined()
    expect(activeRecording([task('recording', 'other')], 'device')).toBeUndefined()
  })

  it('时长按整秒格式化为 HH:MM:SS', () => {
    expect(recordingDuration(0)).toBe('00:00:00')
    expect(recordingDuration(59_999)).toBe('00:00:59')
    expect(recordingDuration(3_723_400)).toBe('01:02:03')
  })
})
