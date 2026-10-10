import { ChevronLeft, Home, Power, RotateCw, SquareStack, Volume1, Volume2 } from 'lucide-react'
import styled from 'styled-components'
import type { ScreenToolbarButton } from '@shared/types'
import { useCopy } from '../hooks/useCopy'
import { MAIN_COPY } from '@shared/i18n'

type DeviceToolbarProps = {
  disabled: boolean
  powerDisabled: boolean
  onButton: (button: ScreenToolbarButton) => void
  onPower: () => void
  onRotate: () => void
}

/** 物理键工具条：返回/主页/概览/电源/音量加减 + 旋转；本地化可访问名 + 焦点样式 + 禁用态 */
const DeviceToolbar = ({
  disabled,
  powerDisabled,
  onButton,
  onPower,
  onRotate
}: DeviceToolbarProps): React.JSX.Element => {
  const copy = useCopy(MAIN_COPY)
  const buttons: Array<{
    button: ScreenToolbarButton | 'power'
    label: string
    icon: React.JSX.Element
  }> = [
    { button: 'back', label: copy.back, icon: <ChevronLeft size={16} /> },
    { button: 'home', label: copy.home, icon: <Home size={16} /> },
    { button: 'overview', label: copy.overview, icon: <SquareStack size={16} /> },
    { button: 'power', label: copy.powerOff, icon: <Power size={16} /> },
    { button: 'volume-up', label: copy.volumeUp, icon: <Volume2 size={16} /> },
    { button: 'volume-down', label: copy.volumeDown, icon: <Volume1 size={16} /> }
  ]
  return (
    <Wrapper role="toolbar" aria-label={copy.toolbarAria}>
      {buttons.map((entry) => (
        <button
          key={entry.button}
          className="tool-btn"
          type="button"
          aria-label={entry.label}
          title={entry.label}
          disabled={entry.button === 'power' ? powerDisabled : disabled}
          onClick={() => (entry.button === 'power' ? onPower() : onButton(entry.button))}
        >
          {entry.icon}
        </button>
      ))}
      <button
        className="tool-btn"
        type="button"
        aria-label={copy.rotate}
        title={copy.rotate}
        disabled={disabled}
        onClick={onRotate}
      >
        <RotateCw size={16} />
      </button>
    </Wrapper>
  )
}

const Wrapper = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 8px;
  border-radius: 8px;
  background: var(--board-bg-raised);
  border: 1px solid var(--board-hairline);

  .tool-btn {
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
  }

  .tool-btn:hover:not(:disabled) {
    background: var(--board-hover-veil);
  }

  .tool-btn:disabled {
    opacity: 0.35;
    cursor: default;
  }

  .tool-btn:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
`

export default DeviceToolbar
