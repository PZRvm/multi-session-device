import { Settings } from 'lucide-react'
import styled from 'styled-components'

type BoardHeadProps = {
  /** 设备总数，两位补零展示，上限 99 */
  count: number
  onOpenSettings?: () => void
}

/** 40px 拖拽带：原生三灯留位，右端仅保留设置与设备计数。 */
const BoardHead = ({ count, onOpenSettings }: BoardHeadProps): React.JSX.Element => (
  <Wrapper>
    {window.api.platform === 'darwin' ? (
      <span className="traffic-space" aria-hidden="true" />
    ) : (
      <span className="title">多会话设备</span>
    )}
    <span className="head-right">
      <button
        type="button"
        title="设置"
        aria-label="设置"
        disabled={!onOpenSettings}
        onClick={onOpenSettings}
      >
        <Settings size={15} />
      </button>
      <span className="count" aria-label={`设备 ${count}`}>
        <span className="count-label" aria-hidden="true">
          设备
        </span>
        <span className="count-digits" aria-hidden="true">
          {String(Math.min(count, 99)).padStart(2, '0')}
        </span>
      </span>
    </span>
  </Wrapper>
)

const Wrapper = styled.div`
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex: none;
  height: 40px;
  padding: 0 14px;
  border-bottom: 1px solid var(--board-hairline);
  -webkit-app-region: drag;
  .title {
    font-size: 13px;
    font-weight: 600;
    color: var(--board-ink);
  }
  .traffic-space {
    flex: none;
    width: 60px;
    -webkit-app-region: no-drag;
  }
  .head-right {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    -webkit-app-region: no-drag;
  }
  button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    padding: 0;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--board-ink-dim);
    cursor: pointer;
    transition:
      background-color 0.12s,
      color 0.12s;
  }
  button:hover:not(:disabled) {
    background: var(--board-hover-veil);
    color: var(--board-ink);
  }
  button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  button:disabled {
    cursor: default;
    opacity: 0.45;
  }
  .count {
    display: inline-flex;
    align-items: baseline;
    gap: 4px;
    margin-left: 6px;
  }
  .count-label {
    font-size: 12px;
    color: var(--board-ink-dim);
  }
  .count-digits {
    font-family: ui-monospace, 'SF Mono', SFMono-Regular, Menlo, monospace;
    font-size: 13px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    color: var(--board-tile-ink);
  }
`

export default BoardHead
