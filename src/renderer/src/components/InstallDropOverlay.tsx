import { CheckCircle2, Loader2, XCircle } from 'lucide-react'
import styled from 'styled-components'
import { MAIN_COPY, format } from '@shared/i18n'
import { useCopy } from '../hooks/useCopy'
import type { ApkInstallPhase } from '../hooks/useApkInstall'

type InstallDropOverlayProps = {
  phase: ApkInstallPhase
  busyNote: boolean
  deviceName: string
  /** 「仍要安装」重试（旧 APK A 案，plan 2026-10-13-real-device-usb-and-apk-install）：
   *  canBypass 失败卡出现按钮，点击带 --bypass-low-target-sdk-block 重发 */
  onRetryBypass?: () => void
}

/** 拖拽 APK 的两层反馈（plan 2026-10-10-drag-apk-install）：悬停期全幅高亮 + 提示条；
 *  安装/结果期右下角状态卡。整层 pointer-events:none——drop 落在舞台，不落在浮层 */
const InstallDropOverlay = ({
  phase,
  busyNote,
  deviceName,
  onRetryBypass
}: InstallDropOverlayProps): React.JSX.Element | null => {
  const copy = useCopy(MAIN_COPY)
  if (phase.phase === 'idle') return null
  if (phase.phase === 'dragging') {
    return (
      <DropHint role="status" aria-label={format(copy.apkDropHint, { name: deviceName })}>
        <p className="hint-chip">{format(copy.apkDropHint, { name: deviceName })}</p>
      </DropHint>
    )
  }
  return (
    <StatusCard role="status">
      {phase.phase === 'installing' ? (
        <>
          <Loader2 size={14} className="spin" aria-hidden="true" />
          <span className="status-text">
            {format(copy.apkInstalling, { file: phase.fileName })}
          </span>
        </>
      ) : phase.phase === 'installed' ? (
        <>
          <CheckCircle2 size={14} aria-hidden="true" />
          <span className="status-text">{format(copy.apkInstalled, { file: phase.fileName })}</span>
        </>
      ) : (
        <>
          <XCircle size={14} aria-hidden="true" />
          <span className="status-text status-failed">{phase.message}</span>
          {phase.canBypass && onRetryBypass ? (
            <button type="button" className="retry-bypass" onClick={onRetryBypass}>
              {copy.retryInstall}
            </button>
          ) : null}
        </>
      )}
      {busyNote ? <span className="busy-note">{copy.apkInstallBusy}</span> : null}
    </StatusCard>
  )
}

const DropHint = styled.div`
  position: absolute;
  inset: 8px;
  z-index: 2;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  pointer-events: none;
  border: 2px dashed var(--accent);
  border-radius: 10px;
  background: color-mix(in srgb, var(--accent) 8%, transparent);

  .hint-chip {
    margin: 0 0 14px;
    padding: 6px 14px;
    border-radius: 999px;
    background: var(--board-bg-raised);
    border: 1px solid var(--board-hairline);
    color: var(--board-ink);
    font-size: 13px;
  }
`

const StatusCard = styled.div`
  position: absolute;
  right: 12px;
  bottom: 12px;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 6px;
  max-width: min(80%, 360px);
  padding: 6px 12px;
  border-radius: 8px;
  background: var(--board-bg-raised);
  border: 1px solid var(--board-hairline);
  color: var(--board-ink);
  font-size: 12px;
  pointer-events: none;

  .spin {
    animation: apk-install-spin 1.2s linear infinite;
    flex: none;
  }

  @keyframes apk-install-spin {
    to {
      transform: rotate(360deg);
    }
  }

  .status-text {
    word-break: break-all;
  }

  .status-failed {
    color: var(--danger);
    /* 失败原文是可复制的排查数据（adb 输出）——全局禁选下局部回开 */
    user-select: text;
  }

  /* 「仍要安装」：卡片整层禁指针，按钮单独回开——绕过安全门槛的决定留给用户点击 */
  .retry-bypass {
    flex: none;
    margin-left: 4px;
    height: 24px;
    padding: 0 10px;
    border: 1px solid var(--danger);
    border-radius: 6px;
    background: var(--board-bg);
    color: var(--danger);
    font-size: 11px;
    cursor: pointer;
    pointer-events: auto;

    &:hover {
      background: color-mix(in srgb, var(--danger) 10%, var(--board-bg));
    }

    &:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: 1px;
    }
  }

  .busy-note {
    flex: none;
    color: var(--board-tile-ink);
    font-size: 11px;
  }
`

export default InstallDropOverlay
