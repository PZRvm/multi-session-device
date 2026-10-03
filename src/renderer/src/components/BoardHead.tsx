import { useEffect, useRef, useState } from 'react'
import { Monitor, Moon, Settings, Sun } from 'lucide-react'
import styled from 'styled-components'
import { useThemeStore, type ThemeMode } from '../stores/themeStore'
import { toApiResult } from '../api'

const APPEARANCE_SEGMENTED_MIN_WIDTH = 390

const MODES: ReadonlyArray<{ value: ThemeMode; label: string; Icon: typeof Sun }> = [
  { value: 'system', label: '跟随系统', Icon: Monitor },
  { value: 'light', label: '白天', Icon: Sun },
  { value: 'dark', label: '黑夜', Icon: Moon }
]

type BoardHeadProps = {
  /** 设备总数，两位补零展示，上限 99 */
  count: number
  /** 左栏当前宽度——≥390 外观入口升级为三段分段，更窄为图标 + 弹出菜单（同姊妹仓库阈值） */
  panelWidth: number
}

/** 左栏板头（40px 拖拽带，契约同姊妹仓库 .board-head）：darwin 自绘三灯 + 右端
 * 主题/设置/计数三件套。交互钮一律 no-drag，空白区拖窗。 */
const BoardHead = ({ count, panelWidth }: BoardHeadProps): React.JSX.Element => {
  const mode = useThemeStore((state) => state.mode)
  const setMode = useThemeStore((state) => state.setMode)
  const [menuOpen, setMenuOpen] = useState(false)
  const [focused, setFocused] = useState(true)
  const appearanceRootRef = useRef<HTMLSpanElement>(null)
  const current = MODES.find((entry) => entry.value === mode) ?? MODES[0]

  // 主进程 focus/blur 推送——自绘三灯切色（聚焦 mac 三色 / 失焦置灰）
  useEffect(() => {
    if (window.api.platform !== 'darwin') return
    return window.api.window.onFocusChanged(setFocused)
  }, [])

  // 菜单开着时：点外部或 Esc 收起（监听只挂菜单存活期）
  useEffect(() => {
    if (!menuOpen) return
    const onMouseDown = (event: MouseEvent): void => {
      if (!appearanceRootRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [menuOpen])

  const wide = panelWidth >= APPEARANCE_SEGMENTED_MIN_WIDTH

  return (
    <Wrapper>
      {window.api.platform === 'darwin' ? (
        <TrafficLights focused={focused} />
      ) : (
        <HeadTitle>多会话设备</HeadTitle>
      )}
      <HeadRight>
        <AppearanceRoot ref={appearanceRootRef}>
          {wide ? (
            <SegmentGroup role="radiogroup" aria-label="外观模式">
              {MODES.map(({ value, label, Icon }) => (
                <SegmentItem
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={mode === value}
                  title={label}
                  onClick={() => setMode(value)}
                >
                  <Icon size={14} />
                </SegmentItem>
              ))}
            </SegmentGroup>
          ) : (
            <>
              <HeadButton
                type="button"
                title={`外观：${current.label}`}
                aria-label={`外观：${current.label}`}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((open) => !open)}
              >
                <current.Icon size={15} />
              </HeadButton>
              {menuOpen ? (
                <Menu role="menu" aria-label="外观模式">
                  {MODES.map(({ value, label, Icon }) => (
                    <MenuRow
                      key={value}
                      type="button"
                      role="menuitemradio"
                      aria-checked={mode === value}
                      $checked={mode === value}
                      onClick={() => {
                        setMode(value)
                        setMenuOpen(false)
                      }}
                    >
                      <Icon size={14} />
                      <span>{label}</span>
                    </MenuRow>
                  ))}
                </Menu>
              ) : null}
            </>
          )}
        </AppearanceRoot>
        <HeadButton
          type="button"
          title="设置 · stage 05 接入"
          aria-label="设置"
          disabled
          aria-disabled="true"
        >
          <Settings size={15} />
        </HeadButton>
        <Count aria-label={`设备 ${count}`}>
          <CountLabel aria-hidden="true">设备</CountLabel>
          <CountDigits aria-hidden="true">
            {String(Math.min(count, 99)).padStart(2, '0')}
          </CountDigits>
        </Count>
      </HeadRight>
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
  /* 板头整行是窗口拖拽带（darwin 原生标题条已去）；行内交互钮 no-drag */
  -webkit-app-region: drag;
`

const Lights = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex: none;
  width: 60px;
  -webkit-app-region: no-drag;
`

const Light = styled.button<{ $color?: string }>`
  flex: none;
  width: 12px;
  height: 12px;
  padding: 0;
  border: none;
  border-radius: 50%;
  /* 失焦无 $color = control-line 灰（主题自适应），恒可见——自绘的初衷 */
  background: ${({ $color }) => $color ?? 'var(--board-control-line)'};
  cursor: pointer;
  transition: filter 0.12s;

  &:hover {
    filter: brightness(0.9);
  }

  &:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
`

const TRAFFIC_COLORS = ['#ff5f57', '#febc2e', '#28c840'] as const

/** 自绘三灯（原生灯已永久隐藏）：关闭 = window.close()（姊妹仓库 a49bcae 先例），
 * 最小化/全屏走 window:* IPC。聚焦 mac 三色，失焦置灰（control-line token 随主题） */
const TrafficLights = ({ focused }: { focused: boolean }): React.JSX.Element => (
  <Lights>
    <Light
      type="button"
      aria-label="关闭窗口"
      $color={focused ? TRAFFIC_COLORS[0] : undefined}
      onClick={() => window.close()}
    />
    <Light
      type="button"
      aria-label="最小化窗口"
      $color={focused ? TRAFFIC_COLORS[1] : undefined}
      onClick={() => {
        void toApiResult(window.api.window.minimize())
      }}
    />
    <Light
      type="button"
      aria-label="进入或退出全屏"
      $color={focused ? TRAFFIC_COLORS[2] : undefined}
      onClick={() => {
        void toApiResult(window.api.window.toggleFullscreen())
      }}
    />
  </Lights>
)

const HeadTitle = styled.span`
  font-size: 13px;
  font-weight: 600;
  color: var(--board-ink);
`

const HeadRight = styled.span`
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  -webkit-app-region: no-drag;
`

const AppearanceRoot = styled.span`
  position: relative;
  display: inline-flex;
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

const Menu = styled.div`
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 10;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 132px;
  padding: 4px;
  background: var(--settings-confirm-card-bg);
  border: 1px solid var(--board-control-line);
  border-radius: 6px;
`

const MenuRow = styled.button<{ $checked: boolean }>`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 8px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--board-ink);
  font-family: inherit;
  font-size: 12px;
  line-height: 1.5;
  text-align: left;
  cursor: pointer;
  transition: background-color 0.12s;

  &:hover {
    background: var(--board-hover-veil);
  }

  ${({ $checked }) =>
    $checked &&
    `
      background: var(--accent-veil);
      color: var(--board-tile-ink);
      font-weight: 600;
    `}

  &:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
`

const SegmentGroup = styled.div`
  display: inline-flex;
  gap: 2px;
  padding: 2px;
  background: var(--board-bg-raised);
  border: 1px solid var(--board-control-line);
  border-radius: 6px;
`

const SegmentItem = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 22px;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--board-ink-dim);
  cursor: pointer;
  transition:
    background-color 0.12s,
    color 0.12s;

  &:hover {
    background: var(--board-hover-veil);
    color: var(--board-ink);
  }

  &[aria-checked='true'] {
    background: var(--board-segment-selected-bg);
    color: var(--board-tile-ink);
  }

  &:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
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
