import { Settings } from 'lucide-react'
import styled from 'styled-components'
import { MAIN_COPY, format } from '@shared/i18n'
import { useCopy } from '../hooks/useCopy'
import { useThemeStore } from '../stores/themeStore'
import AppearanceModePicker from './AppearanceModePicker'

type BoardHeadProps = {
  /** 设备总数，两位补零展示，上限 99 */
  count: number
  /** 左栏宽 ≤ 320 时外观入口转紧凑态（单图标 + 下拉），否则分段直选 */
  compact: boolean
  onOpenSettings?: () => void
}

/** 40px 拖拽带：原生三灯留位/标题居左，右端为外观选择（设置齿轮左侧，与设置窗
 *  通用页共用 AppearanceModePicker）、设置入口与设备计数。 */
const BoardHead = ({ count, compact, onOpenSettings }: BoardHeadProps): React.JSX.Element => {
  const copy = useCopy(MAIN_COPY)
  const mode = useThemeStore((state) => state.mode)
  const setMode = useThemeStore((state) => state.setMode)
  return (
    <Wrapper>
      {window.api.platform === 'darwin' ? (
        <span className="traffic-space" aria-hidden="true" />
      ) : (
        <span className="title">{copy.appName}</span>
      )}
      <span className="head-right">
        <AppearanceModePicker
          mode={mode}
          onChange={setMode}
          compact={compact}
          triggerLabel={copy.themeSwitch}
        />
        <button
          type="button"
          title={copy.settings}
          aria-label={copy.settings}
          disabled={!onOpenSettings}
          onClick={onOpenSettings}
        >
          <Settings size={15} />
        </button>
        <span className="count" aria-label={format(copy.deviceCountAria, { count })}>
          <span className="count-label" aria-hidden="true">
            {copy.deviceCount}
          </span>
          <span className="count-digits" aria-hidden="true">
            {String(Math.min(count, 99)).padStart(2, '0')}
          </span>
        </span>
      </span>
    </Wrapper>
  )
}

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
  /* 右端控件带：外观选择 + 设置 + 设备计数；整组可交互区禁拖 */
  .head-right {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-left: auto;
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
