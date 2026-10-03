import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useThemeStore, type ThemeMode } from '../../stores/themeStore'
import BoardHead from '../BoardHead'

// vitest 未开 globals，RTL 的自动 cleanup 不注册——显式清理防多次 render 堆叠
afterEach(cleanup)

describe('BoardHead', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.localStorage.clear()
    useThemeStore.setState({ systemId: 'amber', mode: 'system' })
    ;(window as unknown as { api: unknown }).api = {
      platform: 'darwin'
    }
  })

  const countText = (): string => screen.getByLabelText(/^设备/).textContent ?? ''

  it('计数文案为「设备」且两位补零：0 → 00、6 → 06', () => {
    const { rerender } = render(<BoardHead count={0} panelWidth={280} />)
    expect(countText()).toBe('设备00')
    rerender(<BoardHead count={6} panelWidth={280} />)
    expect(countText()).toBe('设备06')
  })

  it('计数上限 99：123 → 99', () => {
    render(<BoardHead count={123} panelWidth={280} />)
    expect(countText()).toBe('设备99')
  })

  describe('窄态（panelWidth < 390）：图标钮 + 弹出菜单', () => {
    it('窄态不渲染分段组，按钮显示当前态图标语义', () => {
      render(<BoardHead count={0} panelWidth={280} />)
      expect(screen.queryByRole('radiogroup', { name: '外观模式' })).toBeNull()
      expect(screen.getByRole('button', { name: '外观：跟随系统' })).toBeTruthy()
    })

    it('点击展开菜单：三行 跟随系统/白天/黑夜，当前行 aria-checked', () => {
      render(<BoardHead count={0} panelWidth={280} />)
      fireEvent.click(screen.getByRole('button', { name: '外观：跟随系统' }))
      const menu = screen.getByRole('menu', { name: '外观模式' })
      expect(menu).toBeTruthy()
      expect(
        screen.getByRole('menuitemradio', { name: '跟随系统' }).getAttribute('aria-checked')
      ).toBe('true')
      expect(screen.getByRole('menuitemradio', { name: '白天' }).getAttribute('aria-checked')).toBe(
        'false'
      )
      expect(screen.getByRole('menuitemradio', { name: '黑夜' }).getAttribute('aria-checked')).toBe(
        'false'
      )
    })

    it('菜单选「白天」：mode 切换、菜单收起', () => {
      render(<BoardHead count={0} panelWidth={280} />)
      fireEvent.click(screen.getByRole('button', { name: '外观：跟随系统' }))
      fireEvent.click(screen.getByRole('menuitemradio', { name: '白天' }))
      expect(useThemeStore.getState().mode).toBe<ThemeMode>('light')
      expect(screen.queryByRole('menu')).toBeNull()
      expect(screen.getByRole('button', { name: '外观：白天' })).toBeTruthy()
    })

    it('Esc 收起菜单且不改 mode', () => {
      render(<BoardHead count={0} panelWidth={280} />)
      fireEvent.click(screen.getByRole('button', { name: '外观：跟随系统' }))
      fireEvent.keyDown(document, { key: 'Escape' })
      expect(screen.queryByRole('menu')).toBeNull()
      expect(useThemeStore.getState().mode).toBe<ThemeMode>('system')
    })
  })

  describe('宽态（panelWidth ≥ 340）：三段分段', () => {
    it('渲染分段组，当前态 aria-checked，点选即切', () => {
      render(<BoardHead count={0} panelWidth={340} />)
      const group = screen.getByRole('radiogroup', { name: '外观模式' })
      expect(group).toBeTruthy()
      expect(screen.queryByRole('menu')).toBeNull()
      expect(screen.getByRole('radio', { name: '跟随系统' }).getAttribute('aria-checked')).toBe(
        'true'
      )
      fireEvent.click(screen.getByRole('radio', { name: '黑夜' }))
      expect(useThemeStore.getState().mode).toBe<ThemeMode>('dark')
      expect(screen.getByRole('radio', { name: '黑夜' }).getAttribute('aria-checked')).toBe('true')
    })

    it('340 阈值边界：339 窄态、340 宽态', () => {
      const { rerender } = render(<BoardHead count={0} panelWidth={339} />)
      expect(screen.queryByRole('radiogroup', { name: '外观模式' })).toBeNull()
      rerender(<BoardHead count={0} panelWidth={340} />)
      expect(screen.getByRole('radiogroup', { name: '外观模式' })).toBeTruthy()
    })
  })

  it('设置钮禁用占位（stage 05 接入）', () => {
    render(<BoardHead count={0} panelWidth={280} />)
    expect((screen.getByRole('button', { name: '设置' }) as HTMLButtonElement).disabled).toBe(true)
  })

  describe('原生三灯占位', () => {
    it('macOS 不渲染窗口控制钮和页面标题，外观与设置仍可用', () => {
      render(<BoardHead count={0} panelWidth={280} />)
      for (const label of ['关闭窗口', '最小化窗口', '进入或退出全屏']) {
        expect(screen.queryByRole('button', { name: label })).toBeNull()
      }
      expect(screen.queryByText('多会话设备')).toBeNull()
      expect(screen.getAllByRole('button')).toHaveLength(2)
      expect(screen.getByRole('button', { name: '外观：跟随系统' })).toBeTruthy()
      expect(screen.getByRole('button', { name: '设置' })).toBeTruthy()
    })

    it.each(['win32', 'linux'])('非 macOS（%s）保留页面标题', (platform) => {
      ;(window as unknown as { api: unknown }).api = { platform }
      render(<BoardHead count={0} panelWidth={280} />)
      expect(screen.getByText('多会话设备')).toBeTruthy()
      expect(screen.getAllByRole('button')).toHaveLength(2)
    })
  })
})
