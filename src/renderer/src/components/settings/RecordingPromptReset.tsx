import { useRef, useState } from 'react'
import { RECORDING_COPY } from '@shared/i18n/recording'
import type { SettingsLocale } from '@shared/i18n'
import { toApiResult } from '../../api'

const RecordingPromptReset = ({ locale }: { locale: SettingsLocale }): React.JSX.Element => {
  const copy = RECORDING_COPY[locale]
  const busy = useRef(false)
  const [state, setState] = useState<'idle' | 'pending' | 'done' | 'error'>('idle')
  const [error, setError] = useState('')
  const reset = async (): Promise<void> => {
    if (busy.current) return
    busy.current = true
    setState('pending')
    const result = await toApiResult(window.api.recording.resetPrompts())
    setState(result.ok ? 'done' : 'error')
    if (!result.ok) setError(result.error)
    busy.current = false
  }
  return (
    <div className="row">
      <div className="row-label">
        <span className="label">{copy.resetPrompts}</span>
        <p className="description">{copy.resetPromptsHint}</p>
        {state === 'done' ? (
          <p className="description" role="status">
            {copy.resetPromptsDone}
          </p>
        ) : null}
        {state === 'error' ? (
          <p className="error-line" role="alert">
            {error}
          </p>
        ) : null}
      </div>
      <div className="controls">
        <button type="button" disabled={state === 'pending'} onClick={() => void reset()}>
          {state === 'pending' ? copy.resettingPrompts : copy.resetPrompts}
        </button>
      </div>
    </div>
  )
}
export default RecordingPromptReset
