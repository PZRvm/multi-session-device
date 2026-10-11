import { useEffect, useRef } from 'react'
import styled from 'styled-components'

export interface BaseModalProps {
  /** 面板标题（aria-labelledby 挂到标题元素） */
  title: string
  onClose: () => void
  children: React.ReactNode
  /** 底部动作区（按钮行）；内容型面板可空 */
  footer?: React.ReactNode
}

/**
 * 主窗首个自绘弹层原语（plan 2026-10-12-reconcile-report-panel）：
 * 全屏遮罩 + 居中面板、内容区独立滚动。关闭语义（设计轴 3）：Esc 与点击遮罩
 * 自身都可关（纯浏览无丢失风险）；点面板不关。focus：打开时移入面板、关闭后
 * 还原触发元素；Tab 收口做最小实现（面板内循环，无表单不追求完整 trap）。
 * body 滚动锁定挂载期间生效。危险区确认词等后续弹层家族复用本原语。
 */
const BaseModal = ({ title, onClose, children, footer }: BaseModalProps): React.JSX.Element => {
  const panelRef = useRef<HTMLDivElement>(null)
  const restoreFocusRef = useRef<Element | null>(null)

  useEffect(() => {
    restoreFocusRef.current = document.activeElement
    panelRef.current?.focus()
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
      const target = restoreFocusRef.current
      if (target instanceof HTMLElement) target.focus()
    }
  }, [])

  return (
    <Veil
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <Panel
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="base-modal-title"
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation()
            onClose()
          }
        }}
      >
        <header className="modal-header">
          <h2 id="base-modal-title">{title}</h2>
          <button type="button" className="modal-close" aria-label="×" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer !== undefined ? <footer className="modal-footer">{footer}</footer> : null}
      </Panel>
    </Veil>
  )
}

const Veil = styled.div`
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.4);
`

const Panel = styled.div`
  display: flex;
  flex-direction: column;
  width: min(560px, 92vw);
  height: min(480px, 84vh);
  border: 1px solid var(--board-control-line);
  border-radius: 0;
  background: var(--board-bg-raised);
  color: var(--board-ink);
  outline: none;

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 16px;
    border-bottom: 1px solid var(--board-hairline);
    flex: none;

    h2 {
      margin: 0;
      font-size: 14px;
      font-weight: 600;
    }
  }

  .modal-close {
    min-width: 26px;
    min-height: 26px;
    padding: 0;
    border: 1px solid var(--board-control-line);
    background: transparent;
    color: var(--board-ink);
    font-size: 15px;
    line-height: 1;
    cursor: pointer;
  }

  .modal-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 14px 16px;
  }

  .modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 10px 16px;
    border-top: 1px solid var(--board-hairline);
    flex: none;
  }
`

export default BaseModal
