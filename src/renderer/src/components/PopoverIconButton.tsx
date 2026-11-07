import { useRef, useState, useEffect, useId, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import styled from 'styled-components'

/**
 * 设备行图标的悬停气泡（popover）：portal 到 body、fixed 定位——行容器
 * overflow 滚动裁剪不受影响。悬停/键盘聚焦 120ms 意图延迟后出现，离开立即
 * 消失。固定显示在图标下方并带朝上箭头；仅当下缘空间不足时才翻转到上方
 * （箭头随向翻转）。气泡主行是短动作词（如「休眠」「停止」）；禁用原因经
 * detail 辅行呈现——原生 title 对禁用钮在部分浏览器不显示。aria 与气泡文案
 * 分离：ariaLabel 保留完整语义（含设备名），open 时挂 aria-describedby。
 */
type PopoverIconButtonProps = {
  icon: ReactNode
  /** 气泡主行：短动作词（如「休眠」） */
  label: string
  /** 按钮无障碍名（完整语义，如「休眠 Pixel 8」）；缺省同 label */
  ariaLabel?: string
  /** 气泡辅行（如禁用原因）；无则省略 */
  detail?: string | null
  disabled?: boolean
  onClick?: () => void
  /** 忙态槽变体：非交互转圈指示（role=img），气泡展示状态文本 */
  busy?: boolean
}

const SHOW_DELAY_MS = 120
const GAP_PX = 8
const EST_HALF_WIDTH = 90
const EST_HEIGHT = 52

export const PopoverIconButton = ({
  icon,
  label,
  ariaLabel,
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
      // 固定在图标下方；下缘放不下完整气泡才翻到上方
      const below = window.innerHeight - rect.bottom >= EST_HEIGHT + GAP_PX
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

  const accessibleName = ariaLabel ?? label

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
        <span className="busy-slot" role="img" aria-label={accessibleName}>
          {icon}
        </span>
      ) : (
        <button
          type="button"
          className="icon-button"
          aria-label={accessibleName}
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
  transform: translateX(-50%);
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

  /* 箭头：默认气泡在图标下方、箭头朝上指；翻转（气泡在上）时箭头朝下 */
  &::before {
    content: '';
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    width: 0;
    height: 0;
    border-left: 5px solid transparent;
    border-right: 5px solid transparent;
    ${(props) =>
      props.$below
        ? 'top: -5px; border-bottom: 5px solid var(--board-ink);'
        : 'bottom: -5px; border-top: 5px solid var(--board-ink);'}
  }

  .tip-label {
    font-weight: 600;
    white-space: nowrap;
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
