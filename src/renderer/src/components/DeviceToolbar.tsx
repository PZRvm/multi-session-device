import { ChevronLeft, Home, Power, RotateCw, SquareStack, Volume1, Volume2 } from 'lucide-react'
import styled from 'styled-components'
import type { ScreenToolbarButton } from '@shared/types'

type DeviceToolbarProps = {
  disabled: boolean
  onButton: (button: ScreenToolbarButton) => void
  onRotate: () => void
}

/** 物理键工具条：返回/主页/概览/电源/音量加减 + 旋转；中文可访问名 + 焦点样式 + 禁用态 */
const DeviceToolbar = ({ disabled, onButton, onRotate }: DeviceToolbarProps): React.JSX.Element => {
  const buttons: Array<{ button: ScreenToolbarButton; label: string; icon: React.JSX.Element }> = [
    { button: 'back', label: '返回', icon: <ChevronLeft size={16} /> },
    { button: 'home', label: '主页', icon: <Home size={16} /> },
    { button: 'overview', label: '概览', icon: <SquareStack size={16} /> },
    { button: 'power', label: '电源', icon: <Power size={16} /> },
    { button: 'volume-up', label: '音量加', icon: <Volume2 size={16} /> },
    { button: 'volume-down', label: '音量减', icon: <Volume1 size={16} /> }
  ]
  return (
    <Bar role="toolbar" aria-label="设备按键工具条">
      {buttons.map((entry) => (
        <ToolButton
          key={entry.button}
          type="button"
          aria-label={entry.label}
          title={entry.label}
          disabled={disabled}
          onClick={() => onButton(entry.button)}
        >
          {entry.icon}
        </ToolButton>
      ))}
      <ToolButton
        type="button"
        aria-label="旋转屏幕"
        title="旋转屏幕"
        disabled={disabled}
        onClick={onRotate}
      >
        <RotateCw size={16} />
      </ToolButton>
    </Bar>
  )
}

const Bar = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 8px;
  border-radius: 8px;
  background: var(--board-bg-raised);
  border: 1px solid var(--board-hairline);
`

const ToolButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--board-ink);
  cursor: pointer;
  transition: background-color 0.12s;

  &:hover:not(:disabled) {
    background: var(--board-hover-veil);
  }

  &:disabled {
    opacity: 0.35;
    cursor: default;
  }

  &:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
`

export default DeviceToolbar
