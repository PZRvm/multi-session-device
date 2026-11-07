import { useRef, useState, useEffect, useId, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import styled from 'styled-components'

/**
 * 设备行图标的悬停气泡（popover）：portal 到 body、fixed 定位——行容器
 * overflow 滚动裁剪不受影响。悬停/键盘聚焦 120ms 意图延迟后出现，离开立即
 * 消失；近顶翻转朝下，水平钳制在视口内。label 为主行（按钮语义），detail
 * 为辅行（禁用原因等）；open 时按钮挂 aria-describedby。
 */
type PopoverIconButtonProps = {
  icon: ReactNode
  /** 气泡主行，同时是按钮的 aria-label */
  label: string
  /** 气泡辅行（如禁用原因）；无则省略 */
  detail?: string | null
  disabled?: boolean
  onClick?: () => void
  /** 忙态槽变体：非交互转圈指示（role=img），气泡展示状态文本 */
  busy?: boolean
}

const SHOW_DELAY_MS = 120
const GAP_PX = 8
const EST_HALF_WIDTH = 120

export const PopoverIconButton = ({
  icon,
  label,
  detail,
  disabled = false,
  onClick,
  busy = false
}: PopoverIconButtonProps): React.JSX.Element => {
  const wrapRef = useRef<HTMLSpanElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [tip, setTip] = useState<{
    centerX: number
    anchorY: number
    below: boolean
  } | null>(null)
  const bubbleId = useId()

  const hide = (): void => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    setTip(null)
  }

  const show = (): void => {
    if (timerRef.current !== null) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      const wrap = wrapRef.current
      if (!wrap) return
      const rect = wrap.getBoundingClientRect()
      const below = rect.top < GAP_PX + 44
      setTip({
        centerX: rect.left + rect.width / 2,
        anchorY: below ? rect.bottom + GAP_PX : rect.top - GAP_PX,
        below
      })
    }, SHOW_DELAY_MS)
  }

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current)
    }
  }, [])

  // 打开期间监听滚动/resize：位置瞬时失效即关闭（不做重定位）
  useEffect(() => {
    if (tip === null) return
    const close = (): void => hide()
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [tip])

  return (
    <span
      ref={wrapRef}
      className="popover-icon-wrap"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {busy ? (
        <span className="busy-slot" role="img" aria-label={label}>
          {icon}
        </span>
      ) : (
        <button
          type="button"
          className="icon-button"
          aria-label={label}
          aria-describedby={tip !== null ? bubbleId : undefined}
          disabled={disabled}
          onClick={onClick}
        >
          {icon}
        </button>
      )}
      {tip !== null
        ? createPortal(
            <Bubble
              id={bubbleId}
              role="tooltip"
              $below={tip.below}
              style={{
                left: Math.min(
                  Math.max(tip.centerX, EST_HALF_WIDTH),
                  window.innerWidth - EST_HALF_WIDTH
                ),
                top: tip.anchorY
              }}
            >
              <span className="tip-label">{label}</span>
              {detail ? <span className="tip-detail">{detail}</span> : null}
            </Bubble>,
            document.body
          )
        : null}
    </span>
  )
}

const Bubble = styled.span<{ $below: boolean }>`
  position: fixed;
  transform: translateX(-50%) ${(props) => (props.$below ? 'translateY(0)' : 'translateY(-100%)')};
  z-index: 1000;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  max-width: 240px;
  padding: 5px 10px;
  border-radius: 6px;
  background: var(--board-ink);
  color: var(--board-bg);
  font-size: 11px;
  line-height: 1.45;
  text-align: center;
  pointer-events: none;
  box-shadow: 0 2px 10px rgb(0 0 0 / 0.25);

  .tip-label {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  }

  .tip-detail {
    opacity: 0.82;
    overflow: hidden;
    text-overflow: ellipsis;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
  }
`
