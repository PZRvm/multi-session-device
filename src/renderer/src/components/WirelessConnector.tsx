import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Loader2, RefreshCw, X } from 'lucide-react'
import styled from 'styled-components'
import { MAIN_COPY, format } from '@shared/i18n'
import type { WirelessCandidate } from '@shared/types'
import { toApiResult } from '../api'
import { useCopy } from '../hooks/useCopy'
import { spinKeyframes } from '../styles/animations'
import { wirelessConnectFailureText } from './wirelessOutcome'

type WirelessConnectorProps = {
  onClose: () => void
}

type Feedback =
  | { kind: 'ok'; serial: string }
  | { kind: 'fail'; text: string }
  | { kind: 'pair-ok' }
  | { kind: 'pair-fail'; text: string }

const HOST_RE = /^\d{1,3}(?:\.\d{1,3}){3}$/

/** 无线连接器弹层（plan 2026-10-15-real-device-wireless）：锚在真机区组头上方的
 *  非模态卡。打开即扫描（mDNS + 本网段 5555）；手动 IP 一等入口；配对码表单收在
 *  折叠区（小米系）。无状态裁定：不记任何历史，关闭即清。连接成功即关——设备
 *  由 track 推送自然出现在列表，不在本层重复呈现。 */
const WirelessConnector = ({ onClose }: WirelessConnectorProps): React.JSX.Element => {
  const copy = useCopy(MAIN_COPY)
  const [scanning, setScanning] = useState(true)
  const [candidates, setCandidates] = useState<WirelessCandidate[]>([])
  const [connectingKey, setConnectingKey] = useState<string | null>(null)
  const [manualHost, setManualHost] = useState('')
  const [manualPort, setManualPort] = useState('')
  const [pairOpen, setPairOpen] = useState(false)
  const [pairHost, setPairHost] = useState('')
  const [pairPort, setPairPort] = useState('')
  const [pairCode, setPairCode] = useState('')
  const [pairing, setPairing] = useState(false)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const firstFieldRef = useRef<HTMLButtonElement | null>(null)

  const scan = useCallback(async (): Promise<void> => {
    setScanning(true)
    const result = await toApiResult(window.api.devices.scanExternalWireless())
    setScanning(false)
    if (result.ok) setCandidates(result.data)
    else setFeedback({ kind: 'fail', text: result.error })
  }, [])

  useEffect(() => {
    // 微任务起扫：不在 effect 体内同步 setState（级联渲染防线）
    void Promise.resolve().then(scan)
    firstFieldRef.current?.focus()
  }, [scan])

  const connect = useCallback(
    async (host: string, port: number | undefined, key: string): Promise<void> => {
      setConnectingKey(key)
      const result = await toApiResult(window.api.devices.connectExternalWireless({ host, port }))
      setConnectingKey(null)
      if (!result.ok) {
        setFeedback({ kind: 'fail', text: result.error })
        return
      }
      if (result.data.ok) {
        onClose()
        return
      }
      setFeedback({ kind: 'fail', text: wirelessConnectFailureText(copy, result.data) })
    },
    [copy, onClose]
  )

  const pair = useCallback(async (): Promise<void> => {
    const port = Number.parseInt(pairPort, 10)
    if (!HOST_RE.test(pairHost) || !Number.isInteger(port) || pairCode.trim() === '') return
    setPairing(true)
    const result = await toApiResult(
      window.api.devices.pairExternalWireless({ host: pairHost, port, code: pairCode })
    )
    setPairing(false)
    if (!result.ok) {
      setFeedback({ kind: 'pair-fail', text: result.error })
      return
    }
    if (result.data.ok) {
      setFeedback({ kind: 'pair-ok' })
      void scan()
    } else {
      setFeedback({
        kind: 'pair-fail',
        text: format(copy.wirelessPairFailed, { message: result.data.message })
      })
    }
  }, [copy, pairCode, pairHost, pairPort, scan])

  const manualReady = HOST_RE.test(manualHost)

  return (
    <Popover
      role="dialog"
      aria-label={copy.wirelessDialogTitle}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose()
      }}
    >
      <div className="pop-head">
        <span className="pop-title">{copy.wirelessDialogTitle}</span>
        <button
          ref={firstFieldRef}
          type="button"
          className="icon-btn"
          aria-label={copy.wirelessRefresh}
          disabled={scanning}
          onClick={() => void scan()}
        >
          <RefreshCw size={12} aria-hidden="true" />
        </button>
        <button type="button" className="icon-btn" aria-label={copy.cancel} onClick={onClose}>
          <X size={12} aria-hidden="true" />
        </button>
      </div>

      <div className="scan-body" aria-busy={scanning}>
        {scanning ? (
          <p className="scan-line">
            <Loader2 size={13} className="spin" aria-hidden="true" />
            {copy.wirelessScanning}
          </p>
        ) : candidates.length > 0 ? (
          candidates.map((candidate) => {
            const key = `${candidate.host}:${candidate.port}`
            return (
              <div className="candidate" key={key}>
                <span className="cand-main">
                  <span className="cand-name">{candidate.name ?? candidate.host}</span>
                  <span className="cand-addr">
                    {candidate.host}:{candidate.port}
                  </span>
                </span>
                <span className="cand-source">
                  {candidate.source === 'subnet-scan'
                    ? copy.wirelessSourceSubnet
                    : candidate.source === 'mdns-pairing'
                      ? copy.wirelessSourceMdns
                      : copy.wirelessSourceMdns}
                </span>
                <button
                  type="button"
                  className="connect-btn"
                  disabled={connectingKey !== null}
                  onClick={() => void connect(candidate.host, candidate.port, key)}
                >
                  {connectingKey === key ? (
                    <Loader2 size={11} className="spin" aria-hidden="true" />
                  ) : (
                    copy.wirelessConnectAction
                  )}
                </button>
              </div>
            )
          })
        ) : (
          <p className="scan-line empty">{copy.wirelessScanEmpty}</p>
        )}
      </div>

      <form
        className="manual"
        onSubmit={(event) => {
          event.preventDefault()
          if (manualReady && connectingKey === null) {
            const port = manualPort.trim() === '' ? undefined : Number.parseInt(manualPort, 10)
            void connect(manualHost, port, `manual:${manualHost}`)
          }
        }}
      >
        <span className="section-title">{copy.wirelessManualTitle}</span>
        <div className="manual-row">
          <Input
            className="host-input"
            value={manualHost}
            placeholder="192.168.31.102"
            inputMode="decimal"
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setManualHost(event.target.value)}
            aria-label={copy.wirelessManualHostLabel}
          />
          <Input
            className="port-input"
            value={manualPort}
            placeholder={copy.wirelessManualPortPlaceholder}
            inputMode="numeric"
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setManualPort(event.target.value)}
            aria-label={copy.wirelessManualPortLabel}
          />
          <button
            type="submit"
            className="connect-btn"
            disabled={!manualReady || connectingKey !== null}
          >
            {connectingKey === `manual:${manualHost}` ? (
              <Loader2 size={11} className="spin" aria-hidden="true" />
            ) : (
              copy.wirelessConnectAction
            )}
          </button>
        </div>
      </form>

      <div className="pair">
        <button
          type="button"
          className="pair-toggle"
          aria-expanded={pairOpen}
          onClick={() => setPairOpen((open) => !open)}
        >
          {pairOpen ? (
            <ChevronDown size={11} aria-hidden="true" />
          ) : (
            <ChevronRight size={11} aria-hidden="true" />
          )}
          {copy.wirelessPairTitle}
        </button>
        {pairOpen ? (
          <form
            className="pair-form"
            onSubmit={(event) => {
              event.preventDefault()
              if (!pairing) void pair()
            }}
          >
            <div className="manual-row">
              <Input
                className="host-input"
                value={pairHost}
                inputMode="decimal"
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => setPairHost(event.target.value)}
                aria-label={copy.wirelessPairHostLabel}
              />
              <Input
                className="port-input"
                value={pairPort}
                inputMode="numeric"
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => setPairPort(event.target.value)}
                aria-label={copy.wirelessPairPortLabel}
              />
            </div>
            <div className="manual-row">
              <Input
                className="code-input"
                value={pairCode}
                inputMode="numeric"
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => setPairCode(event.target.value)}
                aria-label={copy.wirelessPairCodeLabel}
              />
              <button
                type="submit"
                className="connect-btn"
                disabled={
                  pairing ||
                  !HOST_RE.test(pairHost) ||
                  pairPort.trim() === '' ||
                  pairCode.trim() === ''
                }
              >
                {pairing ? (
                  <Loader2 size={11} className="spin" aria-hidden="true" />
                ) : (
                  copy.wirelessPairSubmit
                )}
              </button>
            </div>
          </form>
        ) : null}
      </div>

      {feedback ? (
        <p className="feedback" role="status" aria-live="polite">
          {feedback.kind === 'ok'
            ? format(copy.wirelessConnectDone, { serial: feedback.serial })
            : feedback.kind === 'pair-ok'
              ? copy.wirelessPairSuccess
              : feedback.text}
        </p>
      ) : null}
    </Popover>
  )
}

