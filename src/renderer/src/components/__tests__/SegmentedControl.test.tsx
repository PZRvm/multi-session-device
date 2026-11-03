import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import SegmentedControl from '../SegmentedControl'

// vitest 未开 globals，RTL 的自动 cleanup 不注册——显式清理防多次 render 堆叠
afterEach(cleanup)

const options = [
  { value: 'system', label: '跟随系统' },
  { value: 'light', label: '亮' },
  { value: 'dark', label: '暗' }
] as const

type Mode = (typeof options)[number]['value']

const seg = (label: string): HTMLElement => screen.getByRole('radio', { name: label })

describe('SegmentedControl', () => {
  it('渲染 radiogroup：选中瓣 aria-checked + tabIndex 0，其余瓣 -1', () => {
    render(
      <SegmentedControl options={options} value="system" onChange={vi.fn()} ariaLabel="外观模式" />
    )
    expect(seg('跟随系统').getAttribute('aria-checked')).toBe('true')
    expect(seg('跟随系统').tabIndex).toBe(0)
    expect(seg('亮').getAttribute('aria-checked')).toBe('false')
    expect(seg('亮').tabIndex).toBe(-1)
    expect(seg('暗').tabIndex).toBe(-1)
  })

  it('点击瓣回调 onChange', () => {
    const onChange = vi.fn<(v: Mode) => void>()
    render(
      <SegmentedControl options={options} value="system" onChange={onChange} ariaLabel="外观模式" />
    )
    fireEvent.click(seg('暗'))
    expect(onChange).toHaveBeenCalledWith('dark')
  })

  // 受控组件：镜像真实用法（App 把 store 值喂回 value），键盘测试必须有状态回灌
  function Harness({ initialValue = 'system' }: { initialValue?: Mode }): React.JSX.Element {
    const [value, setValue] = useState<Mode>(initialValue)
    return (
      <SegmentedControl options={options} value={value} onChange={setValue} ariaLabel="外观模式" />
    )
  }

  it('方向键 = 选值 + 搬焦点一体（issue 2026-10-03-segmented-roving-focus 的修复验证）', () => {
    render(<Harness />)
    seg('跟随系统').focus()
    fireEvent.keyDown(seg('跟随系统'), { key: 'ArrowRight' })
    expect(seg('亮').getAttribute('aria-checked')).toBe('true')
    expect(document.activeElement).toBe(seg('亮'))
  })

  it('方向键循环 wrap：首瓣左键到末瓣，焦点同步', () => {
    render(<Harness />)
    seg('跟随系统').focus()
    fireEvent.keyDown(seg('跟随系统'), { key: 'ArrowLeft' })
    expect(seg('暗').getAttribute('aria-checked')).toBe('true')
    expect(document.activeElement).toBe(seg('暗'))
  })

  it('连按方向键：焦点始终跟随新选中瓣', () => {
    render(<Harness />)
    seg('跟随系统').focus()
    fireEvent.keyDown(seg('跟随系统'), { key: 'ArrowRight' })
    fireEvent.keyDown(seg('亮'), { key: 'ArrowRight' })
    expect(seg('暗').getAttribute('aria-checked')).toBe('true')
    expect(document.activeElement).toBe(seg('暗'))
  })
})
