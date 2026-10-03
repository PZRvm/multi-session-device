import { Monitor, Moon, Settings, Sun } from 'lucide-react'
import styled from 'styled-components'
import { useThemeStore, type ThemeMode } from '../stores/themeStore'

const MODE_CYCLE: ThemeMode[] = ['system', 'light', 'dark']

const MODE_META: Record<ThemeMode, { label: string; Icon: typeof Sun }> = {
  system: { label: '外观：跟随系统', Icon: Monitor },
  light: { label: '外观：亮', Icon: Sun },
  dark: { label: '外观：暗', Icon: Moon }
}

type BoardHeadProps = {
  /** 会话（设备）总数，两位补零展示，上限 99 */
  count: number
}

/** 左栏板头（40px 拖拽带，契约同姊妹仓库 .board-head）：darwin 三灯占位 + 右端
 * 主题/设置/计数三件套。交互钮一律 no-drag，空白区拖窗。 */
const BoardHead = ({ count }: BoardHeadProps): React.JSX.Element => {
  const mode = useThemeStore((state) => state.mode)
  const setMode = useThemeStore((state) => state.setMode)
  const { label, Icon } = MODE_META[mode]

  const cycleMode = (): void => {
    const next = MODE_CYCLE[(MODE_CYCLE.indexOf(mode) + 1) % MODE_CYCLE.length]
    setMode(next)
  }

  return (
    <Wrapper>
      {window.api.platform === 'darwin' ? (
        <TrafficSpacer aria-hidden="true" />
      ) : (
        <HeadTitle>多会话设备</HeadTitle>
      )}
      <HeadRight>
        <HeadButton type="button" title={label} aria-label={label} onClick={cycleMode}>
          <Icon size={15} />
        </HeadButton>
        <HeadButton
          type="button"
          title="设置 · stage 05 接入"
          aria-label="设置"
          disabled
          aria-disabled="true"
        >
          <Settings size={15} />
        </HeadButton>
        <Count aria-label={`会话 ${count}`}>
          <CountLabel aria-hidden="true">会话</CountLabel>
          <CountDigits aria-hidden="true">
            {String(Math.min(count, 99)).padStart(2, '0')}
          </CountDigits>
        </Count>
      </HeadRight>
    </Wrapper>
  )
}

const Wrapper = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex: none;
  height: 40px;
  padding: 0 14px;
  border-bottom: 1px solid var(--board-hairline);
  /* 板头整行是窗口拖拽带（darwin 原生标题条已去）；行内交互钮 no-drag */
  -webkit-app-region: drag;
`

const TrafficSpacer = styled.span`
  flex: none;
  width: 60px;
`

const HeadTitle = styled.span`
  font-size: 13px;
  font-weight: 600;
  color: var(--board-ink);
`

const HeadRight = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  -webkit-app-region: no-drag;
`

const HeadButton = styled.button`
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

  &:hover:not(:disabled) {
    background: var(--board-hover-veil);
    color: var(--board-ink);
  }

  &:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  &:disabled {
    cursor: default;
    opacity: 0.45;
  }
`

const Count = styled.span`
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
  margin-left: 6px;
`

const CountLabel = styled.span`
  font-size: 12px;
  color: var(--board-ink-dim);
`

const CountDigits = styled.span`
  font-family: ui-monospace, 'SF Mono', SFMono-Regular, Menlo, monospace;
  font-size: 13px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--board-tile-ink);
`

export default BoardHead
