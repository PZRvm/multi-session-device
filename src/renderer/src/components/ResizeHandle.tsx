import { useRef } from 'react'
import styled from 'styled-components'
import { MAIN_COPY } from '@shared/i18n'
import { useCopy } from '../hooks/useCopy'
import { clampListWidth, LIST_MAX_WIDTH, LIST_MIN_WIDTH } from './listWidth'

const KEYBOARD_STEP = 16

type ResizeHandleProps = {
  width: number
  onResize: (width: number) => void
  /** 把手位于面板哪条边：right（默认，左栏右缘——向右拖变宽）/ left（右栏左缘——向左拖变宽） */
  edge?: 'left' | 'right'
  /** 无障碍名覆盖（右栏日志 dock 用专属词条；缺省取列表宽度词条） */
  ariaLabel?: string
  /** 宽度边界覆盖（与 edge 配套；缺省用左栏边界） */
  minWidth?: number
  maxWidth?: number
  clamp?: (width: number) => number
}

/** 左右分栏 5px 拖拽分隔条：中缝 1px 可视线，pointer capture 拖拽 + 方向键微调 */
const ResizeHandle = ({
  width,
  onResize,
  edge = 'right',
  ariaLabel,
  minWidth = LIST_MIN_WIDTH,
  maxWidth = LIST_MAX_WIDTH,
  clamp = clampListWidth
}: ResizeHandleProps): React.JSX.Element => {
  const copy = useCopy(MAIN_COPY)
  // ref 跨渲染持有拖拽起点——拖拽期间父组件随宽度重渲染，普通变量会丢
  const dragStart = useRef({ x: 0, width: 0 })
  const atLeftEdge = edge === 'left'

  const resizeBy = (delta: number): void => {
    onResize(clamp(dragStart.current.width + delta))
  }

  return (
    <Wrapper
      role="separator"
      aria-orientation="vertical"
      aria-label={ariaLabel ?? copy.resizeAria}
      aria-valuenow={width}
      aria-valuemin={minWidth}
      aria-valuemax={maxWidth}
      tabIndex={0}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId)
        dragStart.current = { x: event.clientX, width }
      }}
      onPointerMove={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
        resizeBy(
          atLeftEdge ? dragStart.current.x - event.clientX : event.clientX - dragStart.current.x
        )
      }}
      onPointerUp={(event) => {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft') {
          event.preventDefault()
          onResize(clamp(width + (atLeftEdge ? KEYBOARD_STEP : -KEYBOARD_STEP)))
        } else if (event.key === 'ArrowRight') {
          event.preventDefault()
          onResize(clamp(width + (atLeftEdge ? -KEYBOARD_STEP : KEYBOARD_STEP)))
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
