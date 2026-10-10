import { useEffect, useRef, useState } from 'react'
import { Monitor, Moon, Sun } from 'lucide-react'
import styled from 'styled-components'
import { SETTINGS_COPY, type SettingsCopy } from '@shared/i18n'
import type { ThemeMode } from '@shared/types'
import { useCopy } from '../hooks/useCopy'

const MODES = [
  { mode: 'system', Icon: Monitor },
  { mode: 'light', Icon: Sun },
  { mode: 'dark', Icon: Moon }
] as const

const MODE_ICONS = { system: Monitor, light: Sun, dark: Moon } as const

interface AppearanceModePickerProps {
  mode: ThemeMode
  onChange: (mode: ThemeMode) => void
  /** 紧凑形态：单图标（所选模式）+ 下拉单选（窄栏用）；缺省分段直选（与设置页同款） */
  compact?: boolean
  /** 紧凑形态触发钮的可访问名（如主窗板头「亮暗模式」）；分段形态用组标签「外观」 */
  triggerLabel?: string
}

/** 外观三态选择（跟随系统/白天/黑夜）——主窗板头与设置窗通用页共用同一组件（图标词汇
 *  单源：显示器/太阳/月亮，名称取 settings 域字典）。宽态分段直选；窄态单图标 +
 *  下拉菜单，当前态高亮（交互对齐姊妹仓库 AppearanceEntry，自有组件不引 antd） */
const AppearanceModePicker = ({
  mode,
  onChange,
  compact = false,
  triggerLabel
}: AppearanceModePickerProps): React.JSX.Element => {
  const copy = useCopy(SETTINGS_COPY)
  const [menuOpen, setMenuOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)

  // 菜单打开期间：点击组件外关闭、Esc 关闭并归还焦点（浮层挂在板头拖拽带内）
  useEffect(() => {
    if (!menuOpen) return
    const onPointerDown = (event: PointerEvent): void => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setMenuOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setMenuOpen(false)
        rootRef.current?.querySelector('button')?.focus()
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [menuOpen])

  const modeLabel = (key: ThemeMode): string => copy[key as keyof SettingsCopy] as string

  if (compact) {
    const TriggerIcon = MODE_ICONS[mode]
    return (
      <Wrapper ref={rootRef} data-compact="true">
        <button
          className="trigger"
          type="button"
          aria-label={triggerLabel}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          title={triggerLabel}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <TriggerIcon size={15} aria-hidden="true" />
        </button>
        {menuOpen ? (
          <div className="menu" role="menu" aria-label={triggerLabel}>
            {MODES.map(({ mode: key, Icon }) => (
              <button
                className="menu-item"
                key={key}
                type="button"
                role="menuitemradio"
                aria-checked={key === mode}
                onClick={() => {
                  onChange(key)
                  setMenuOpen(false)
                }}
              >
                <Icon size={14} aria-hidden="true" />
                <span>{modeLabel(key)}</span>
              </button>
            ))}
          </div>
        ) : null}
      </Wrapper>
    )
  }

  return (
    <Wrapper role="group" aria-label={copy.appearance}>
      {MODES.map(({ mode: key, Icon }) => (
        <button
          className="segment-button"
          key={key}
          type="button"
          aria-label={modeLabel(key)}
          title={modeLabel(key)}
          aria-pressed={key === mode}
          onClick={() => onChange(key)}
        >
          <Icon size={16} aria-hidden="true" />
        </button>
      ))}
    </Wrapper>
  )
}

/** 分段轨道：抬升层 + 发丝线（与设置窗 segments 同一视觉词汇，样式随组件单源） */
const Wrapper = styled.div`
  display: inline-flex;
  gap: 2px;
  padding: 2px;
  border: 1px solid var(--board-control-line);
  border-radius: 4px;
  background: var(--board-bg-raised);
  .segment-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 27px;
    min-height: 26px;
    padding: 2px;
    border: none;
    border-radius: 2px;
    background: transparent;
    color: var(--board-ink-dim);
    cursor: pointer;
    font: inherit;
    white-space: nowrap;
  }
  .segment-button:hover {
    color: var(--board-ink);
    background: var(--board-hover-veil);
  }
  .segment-button[aria-pressed='true'] {
    color: var(--board-tile-ink);
    background: var(--board-segment-selected-bg);
  }

  &[data-compact='true'] {
    position: relative;
    flex: none;
    gap: 0;
    padding: 0;
    border: none;
    background: transparent;
  }
  .trigger {
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
  }
  .trigger:hover,
  .trigger[aria-expanded='true'] {
    color: var(--board-ink);
    background: var(--board-hover-veil);
  }
  button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  .menu {
    position: absolute;
    top: calc(100% + 6px);
    left: 50%;
    transform: translateX(-50%);
    z-index: 10;
    display: flex;
    flex-direction: column;
    width: max-content;
    min-width: 132px;
    padding: 4px;
    border: 1px solid var(--board-control-line);
    border-radius: 6px;
    background: var(--board-bg-raised);
    -webkit-app-region: no-drag;
  }
  .menu-item {
    display: inline-flex;
    align-items: center;
    justify-content: flex-start;
    gap: 10px;
    width: 100%;
    min-height: 28px;
    padding: 4px 8px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--board-ink);
    cursor: pointer;
    font: inherit;
    font-size: 13px;
    line-height: 20px;
    text-align: left;
    white-space: nowrap;
  }
  .menu-item svg {
    flex: none;
  }
  .menu-item:hover {
    background: var(--board-hover-veil);
  }
  .menu-item[aria-checked='true'] {
    background: var(--board-hover-veil);
    font-weight: 600;
  }
`

export default AppearanceModePicker
