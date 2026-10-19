import { Pause, Video, X } from 'lucide-react'
import styled from 'styled-components'
import { isRecordingActive } from '@shared/recording'
import { format } from '@shared/i18n'
import { RECORDING_COPY } from '@shared/i18n/recording'
import { useCopy } from '../hooks/useCopy'
import { useRecordingStore } from '../stores/recordingStore'
import { recordingDuration, selectedRecording } from './recordingPresentation'

const RecordingIndicator = ({ deviceId }: { deviceId: string }): React.JSX.Element | null => {
  const copy = useCopy(RECORDING_COPY)
  const task = useRecordingStore((state) => selectedRecording(state.snapshot.tasks, deviceId))
  const command = useRecordingStore((state) => state.command)
  const busy = useRecordingStore((state) => state.pending.includes(task?.taskId ?? ''))
  if (!task) return null
  const active = isRecordingActive(task.state)
  const time = recordingDuration(task.durationMs)
  const status = `${copy[task.state]}${task.audio === 'silent' ? ` · ${copy.silent}` : ''}`
  return (
    <Wrapper data-state={task.state} title={status}>
      {/* 屏幕阅读器：状态变化即时播报；时间不在 live region 内，避免逐秒噪音 */}
      <ScreenReaderStatus role="status">{status}</ScreenReaderStatus>
      {active ? (
        <>
          {task.state === 'paused' ? (
            <Pause size={14} aria-hidden="true" />
          ) : (
            <Video size={14} aria-hidden="true" />
          )}
          <time aria-label={format(copy.recordingTime, { time })}>{time}</time>
        </>
      ) : task.state === 'processing' ? (
        <span>{format(copy.progress, { percent: Math.floor(task.progress * 100) })}</span>
      ) : task.state === 'error' || task.state === 'cancelled' ? (
        <>
          {task.state === 'error' && task.canRetry ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void command(task.taskId, 'retry')}
            >
              {copy.retry}
            </button>
          ) : (
            <span>{copy[task.state]}</span>
          )}
          <button
            type="button"
            className="dismiss"
            disabled={busy}
            aria-label={copy.dismiss}
            title={copy.dismiss}
            onClick={() => void command(task.taskId, 'dismiss')}
          >
            <X size={12} aria-hidden="true" />
          </button>
        </>
      ) : (
        <span>{copy[task.state]}</span>
      )}
    </Wrapper>
  )
}
const ScreenReaderStatus = styled.span`
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  border: 0;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
`
const Wrapper = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 30px;
  min-width: 0;
  padding: 0 8px;
  border: 1px solid var(--board-hairline);
  border-radius: 8px;
  background: var(--board-bg-raised);
  color: var(--board-ink);
  font-size: 12px;
  white-space: nowrap;
  time {
    display: block;
    line-height: 14px;
    font-family: ui-monospace, 'SF Mono', Menlo, monospace;
    font-variant-numeric: tabular-nums;
  }
  svg {
    display: block;
    flex: none;
  }
  button {
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    cursor: pointer;
    padding: 4px 0;
  }
  button.dismiss {
    display: inline-flex;
    align-items: center;
    padding: 4px 2px;
  }
  button:disabled {
    opacity: 0.4;
    cursor: default;
  }
  button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
`
export default RecordingIndicator
