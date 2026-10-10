import { Loader2, X } from 'lucide-react'
import styled from 'styled-components'
import { MAIN_COPY, format } from '@shared/i18n'
import { useCopy } from '../hooks/useCopy'
import type { ScreenshotState } from '../hooks/useScreenshot'

type ScreenshotPopoverProps = {
  state: Extract<ScreenshotState, { phase: 'copied' | 'saving' | 'saved' | 'error' }>
  onSave: () => void
  onClose: () => void
}

/** 截屏结果气泡（非模态，role=status）：左上关闭 + 缩略图 + 已复制反馈 + 保存到下载文件夹。
 *  10 秒自动消失由 useScreenshot 管理；capturing/idle 时不渲染 */
const ScreenshotPopover = ({
  state,
  onSave,
  onClose
}: ScreenshotPopoverProps): React.JSX.Element => {
  const copy = useCopy(MAIN_COPY)
  return (
    <Card role="status" aria-live="polite">
      <button
        className="close-btn"
        type="button"
        aria-label={copy.screenshotClose}
        onClick={onClose}
      >
        <X size={12} />
      </button>
      {state.thumbnail ? <img className="thumb" src={state.thumbnail} alt="" /> : null}
      {state.phase === 'copied' ? (
        <>
          <p className="line">{copy.screenshotCopied}</p>
          <button className="save-btn" type="button" onClick={onSave}>
            {copy.screenshotSave}
          </button>
        </>
      ) : state.phase === 'saving' ? (
        <p className="line">
          <Loader2 size={13} className="spin" />
          {copy.screenshotSaving}
        </p>
      ) : state.phase === 'saved' ? (
        <p className="line saved">{format(copy.screenshotSaved, { fileName: state.fileName })}</p>
      ) : (
        <p className="line error">{state.message}</p>
      )}
    </Card>
  )
}

const Card = styled.div`
  position: absolute;
  bottom: calc(100% + 8px);
  right: 0;
  z-index: 20;
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 216px;
  padding: 10px;
  border-radius: 8px;
  background: var(--board-bg-raised);
  border: 1px solid var(--board-hairline);
  box-shadow: 0 6px 18px rgb(0 0 0 / 18%);

  .close-btn {
    position: absolute;
    top: 6px;
    left: 6px;
    z-index: 1;
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

  .close-btn:hover {
    background: var(--board-hover-veil);
  }

  .close-btn:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  .thumb {
    width: 100%;
    max-height: 140px;
    object-fit: contain;
    border-radius: 4px;
    border: 1px solid var(--board-hairline);
    background: var(--board-bg);
  }

  .line {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0;
    font-size: 12px;
    color: var(--board-ink);
    word-break: break-all;
  }

  .saved {
    color: var(--accent);
  }

  .error {
    color: var(--danger);
  }

  .save-btn {
    align-self: stretch;
    height: 26px;
    border: 1px solid var(--accent);
    border-radius: 6px;
    background: transparent;
    color: var(--accent);
    font-size: 12px;
    cursor: pointer;
    transition: background-color 0.12s;
  }

  .save-btn:hover {
    background: var(--board-hover-veil);
  }

  .save-btn:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  .spin {
    animation: screenshot-spin 0.9s linear infinite;
  }

  @keyframes screenshot-spin {
    to {
      transform: rotate(360deg);
    }
  }
`

export default ScreenshotPopover
