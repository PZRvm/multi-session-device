import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useThemeStore, type ThemeMode } from '../../stores/themeStore'
import BoardHead from '../BoardHead'
import { MAIN_COPY } from '@shared/i18n'
const copy = MAIN_COPY['zh-CN']

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

  const countText = (): string =>
    screen.getByLabelText(new RegExp(`^${'设备'}`.replace('设备', copy.deviceCount))).textContent ??
    ''

  it('计数文案为「设备」且两位补零：0 → 00、6 → 06', () => {
    const { rerender } = render(<BoardHead count={0} />)
    expect(countText()).toBe(copy.deviceCount + '00')
    rerender(<BoardHead count={6} />)
    expect(countText()).toBe(copy.deviceCount + '06')
  })

  it('计数上限 99：123 → 99', () => {
    render(<BoardHead count={123} />)
    expect(countText()).toBe(copy.deviceCount + '99')
  })

  it.each(['system', 'light', 'dark'] as ThemeMode[])(
    '%s 外观下不出现外观 tab/菜单，开设置不改主题；亮暗切换钮在场但不点不写',
    (mode) => {
      useThemeStore.setState({ mode })
      const open = vi.fn()
      render(<BoardHead count={0} onOpenSettings={open} />)
      expect(screen.queryByRole('radiogroup', { name: '外观模式' })).toBeNull()
      expect(screen.queryByRole('button', { name: /^外观/ })).toBeNull()
      expect(screen.queryByRole('menu')).toBeNull()
      // 左上亮暗切换（switch 角色）+ 右端设置（button），各一个
      expect(screen.getAllByRole('button')).toHaveLength(1)
      expect(screen.getByRole('switch', { name: copy.themeSwitch })).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: copy.settings }))
      expect(open).toHaveBeenCalledTimes(1)
      expect(useThemeStore.getState().mode).toBe(mode)
      expect(writeTheme).not.toHaveBeenCalled()
    }
  )

  it('设置钮缺少开窗入口时禁用', () => {
    render(<BoardHead count={0} />)
    expect(
      (screen.getByRole('button', { name: copy.settings }) as HTMLButtonElement).disabled
    ).toBe(true)
  })

  describe('原生三灯占位', () => {
    it('macOS 不渲染窗口控制钮和页面标题，保留设置入口', () => {
      render(<BoardHead count={0} onOpenSettings={vi.fn()} />)
      for (const label of ['关闭窗口', '最小化窗口', '进入或退出全屏']) {
        expect(screen.queryByRole('button', { name: label })).toBeNull()
      }
      expect(screen.queryByText(copy.appName)).toBeNull()
      expect(screen.getAllByRole('button')).toHaveLength(1)
      expect(screen.getByRole('switch', { name: copy.themeSwitch })).toBeTruthy()
      expect(screen.getByRole('button', { name: copy.settings })).toBeTruthy()
    })

    it.each(['win32', 'linux'])('非 macOS（%s）保留页面标题', (platform) => {
      ;(window as unknown as { api: unknown }).api = { platform }
      render(<BoardHead count={0} />)
      expect(screen.getByText(copy.appName)).toBeTruthy()
      expect(screen.getAllByRole('button')).toHaveLength(1)
      expect(screen.getByRole('switch', { name: copy.themeSwitch })).toBeTruthy()
    })
  })

  describe('左上亮暗快速切换', () => {
    it('当前暗（显式 dark）：aria-checked 为真，点击写 light 并翻回', () => {
      useThemeStore.setState({ mode: 'dark' })
      render(<BoardHead count={0} />)
      const toggle = screen.getByRole('switch', { name: copy.themeSwitch })
      expect(toggle.getAttribute('aria-checked')).toBe('true')
      expect(toggle.title).toBe(copy.toggleLight)
      fireEvent.click(toggle)
      expect(writeTheme).toHaveBeenCalledWith('light')
      expect(useThemeStore.getState().mode).toBe('light')
      // 乐观更新后 aria-checked 翻回假，动作提示翻转为切黑夜
      expect(
        screen.getByRole('switch', { name: copy.themeSwitch }).getAttribute('aria-checked')
      ).toBe('false')
      expect(screen.getByRole('switch', { name: copy.themeSwitch }).title).toBe(copy.toggleDark)
    })

    it('当前亮（system 且 jsdom 无 matchMedia 回落亮）：aria-checked 为假，点击写 dark', () => {
      useThemeStore.setState({ mode: 'system' })
      render(<BoardHead count={0} />)
      const toggle = screen.getByRole('switch', { name: copy.themeSwitch })
      expect(toggle.getAttribute('aria-checked')).toBe('false')
      fireEvent.click(toggle)
      expect(writeTheme).toHaveBeenCalledWith('dark')
      expect(useThemeStore.getState().mode).toBe('dark')
    })

    it('显式 light：aria-checked 为假，点击写 dark 后翻转为真', () => {
      useThemeStore.setState({ mode: 'light' })
      render(<BoardHead count={0} />)
      const toggle = screen.getByRole('switch', { name: copy.themeSwitch })
      expect(toggle.getAttribute('aria-checked')).toBe('false')
      fireEvent.click(toggle)
      expect(writeTheme).toHaveBeenCalledWith('dark')
      expect(
        screen.getByRole('switch', { name: copy.themeSwitch }).getAttribute('aria-checked')
      ).toBe('true')
    })
  })
})
