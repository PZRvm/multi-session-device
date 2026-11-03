import { Pause, Play, Square, Video } from 'lucide-react'
import styled from 'styled-components'
import { RECORDING_COPY } from '@shared/i18n/recording'
import { useCopy } from '../hooks/useCopy'
import { useRecordingStore } from '../stores/recordingStore'
import { activeRecording } from './recordingPresentation'
import { toolButtonCss } from './toolButtonStyle'

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
          <button
            type="button"
            className="tool-btn"
            disabled={busy || !['recording', 'paused'].includes(task.state)}
            aria-label={task.state === 'paused' ? copy.resume : copy.pause}
            title={task.state === 'paused' ? copy.resume : copy.pause}
            onClick={() => void command(task.taskId, task.state === 'paused' ? 'resume' : 'pause')}
          >
            {task.state === 'paused' ? (
              <Play size={16} aria-hidden="true" />
            ) : (
              <Pause size={16} aria-hidden="true" />
            )}
          </button>
          <button
            type="button"
            className="tool-btn recording-stop"
            disabled={busy || task.state === 'stopping'}
            aria-label={copy.stop}
            title={copy.stop}
            onClick={() => void command(task.taskId, 'stop')}
          >
            <Square size={14} fill="currentColor" aria-hidden="true" />
          </button>
        </>
      ) : (
        <button
          type="button"
          className="tool-btn"
          disabled={disabled || busy}
          aria-label={copy.start}
          title={copy.start}
          onClick={() => void start(deviceId)}
        >
          <Video size={16} aria-hidden="true" />
        </button>
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