const Input = (props: React.ComponentPropsWithoutRef<'input'>): React.JSX.Element => (
  <input {...props} />
)

const Popover = styled.div`
  position: absolute;
  bottom: calc(100% + 8px);
  left: 0;
  right: 0;
  z-index: 20;
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 420px;
  overflow-y: auto;
  padding: 10px;
  border-radius: 8px;
  background: var(--board-bg-raised);
  border: 1px solid var(--board-hairline);
  box-shadow: 0 6px 18px rgb(0 0 0 / 18%);

  .spin {
    animation: ${spinKeyframes} 0.9s linear infinite;
  }

  .pop-head {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .pop-title {
    flex: 1;
    font-size: 13px;
    font-weight: 600;
    color: var(--board-ink);
  }

  .icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    padding: 0;
    border: 1px solid var(--board-hairline);
    border-radius: 50%;
    background: var(--board-bg-raised);
    color: var(--board-ink);
    cursor: pointer;
    transition: background-color 0.12s;
  }

  .icon-btn:hover:not(:disabled) {
    background: var(--board-hover-veil);
  }

  .icon-btn:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  .scan-body {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .scan-line {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0;
    font-size: 12px;
    color: var(--board-ink-dim);
  }

  .scan-line.empty {
    color: var(--board-ink-dim);
  }

  .candidate {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 2px;
    border-top: 1px solid var(--board-hairline);
  }

  .candidate:first-of-type {
    border-top: none;
  }

  .cand-main {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .cand-name {
    font-size: 12px;
    font-weight: 500;
    color: var(--board-ink);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .cand-addr {
    font-family: ui-monospace, 'SF Mono', Menlo, monospace;
    font-size: 11px;
    color: var(--board-ink-dim);
  }

  .cand-source {
    flex: none;
    font-size: 10px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--board-ink-dim);
  }

  .connect-btn {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    height: 22px;
    padding: 0 10px;
    border: 1px solid var(--board-control-line);
    border-radius: 4px;
    background: transparent;
    color: var(--board-ink);
    font-size: 11px;
    font-family: inherit;
    cursor: pointer;
    transition:
      background-color 0.12s,
      border-color 0.12s;
  }

  .connect-btn:hover:not(:disabled) {
    background: var(--board-hover-veil);
    border-color: var(--board-ink-dim);
  }

  .connect-btn:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  .connect-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .section-title {
    font-size: 11px;
    letter-spacing: 0.08em;
    color: var(--board-ink-dim);
  }

  .manual,
  .pair {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .manual {
    border-top: 1px solid var(--board-hairline);
    padding-top: 8px;
  }

  .pair {
    border-top: 1px solid var(--board-hairline);
    padding-top: 8px;
  }

  .pair-toggle {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--board-ink-dim);
    font-size: 11px;
    letter-spacing: 0.08em;
    font-family: inherit;
    cursor: pointer;
  }

  .pair-toggle:hover {
    color: var(--board-ink);
  }

  .pair-toggle:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  .pair-form {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .manual-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  input {
    height: 26px;
    padding: 0 8px;
    background: var(--board-bg);
    color: var(--board-ink);
    border: 1px solid var(--board-control-line);
    border-radius: 4px;
    font-family: inherit;
    font-size: 12px;
    line-height: 1.5;
    transition: border-color 0.12s;
  }

  input::placeholder {
    color: var(--board-ink-dim);
  }

  input:focus {
    outline: none;
    border-color: var(--board-ink);
  }

  input.host-input {
    flex: 1;
    min-width: 0;
    font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  }

  input.port-input {
    width: 56px;
    font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  }

  input.code-input {
    flex: 1;
    min-width: 0;
    font-family: ui-monospace, 'SF Mono', Menlo, monospace;
    letter-spacing: 0.12em;
  }

  .feedback {
    margin: 0;
    padding-top: 6px;
    border-top: 1px solid var(--board-hairline);
    font-size: 11px;
    line-height: 1.5;
    color: var(--board-ink-dim);
    word-break: break-all;
  }
`

export default WirelessConnector
