import WirelessRecoveryFeedback from './WirelessRecoveryFeedback'
import { WIRELESS_RECOVERY_COPY } from '@shared/wirelessRecovery'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Loader2, RefreshCw } from 'lucide-react'
import styled from 'styled-components'
import { MAIN_COPY, format } from '@shared/i18n'
import type { WirelessCandidate, WirelessConnectOutcome } from '@shared/types'
import { toApiResult } from '../api'
import { useCopy } from '../hooks/useCopy'
import { spinKeyframes } from '../styles/animations'
import { wirelessConnectFailureText } from './wirelessOutcome'

type WirelessConnectorProps = {
  /** 连接成功后的收口（原生窗由 WirelessApp 传 window.close；测试替身断言） */
  onClose: () => void
}

type Feedback =
  | { kind: 'ok'; serial: string }
  | { kind: 'fail'; text: string }
  | { kind: 'pair-ok' }
  | { kind: 'pair-fail'; text: string }

// 与 main 侧 HOST_PATTERN 同规：形态 + 八位组 0–255（P3-5）
const HOST_RE = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/

/** 无线连接器窗内容（plan 2026-10-15-real-device-wireless；2026-10-15 用户裁定由
 *  渲染层弹层改为 mac 原生弹窗——本组件即窗体页面，非绝对定位卡）。打开即扫描
 *  （mDNS + 本网段 5555 CNXN 握手）；手动 IP 一等入口；配对码表单收在折叠区（小米
 *  系）。无状态裁定：不记任何历史，关闭即清。连接成功即关——设备由 track 推送
 *  自然出现在列表，不在本层重复呈现。 */
const WirelessConnector = ({ onClose }: WirelessConnectorProps): React.JSX.Element => {
  const copy = useCopy(MAIN_COPY)
  const recoveryCopy = useCopy(WIRELESS_RECOVERY_COPY)
  const [scanning, setScanning] = useState(true)
  const [candidates, setCandidates] = useState<WirelessCandidate[]>([])
  const [connectingKey, setConnectingKey] = useState<string | null>(null)
  // 手动直连端口钉死 5555（用户裁定）：只有 IP 输入，不再有端口框
  const [manualHost, setManualHost] = useState('')
  const [pairOpen, setPairOpen] = useState(false)
  const [pairHost, setPairHost] = useState('')
  const [pairPort, setPairPort] = useState('')
  const [pairCode, setPairCode] = useState('')
  const [pairing, setPairing] = useState(false)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [failedAttempt, setFailedAttempt] = useState<{
    outcome: Extract<WirelessConnectOutcome, { ok: false }>
    host: string
    port?: number
  } | null>(null)
  const requestRef = useRef(0)
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
    const request = requestRef
    return () => {
      request.current++
    }
  }, [scan])

  const connect = useCallback(
    async (host: string, port: number | undefined, key: string): Promise<void> => {
      const request = ++requestRef.current
      setFailedAttempt(null)
      setConnectingKey(key)
      const result = await toApiResult(window.api.devices.connectExternalWireless({ host, port }))
      if (request !== requestRef.current) return
      setConnectingKey(null)
      if (!result.ok) {
        setFeedback({ kind: 'fail', text: result.error })
        return
      }
      if (result.data.ok) {
        onClose()
        return
      }
      setFailedAttempt({ outcome: result.data, host, port })
      setFeedback({
        kind: 'fail',
        text: wirelessConnectFailureText(copy, result.data, recoveryCopy)
      })
    },
    [copy, recoveryCopy, onClose]
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
    <Page
      $darwin={window.api.platform === 'darwin'}
      role="dialog"
      aria-label={copy.wirelessDialogTitle}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose()
      }}
    >
      {/* hiddenInset 无系统标题栏，头带即拖拽带（对齐 LogcatApp 惯用式：darwin 左侧
          80px 让位三灯；子控件 no-drag）。关闭走三灯与 Esc，页内不放关闭钮 */}
      <div className="drag-head">
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
      </div>

      <div className="page-body">
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
              void connect(manualHost, undefined, `manual:${manualHost}`)
            }
          }}
        >
          <span className="section-title">{copy.wirelessManualTitle}</span>
          <div className="manual-row">
            <Input
              className="host-input"
              value={manualHost}
              placeholder={copy.wirelessManualHostLabel}
              inputMode="decimal"
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => setManualHost(event.target.value)}
              aria-label={copy.wirelessManualHostLabel}
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
                  placeholder={copy.wirelessManualHostLabel}
                  inputMode="decimal"
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(event) => setPairHost(event.target.value)}
                  aria-label={copy.wirelessPairHostLabel}
                />
                <Input
                  className="port-input"
                  value={pairPort}
                  placeholder={copy.wirelessPairPortLabel}
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
                  placeholder={copy.wirelessPairCodeLabel}
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

        {failedAttempt?.outcome.attemptId ? (
          <WirelessRecoveryFeedback
            key={failedAttempt.outcome.attemptId}
            outcome={failedAttempt.outcome}
            onRetry={() =>
              void connect(
                failedAttempt.host,
                failedAttempt.port,
                `${failedAttempt.host}:${failedAttempt.port ?? 5555}`
              )
            }
            onRecovered={() => onClose()}
          />
        ) : null}
        {feedback ? (
          <p className="feedback" role="status" aria-live="polite">
            {feedback.kind === 'ok'
              ? format(copy.wirelessConnectDone, { serial: feedback.serial })
              : feedback.kind === 'pair-ok'
                ? copy.wirelessPairSuccess
                : feedback.text}
          </p>
        ) : null}
      </div>
    </Page>
  )
}

const Input = (props: React.ComponentPropsWithoutRef<'input'>): React.JSX.Element => (
  <input {...props} />
)

/** 原生窗页面容器：drag-head 是拖拽带（hiddenInset 无系统标题栏），正文在 page-body 滚动 */
const Page = styled.div<{ $darwin: boolean }>`
  display: flex;
  flex-direction: column;
  height: 100vh;
  box-sizing: border-box;
  background: var(--board-bg);

  .spin {
    animation: ${spinKeyframes} 0.9s linear infinite;
  }

  .drag-head {
    display: flex;
    align-items: center;
    gap: 4px;
    flex: none;
    height: 40px;
    padding: 0 14px;
    /* darwin 原生三灯安全区（hiddenInset 灯组右缘约 x=66，对齐 LogcatApp 的 80px） */
    padding-left: ${(props) => (props.$darwin ? '80px' : '14px')};
    border-bottom: 1px solid var(--board-hairline);
    background: var(--board-bg-raised);
    -webkit-app-region: ${(props) => (props.$darwin ? 'drag' : 'no-drag')};
  }

  .page-body {
    display: flex;
    flex-direction: column;
    gap: 10px;
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 12px 14px 14px;
  }

  .pop-title {
    flex: 1;
    font-size: 13px;
    font-weight: 600;
    color: var(--board-ink);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .icon-btn {
    flex: none;
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
    /* 头带是拖拽区，按钮必须脱离 drag 才可点 */
    -webkit-app-region: no-drag;
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
    /* 88px 容纳描述性 placeholder（「配对端口」/ Pairing port）不截断 */
    width: 88px;
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
