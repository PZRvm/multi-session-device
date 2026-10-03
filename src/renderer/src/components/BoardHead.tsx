import { useEffect, useRef, useState } from 'react'
import { Monitor, Moon, Settings, Sun } from 'lucide-react'
import styled from 'styled-components'
import { useThemeStore, type ThemeMode } from '../stores/themeStore'

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

/** 左栏板头（40px）：窗口标题与拖拽由标准原生标题条承担（四轮终裁），这里只是
 * 外观/设置/计数控件行——右对齐。 */
const BoardHead = ({ count, panelWidth }: BoardHeadProps): React.JSX.Element => {
  const mode = useThemeStore((state) => state.mode)
  const setMode = useThemeStore((state) => state.setMode)
  const [menuOpen, setMenuOpen] = useState(false)
  const appearanceRootRef = useRef<HTMLSpanElement>(null)
  const current = MODES.find((entry) => entry.value === mode) ?? MODES[0]

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
  justify-content: flex-end;
  gap: 8px;
  flex: none;
  height: 40px;
  padding: 0 14px;
  border-bottom: 1px solid var(--board-hairline);
`

const HeadRight = styled.span`
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 4px;
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
