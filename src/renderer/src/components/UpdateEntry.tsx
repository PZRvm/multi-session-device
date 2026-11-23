import { useEffect, useState } from 'react'
import { ArrowDownToLine, RotateCw } from 'lucide-react'
import styled from 'styled-components'
import { format, UPDATE_COPY } from '@shared/i18n'
import type { UpdateSnapshot, UpdateStatus } from '@shared/updates'
import { useCopy } from '../hooks/useCopy'
import { PopoverIconButton } from './PopoverIconButton'

const HeaderButton = styled(PopoverIconButton)`
  position: relative;
  isolation: isolate;
  overflow: hidden;
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: var(--accent);
  color: var(--accent-ink);
  cursor: pointer;
  -webkit-app-region: no-drag;

  &:hover:not(:disabled) {
    background: var(--accent-strong);
  }

  &:active:not(:disabled) {
    background: var(--accent-press);
  }

  &:focus-visible {
    outline: 2px solid var(--board-ink);
    outline-offset: 2px;
  }

  &:disabled {
    opacity: 0.65;
    cursor: default;
  }

  &:has([data-update-progress]) {
    opacity: 1;
  }
`

const AboutRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 22px;
  border-top: 1px solid var(--board-hairline);
  padding-top: 12px;

  & h2 {
    margin: 0;
  }

  & .description {
    margin: 0;
  }

  & .description:not(:empty) {
    margin-top: 4px;
  }
`

const AboutButton = styled.button`
  position: relative;
  isolation: isolate;
  overflow: hidden;
  flex: none;
  min-width: 100px;
  font-variant-numeric: tabular-nums;
`

const ProgressFill = styled.span<{ $vertical?: boolean }>`
  position: absolute;
  inset: 0;
  z-index: -1;
  background: var(${({ $vertical }) => ($vertical ? '--accent-ink' : '--accent')});
  opacity: 0.3;
  pointer-events: none;
  transform-origin: ${({ $vertical }) => ($vertical ? 'bottom' : 'left')};
`

type Copy = (typeof UPDATE_COPY)[keyof typeof UPDATE_COPY]
const busyStatus: readonly UpdateStatus[] = ['checking', 'downloading', 'preparing', 'installing']

function buttonLabel(state: UpdateSnapshot, copy: Copy, progress: number | null): string {
  switch (state.status) {
    case 'downloading':
      return progress === null
        ? copy.downloading
        : format(copy.percent, { n: Math.floor(progress) })
    case 'checking':
    case 'preparing':
    case 'installing':
      return copy[state.status]
    default:
      if (state.downloadedVersion) return state.error ? copy.retryInstall : copy.restart
      return state.candidateVersion ? copy.download : copy.check
  }
}

function aboutStatus(state: UpdateSnapshot, copy: Copy, busy: boolean, label: string): string {
  if (state.error) return copy.errors[state.error]
  if (state.candidateVersion) return format(copy.version, { v: state.candidateVersion })
  if (state.status === 'up-to-date') return copy.latest
  return busy ? label : ''
}

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
  const candidate = state.downloadedVersion ?? state.candidateVersion
  if (!about && !candidate) return null
  const busy = busyStatus.includes(state.status)
  const percent = state.progress?.percent
  const progress =
    state.status === 'downloading' && percent != null && Number.isFinite(percent)
      ? Math.max(0, Math.min(100, percent))
      : null
  const label = buttonLabel(state, copy, progress)
  const status = aboutStatus(state, copy, busy, label)
  const act = (): void => {
    const api = window.api.updates
    void (candidate ? api.showDetails() : api.check()).catch((error: unknown) =>
      console.warn('[updates]', error)
    )
  }

  if (!about)
    return (
      <HeaderButton
        label={state.error ? copy.errors[state.error] : label}
        ariaLabel={label}
        disabled={busy}
        onClick={act}
        icon={
          <>
            {progress !== null && (
              <ProgressFill
                $vertical
                data-update-progress
                aria-hidden="true"
                style={{ transform: `scaleY(${progress / 100})` }}
              />
            )}
            {state.downloadedVersion ? <RotateCw size={14} /> : <ArrowDownToLine size={14} />}
          </>
        }
      />
    )

  return (
    <AboutRow>
      <div>
        <h2>{copy.title}</h2>
        <p className="description" role="status">
          {status}
        </p>
      </div>
      <AboutButton type="button" disabled={busy} onClick={act}>
        {progress !== null && (
          <ProgressFill aria-hidden="true" style={{ transform: `scaleX(${progress / 100})` }} />
        )}
        {label}
      </AboutButton>
    </AboutRow>
  )
}
