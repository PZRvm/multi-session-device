import { useEffect, useRef, useState } from 'react'
import styled from 'styled-components'
import { useExternalStore } from '../stores/externalStore'
import type { WirelessConnectOutcome } from '@shared/types'
import { WIRELESS_RECOVERY_COPY } from '@shared/wirelessRecovery'
import { toApiResult } from '../api'
import { useCopy } from '../hooks/useCopy'

type Props = {
  outcome: Extract<WirelessConnectOutcome, { ok: false }>
  onRetry: () => void
  onRecovered: (serial: string) => void
}
/** Also lives outside the USB row so temporary transport loss cannot hide recovery progress. */
const WirelessRecoveryFeedback = ({ outcome, onRetry, onRecovered }: Props): React.JSX.Element => {
  const copy = useCopy(WIRELESS_RECOVERY_COPY)
  const state = useExternalStore((value) => value.recovery)
  const setState = useExternalStore((value) => value.applyRecovery)
  const [working, setWorking] = useState(false)
  const [message, setMessage] = useState('')
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    let revision = 0
    const unsubscribe = window.api.devices.onWirelessRecoveryChanged((next) => {
      revision++
      setState(next)
    })
    const refresh = (): void => {
      const before = revision
      void toApiResult(window.api.devices.getWirelessRecoveryState()).then((result) => {
        if (mounted.current && before === revision && result.ok) setState(result.data)
      })
    }
    refresh()
    const timer = window.setInterval(refresh, 1000)
    return () => {
      mounted.current = false
      unsubscribe()
      window.clearInterval(timer)
    }
  }, [setState])
  const busy = working || state.phase !== 'idle'
  const repair = async (): Promise<void> => {
    if (!outcome.attemptId || busy) return
    setWorking(true)
    setMessage('')
    const result = await toApiResult(window.api.devices.repairWirelessConnection(outcome.attemptId))
    if (!mounted.current) return
    setWorking(false)
    if (!result.ok) setMessage(result.error)
    else if (result.data.ok) {
      setMessage(copy.done)
      onRecovered(result.data.serial)
    } else if (!result.data.cancelled) setMessage(result.data.message)
  }
  const copyDiagnostics = async (): Promise<void> => {
    if (!outcome.attemptId) return
    const result = await toApiResult(window.api.devices.copyWirelessDiagnostics(outcome.attemptId))
    if (mounted.current) setMessage(result.ok ? copy.copied : result.error)
  }
  return (
    <Wrapper aria-busy={busy}>
      <div className="actions">
        <button type="button" disabled={busy} onClick={onRetry}>
          {copy.retry}
        </button>
        {outcome.repairable ? (
          <button
            type="button"
            disabled={busy || state.blocked.length > 0}
            onClick={() => void repair()}
          >
            {copy.repair}
          </button>
        ) : null}
        {outcome.attemptId ? (
          <button type="button" disabled={busy} onClick={() => void copyDiagnostics()}>
            {copy.copy}
          </button>
        ) : null}
      </div>
      {busy || message || state.blocked.length ? (
        <p role="status" aria-live="polite">
          {busy ? copy.working : message || copy.task + state.blocked.join(', ')}
        </p>
      ) : null}
    </Wrapper>
  )
}
const Wrapper = styled.div`
  min-width: 0;
  margin-top: 6px;
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  button {
    font: inherit;
    font-size: 11px;
    color: var(--board-ink);
    background: transparent;
    border: 1px solid var(--board-hairline);
    border-radius: 4px;
    padding: 3px 6px;
    cursor: pointer;
  }
  button:hover:not(:disabled) {
    background: var(--board-bg-raised);
  }
  button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  p {
    margin: 6px 0 0;
    color: var(--board-ink-dim);
    font-size: 11px;
    line-height: 1.5;
    overflow-wrap: anywhere;
  }
`
export default WirelessRecoveryFeedback
