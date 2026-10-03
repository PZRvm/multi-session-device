import { useRef } from 'react'
import styled from 'styled-components'
import { clampListWidth, LIST_MAX_WIDTH, LIST_MIN_WIDTH } from './listWidth'

const KEYBOARD_STEP = 16

type ResizeHandleProps = {
  width: number
  onResize: (width: number) => void
}

/** 左右分栏 5px 拖拽分隔条：中缝 1px 可视线，pointer capture 拖拽 + 方向键微调 */
const ResizeHandle = ({ width, onResize }: ResizeHandleProps): React.JSX.Element => {
  // ref 跨渲染持有拖拽起点——拖拽期间父组件随宽度重渲染，普通变量会丢
  const dragStart = useRef({ x: 0, width: 0 })

  return (
    <Wrapper
      role="separator"
      aria-orientation="vertical"
      aria-label="调整列表宽度"
      aria-valuenow={width}
      aria-valuemin={LIST_MIN_WIDTH}
      aria-valuemax={LIST_MAX_WIDTH}
      tabIndex={0}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId)
        dragStart.current = { x: event.clientX, width }
      }}
      onPointerMove={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
        onResize(clampListWidth(dragStart.current.width + event.clientX - dragStart.current.x))
      }}
      onPointerUp={(event) => {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft') {
          event.preventDefault()
          onResize(clampListWidth(width - KEYBOARD_STEP))
        } else if (event.key === 'ArrowRight') {
          event.preventDefault()
          onResize(clampListWidth(width + KEYBOARD_STEP))
        }
      }}
    />
  )
}

const Wrapper = styled.div`
  position: relative;
  flex: none;
  width: 5px;
  align-self: stretch;
  cursor: col-resize;
  touch-action: none;

  /* 5px 命中区中央的 1px 可视线（--panel-divider 分隔条 token） */
  &::after {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    left: 2px;
    width: 1px;
    background: var(--panel-divider);
  }

  &:hover {
    background: var(--board-hover-veil);
  }

  &:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
`

export default ResizeHandle
