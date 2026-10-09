import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useThemeStore, type ThemeMode } from '../../stores/themeStore'
import BoardHead from '../BoardHead'

afterEach(cleanup)

describe('BoardHead', () => {
  const writeTheme = vi.fn().mockResolvedValue(undefined)
  beforeEach(() => {
    vi.clearAllMocks()
    useThemeStore.setState({ systemId: 'amber', mode: 'system' })
    ;(window as unknown as { api: unknown }).api = {
      platform: 'darwin',
      theme: { setMode: writeTheme, setSystemId: writeTheme }
    }
  })

  const countText = (): string => screen.getByLabelText(/^设备/).textContent ?? ''

  it('计数文案为「设备」且两位补零：0 → 00、6 → 06', () => {
    const { rerender } = render(<BoardHead count={0} />)
    expect(countText()).toBe('设备00')
    rerender(<BoardHead count={6} />)
    expect(countText()).toBe('设备06')
  })

  it('计数上限 99：123 → 99', () => {
    render(<BoardHead count={123} />)
    expect(countText()).toBe('设备99')
  })

  it.each(['system', 'light', 'dark'] as ThemeMode[])(
    '%s 外观下均隐藏顶部外观 tab 和菜单入口，开设置不改主题',
    (mode) => {
      useThemeStore.setState({ mode })
      const open = vi.fn()
      render(<BoardHead count={0} onOpenSettings={open} />)
      expect(screen.queryByRole('radiogroup', { name: '外观模式' })).toBeNull()
      expect(screen.queryByRole('button', { name: /^外观/ })).toBeNull()
      expect(screen.queryByRole('menu')).toBeNull()
      expect(screen.getAllByRole('button')).toHaveLength(1)
      fireEvent.click(screen.getByRole('button', { name: '设置' }))
      expect(open).toHaveBeenCalledTimes(1)
      expect(useThemeStore.getState().mode).toBe(mode)
      expect(writeTheme).not.toHaveBeenCalled()
    }
  )

  it('设置钮缺少开窗入口时禁用', () => {
    render(<BoardHead count={0} />)
    expect((screen.getByRole('button', { name: '设置' }) as HTMLButtonElement).disabled).toBe(true)
  })

  describe('原生三灯占位', () => {
    it('macOS 不渲染窗口控制钮和页面标题，保留设置入口', () => {
      render(<BoardHead count={0} onOpenSettings={vi.fn()} />)
      for (const label of ['关闭窗口', '最小化窗口', '进入或退出全屏']) {
        expect(screen.queryByRole('button', { name: label })).toBeNull()
      }
      expect(screen.queryByText('多会话设备')).toBeNull()
      expect(screen.getAllByRole('button')).toHaveLength(1)
      expect(screen.getByRole('button', { name: '设置' })).toBeTruthy()
    })

    it.each(['win32', 'linux'])('非 macOS（%s）保留页面标题', (platform) => {
      ;(window as unknown as { api: unknown }).api = { platform }
      render(<BoardHead count={0} />)
      expect(screen.getByText('多会话设备')).toBeTruthy()
      expect(screen.getAllByRole('button')).toHaveLength(1)
    })
  })
})
