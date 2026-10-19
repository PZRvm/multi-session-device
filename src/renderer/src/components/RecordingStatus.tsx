import { Pause, Video } from 'lucide-react'
import styled from 'styled-components'
import { isRecordingActive } from '@shared/recording'
import { RECORDING_COPY } from '@shared/i18n/recording'
import { useCopy } from '../hooks/useCopy'
import { useRecordingStore } from '../stores/recordingStore'
import { selectedRecording } from './recordingPresentation'

const RecordingStatus = ({ deviceId }: { deviceId: string }): React.JSX.Element | null => {
  const copy = useCopy(RECORDING_COPY)
  const task = useRecordingStore((state) => selectedRecording(state.snapshot.tasks, deviceId))
  if (!task) return null
  return (
    <Wrapper data-state={task.state}>
      {task.state === 'paused' ? (
        <Pause size={11} aria-hidden="true" />
      ) : isRecordingActive(task.state) ? (
        <Video size={11} aria-hidden="true" />
      ) : null}
      {copy[task.state]}
      {task.audio === 'silent' ? ` · ${copy.silent}` : ''}
    </Wrapper>
  )
}
const Wrapper = styled.span`
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 3px;
  font-size: 11px;
  line-height: 1.5;
  color: inherit;
  opacity: 0.85;
  svg {
    flex: none;
  }
`
export default RecordingStatus
