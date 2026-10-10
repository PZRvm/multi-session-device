import { Moon, Settings, Sun } from 'lucide-react'
import styled from 'styled-components'
import { MAIN_COPY, format } from '@shared/i18n'
import { resolveThemeMode } from '@shared/themeSystems'
import { useCopy } from '../hooks/useCopy'
import { useThemeStore } from '../stores/themeStore'
import { usePrefersDark } from '../theme/usePrefersDark'

type BoardHeadProps = {
  /** 设备总数，两位补零展示，上限 99 */
  count: number
  onOpenSettings?: () => void
}

/** 亮暗快速切换（左上角）：当前暗 → 点击切白天；当前亮（含跟随系统解析为亮）→ 切黑夜。
 *  「跟随系统」下点击落到与当前解析结果相反的显式模式；图标随系统翻转即时跟随
 *  （解析态经共享 usePrefersDark 订阅，review P3-1 收口） */
const useAppearanceToggle = (): { resolved: 'light' | 'dark'; toggle: () => void } => {
  const mode = useThemeStore((state) => state.mode)
  const setMode = useThemeStore((state) => state.setMode)
  const prefersDark = usePrefersDark()
  const resolved = resolveThemeMode(mode, prefersDark)
  return {
    resolved,
    toggle: () => setMode(resolved === 'dark' ? 'light' : 'dark')
  }
}

/** 40px 拖拽带：原生三灯留位，左上亮暗切换，右端设置与设备计数。 */
const BoardHead = ({ count, onOpenSettings }: BoardHeadProps): React.JSX.Element => {
  const copy = useCopy(MAIN_COPY)
  const { resolved, toggle } = useAppearanceToggle()
  const toggleLabel = resolved === 'dark' ? copy.toggleLight : copy.toggleDark
  return (
    <Wrapper>
      <span className="head-left">
        {window.api.platform === 'darwin' ? (
          <span className="traffic-space" aria-hidden="true" />
        ) : (
          <span className="title">{copy.appName}</span>
        )}
        {/* switch 语义（review P3-2）：aria-checked 表当前是否暗色，title 保留动作提示 */}
        <button
          type="button"
          role="switch"
          aria-label={copy.themeSwitch}
          aria-checked={resolved === 'dark'}
          title={toggleLabel}
          onClick={toggle}
        >
          {resolved === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
        </button>
      </span>
      <span className="head-right">
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
  /* 左上组：三灯让位（darwin）/标题（其余平台）+ 亮暗切换钮；整组可交互区禁拖 */
  .head-left {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    -webkit-app-region: no-drag;
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
