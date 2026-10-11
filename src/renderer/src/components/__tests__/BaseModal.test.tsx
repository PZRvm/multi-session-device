// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import BaseModal from '../BaseModal'

afterEach(cleanup)

describe('BaseModal 原语（plan 2026-10-12-reconcile-report-panel）', () => {
  it('aria 与标题关联；打开时 focus 入面板、body 滚动锁定', () => {
    const { container } = render(
      <BaseModal title="面板标题" onClose={vi.fn()}>
        内容
      </BaseModal>
    )
    const panel = screen.getByRole('dialog')
    expect(panel.getAttribute('aria-modal')).toBe('true')
    expect(panel.getAttribute('aria-labelledby')).toBe('base-modal-title')
    expect(screen.getByText('面板标题')).toBeTruthy()
    expect(document.activeElement).toBe(panel)
    expect(document.body.style.overflow).toBe('hidden')
    expect(container).toBeTruthy()
  })

  it('Esc 与点击遮罩自身关闭；点面板内容不关；卸载还原 body 滚动与触发元素焦点', () => {
    const trigger = document.createElement('button')
    document.body.appendChild(trigger)
    trigger.focus()
    const onClose = vi.fn()
    const { unmount } = render(
      <BaseModal title="T" onClose={onClose}>
        <p>正文</p>
      </BaseModal>
    )
    fireEvent.click(screen.getByText('正文'))
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('dialog').parentElement as HTMLElement)
    expect(onClose).toHaveBeenCalledTimes(2)
    unmount()
    expect(document.body.style.overflow).toBe('')
    expect(document.activeElement).toBe(trigger)
    trigger.remove()
  })

  it('右上 × 与 footer 动作区渲染', () => {
    render(
      <BaseModal title="T" onClose={vi.fn()} footer={<button type="button">关闭</button>}>
        body
      </BaseModal>
    )
    expect(screen.getByText('关闭')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '×' }))
    // onClose 由外层提供——此处仅断言按钮可达
    expect(screen.getByRole('dialog')).toBeTruthy()
  })
})
