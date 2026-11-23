import { useEffect, useState } from 'react'
import { ArrowDownToLine, RotateCw } from 'lucide-react'
import styled from 'styled-components'
import { format, UPDATE_COPY } from '@shared/i18n'
import type { UpdateSnapshot } from '@shared/updates'
import { useCopy } from '../hooks/useCopy'

const HeaderButton = styled.button`
  display: grid;
  flex: none;
  place-items: center;
  width: 25px;
  height: 25px;
  border: 1px solid var(--board-hairline);
  border-radius: 50%;
  background: transparent;
  color: var(--board-accent, var(--accent));
  cursor: pointer;
  -webkit-app-region: no-drag;
  &:hover:not(:disabled) {
    background: var(--board-tile);
  }
  &:disabled {
    cursor: default;
  }
`

export default function UpdateEntry({
  about = false
}: {
  about?: boolean
}): React.JSX.Element | null {
  const copy = useCopy(UPDATE_COPY)
  const [state, setState] = useState<UpdateSnapshot | null>(null)

  useEffect(() => {
    const api = window.api?.updates
    if (!api) return
    let live = true
    const accept = (snapshot: UpdateSnapshot): void => {
      if (live)
        setState((current) =>
          current && current.revision > snapshot.revision ? current : snapshot
        )
    }
    const unsubscribe = api.onChanged(accept)
    void api
      .getState()
      .then(accept)
      .catch((error: unknown) => console.warn('[updates]', error))
    return () => {
      live = false
      unsubscribe()
    }
  }, [])

  if (!state || state.status === 'disabled') return null
  if (about ? !state.policy.showSettingsEntry : !state.policy.showHeaderEntry) return null
  const candidate = state.candidateVersion
  if (!about && !candidate) return null
  const busy = ['checking', 'downloading', 'preparing', 'installing'].includes(state.status)
  const progress = state.progress?.percent
  const status = state.error
    ? copy.errors[state.error]
    : state.status === 'downloading' && progress != null
      ? format(copy.percent, { n: Math.floor(progress) })
      : state.status === 'up-to-date'
        ? copy.latest
        : state.status === 'ready'
          ? copy.restart
          : state.status === 'checking'
            ? copy.checking
            : state.status === 'preparing'
              ? copy.preparing
              : state.status === 'installing'
                ? copy.installing
                : state.status === 'downloading'
                  ? copy.downloading
                  : candidate
                    ? format(copy.version, { v: candidate })
                    : ''
  const label = candidate
    ? state.downloadedVersion
      ? copy.restart
      : copy.downloadAction
    : copy.check
  const act = (): void => {
    const api = window.api.updates
    void (candidate ? api.showDetails() : api.check()).catch((error: unknown) =>
      console.warn('[updates]', error)
    )
  }

  if (!about)
    return (
      <HeaderButton
        type="button"
        disabled={busy}
        title={status || label}
        aria-label={label}
        onClick={act}
      >
        {state.downloadedVersion ? <RotateCw size={14} /> : <ArrowDownToLine size={14} />}
      </HeaderButton>
    )

  return (
    <>
      <h2>{copy.title}</h2>
      <div className="directory-line">
        <span className="description" aria-live="polite">
          {status || state.currentVersion}
        </span>
        <button type="button" disabled={busy} onClick={act}>
          {label}
        </button>
      </div>
    </>
  )
}
