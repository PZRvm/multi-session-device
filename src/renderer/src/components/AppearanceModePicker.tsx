import { useEffect, useRef, useState } from 'react'
import { Monitor, Moon, Sun } from 'lucide-react'
import styled from 'styled-components'
import { SETTINGS_COPY, type SettingsCopy } from '@shared/i18n'
import type { ThemeMode } from '@shared/types'
import { useCopy } from '../hooks/useCopy'
import { usePrefersDark } from '../theme/usePrefersDark'

const MODES = [
  { mode: 'system', Icon: Monitor },
  { mode: 'light', Icon: Sun },
  { mode: 'dark', Icon: Moon }
] as const

const RESOLVED_ICONS = { system: Monitor, light: Sun, dark: Moon } as const

interface AppearanceModePickerProps {
  mode: ThemeMode
  onChange: (mode: ThemeMode) => void
  /** 紧凑形态：单图标（当前解析态）+ 下拉单选（窄栏用）；缺省分段直选（与设置页同款） */
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
  const prefersDark = usePrefersDark()
  const resolved = mode === 'system' ? (prefersDark ? 'dark' : 'light') : mode
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
    const TriggerIcon = RESOLVED_ICONS[resolved]
    return (
      <CompactRoot ref={rootRef}>
        <Trigger
          type="button"
          aria-label={triggerLabel}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          title={triggerLabel}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <TriggerIcon size={15} />
        </Trigger>
        {menuOpen ? (
          <Menu role="menu" aria-label={triggerLabel}>
            {MODES.map(({ mode: key, Icon }) => (
              <button
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
          </Menu>
        ) : null}
      </CompactRoot>
    )
  }

  return (
    <Segmented role="group" aria-label={copy.appearance}>
      {MODES.map(({ mode: key, Icon }) => (
        <button
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
    </Segmented>
  )
}

/** 分段轨道：抬升层 + 发丝线（与设置窗 segments 同一视觉词汇，样式随组件单源） */
const Segmented = styled.div`
  display: inline-flex;
  gap: 2px;
  padding: 2px;
  border: 1px solid var(--board-control-line);
  border-radius: 4px;
  background: var(--board-bg-raised);
  button {
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
  button:hover {
    color: var(--board-ink);
    background: var(--board-hover-veil);
  }
  button[aria-pressed='true'] {
    color: var(--board-tile-ink);
    background: var(--board-segment-selected-bg);
  }
`

/** 紧凑触发钮：常规描边控件（板头内 no-drag 由挂载点负责） */
const Trigger = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: 1px solid var(--board-control-line);
  border-radius: 4px;
  background: transparent;
  color: var(--board-ink-dim);
  cursor: pointer;
  &:hover {
    color: var(--board-ink);
    background: var(--board-hover-veil);
  }
  &[aria-expanded='true'] {
    color: var(--board-ink);
    background: var(--board-hover-veil);
  }
`

const CompactRoot = styled.div`
  position: relative;
  display: inline-flex;
`

const Menu = styled.div`
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 10;
  display: flex;
  flex-direction: column;
  min-width: 132px;
  padding: 4px;
  border: 1px solid var(--board-control-line);
  border-radius: 6px;
  background: var(--board-bg-raised);
  button {
    display: inline-flex;
    align-items: center;
    justify-content: flex-start;
    gap: 8px;
    min-height: 30px;
    padding: 4px 10px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--board-ink);
    cursor: pointer;
    font: inherit;
    font-size: 12px;
    text-align: left;
    white-space: nowrap;
  }
  button:hover {
    background: var(--board-hover-veil);
  }
  button[aria-checked='true'] {
    background: var(--board-segment-selected-bg);
    color: var(--board-tile-ink);
  }
`

export default AppearanceModePicker
