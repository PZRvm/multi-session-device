import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useThemeStore } from '../../stores/themeStore'
import BoardHead from '../BoardHead'

// vitest 未开 globals，RTL 的自动 cleanup 不注册——显式清理防多次 render 堆叠
afterEach(cleanup)

describe('BoardHead', () => {
  beforeEach(() => {
    window.localStorage.clear()
    useThemeStore.setState({ systemId: 'amber', mode: 'system' })
    ;(window as unknown as { api: unknown }).api = { platform: 'darwin' }
  })

  const countText = (): string => screen.getByLabelText(/^会话/).textContent ?? ''

  it('计数两位补零：0 → 00、6 → 06', () => {
    const { rerender } = render(<BoardHead count={0} />)
    expect(countText()).toBe('会话00')
    rerender(<BoardHead count={6} />)
    expect(countText()).toBe('会话06')
  })

  it('计数上限 99：123 → 99', () => {
    render(<BoardHead count={123} />)
    expect(countText()).toBe('会话99')
  })

  it('主题钮循环三态：跟随系统 → 亮 → 暗 → 跟随系统', () => {
    render(<BoardHead count={0} />)
    const button = screen.getByRole('button', { name: '外观：跟随系统' })
    fireEvent.click(button)
    expect(useThemeStore.getState().mode).toBe('light')
    expect(screen.getByRole('button', { name: '外观：亮' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '外观：亮' }))
    expect(useThemeStore.getState().mode).toBe('dark')
    fireEvent.click(screen.getByRole('button', { name: '外观：暗' }))
    expect(useThemeStore.getState().mode).toBe('system')
  })

  it('设置钮禁用占位（stage 05 接入）', () => {
    render(<BoardHead count={0} />)
    expect((screen.getByRole('button', { name: '设置' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('darwin 渲染三灯占位，非 darwin 渲染页内标题', () => {
    const { rerender } = render(<BoardHead count={0} />)
    expect(document.querySelector('span[aria-hidden]')).toBeTruthy()

    ;(window as unknown as { api: unknown }).api = { platform: 'win32' }
    rerender(<BoardHead count={0} />)
    expect(screen.getByText('多会话设备')).toBeTruthy()
  })
})
