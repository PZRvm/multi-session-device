import { Pause, Play, Square, Video } from 'lucide-react'
import styled from 'styled-components'
import { RECORDING_COPY } from '@shared/i18n/recording'
import { useCopy } from '../hooks/useCopy'
import { useRecordingStore } from '../stores/recordingStore'
import { activeRecording } from './recordingPresentation'
import { toolButtonCss } from './toolButtonStyle'
import { PopoverIconButton } from './PopoverIconButton'

const RecordingControls = ({
  deviceId,
  disabled
}: {
  deviceId: string
  disabled: boolean
}): React.JSX.Element | null => {
  const copy = useCopy(RECORDING_COPY)
  const task = useRecordingStore((state) => activeRecording(state.snapshot.tasks, deviceId))
  const busy = useRecordingStore((state) => state.pending.includes(task?.taskId ?? deviceId))
  const start = useRecordingStore((state) => state.start)
  const command = useRecordingStore((state) => state.command)
  return (
    <Wrapper role="group" aria-label={copy.title}>
      {task ? (
        <>
          <PopoverIconButton
            className="tool-btn"
            icon={
              task.state === 'paused' ? (
                <Play size={16} aria-hidden="true" />
              ) : (
                <Pause size={16} aria-hidden="true" />
              )
            }
            label={task.state === 'paused' ? copy.resume : copy.pause}
            disabled={busy || !['recording', 'paused'].includes(task.state)}
            onClick={() => void command(task.taskId, task.state === 'paused' ? 'resume' : 'pause')}
          />
          <PopoverIconButton
            className="tool-btn recording-stop"
            icon={<Square size={14} fill="currentColor" aria-hidden="true" />}
            label={copy.stop}
            disabled={busy || task.state === 'stopping'}
            onClick={() => void command(task.taskId, 'stop')}
          />
        </>
      ) : (
        <PopoverIconButton
          className="tool-btn"
          icon={<Video size={16} aria-hidden="true" />}
          label={copy.start}
          disabled={disabled || busy}
          onClick={() => void start(deviceId)}
        />
      )}
    </Wrapper>
  )
}
const Wrapper = styled.div`
  ${toolButtonCss}
  display: flex;
  align-items: center;
  gap: 2px;
  .recording-stop {
    color: var(--danger);
  }
`
export default RecordingControls
