import { useRef } from 'react'
import styled from 'styled-components'

type SegmentedOption<T extends string> = {
  value: T
  label: string
}

type SegmentedControlProps<T extends string> = {
  options: ReadonlyArray<SegmentedOption<T>>
  value: T
  onChange: (value: T) => void
  ariaLabel: string
}

/** 三态一步直达切换（DESIGN.md 分段控件）：radiogroup 语义 + 方向键循环 + roving tabindex */
function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel
}: SegmentedControlProps<T>): React.JSX.Element {
  const segmentRefs = useRef(new Map<T, HTMLButtonElement>())

  // radiogroup 惯例：方向键 = 选值 + 搬焦点一体——React 改 tabIndex 不会移动
  // 浏览器焦点，必须显式 focus 新选中瓣（issue 2026-10-03-segmented-roving-focus）
  const move = (dir: 1 | -1): void => {
    const index = options.findIndex((option) => option.value === value)
    const next = options[(index + dir + options.length) % options.length]
    onChange(next.value)
    segmentRefs.current.get(next.value)?.focus()
  }

  return (
    <Wrapper
      role="radiogroup"
      aria-label={ariaLabel}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
          event.preventDefault()
          move(-1)
        } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
          event.preventDefault()
          move(1)
        }
      }}
    >
      {options.map((option) => (
        <button
          key={option.value}
          className="seg"
          type="button"
          role="radio"
          aria-checked={option.value === value}
          tabIndex={option.value === value ? 0 : -1}
          ref={(el) => {
            if (el) segmentRefs.current.set(option.value, el)
            else segmentRefs.current.delete(option.value)
          }}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </Wrapper>
  )
}

const Wrapper = styled.div`
  display: inline-flex;
  gap: 2px;
  padding: 2px;
  background: var(--board-bg-raised);
  border-radius: 4px;

  .seg {
    height: 22px;
    padding: 0 8px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--board-ink-dim);
    font-family: inherit;
    font-size: 11px;
    line-height: 1.5;
    cursor: pointer;
    transition:
      background-color 0.12s,
      color 0.12s;
  }

  .seg:hover {
    background: var(--board-hover-veil);
  }

  .seg[aria-checked='true'] {
    background: var(--board-segment-selected-bg);
    color: var(--board-tile-ink);
    font-weight: 600;
  }

  .seg:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
`

export default SegmentedControl
