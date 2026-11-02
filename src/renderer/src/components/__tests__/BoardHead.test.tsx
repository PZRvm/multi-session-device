import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useThemeStore, type ThemeMode } from '../../stores/themeStore'
import BoardHead from '../BoardHead'
import { MAIN_COPY, SETTINGS_COPY } from '@shared/i18n'
const copy = MAIN_COPY['zh-CN']
const settingsCopy = SETTINGS_COPY['zh-CN']

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
    const { rerender } = render(<BoardHead count={0} compact />)
    expect(countText()).toBe(copy.deviceCount + '00')
    rerender(<BoardHead count={6} compact />)
    expect(countText()).toBe(copy.deviceCount + '06')
  })

  it('计数上限 99：123 → 99', () => {
    render(<BoardHead count={123} compact />)
    expect(countText()).toBe(copy.deviceCount + '99')
  })

  it.each(['system', 'light', 'dark'] as ThemeMode[])(
    '%s 外观下不出现外观 tab/独立菜单，开设置不改主题；紧凑触发钮在场但不点不写',
    (mode) => {
      useThemeStore.setState({ mode })
      const open = vi.fn()
      render(<BoardHead count={0} compact onOpenSettings={open} />)
      expect(screen.queryByRole('radiogroup', { name: '外观模式' })).toBeNull()
      expect(screen.queryByRole('button', { name: /^外观/ })).toBeNull()
      // 菜单未展开：不出现 menu 角色
      expect(screen.queryByRole('menu')).toBeNull()
      // 紧凑触发钮 + 右端设置，共两个按钮
      expect(screen.getAllByRole('button')).toHaveLength(2)
      const trigger = screen.getByRole('button', { name: copy.themeSwitch })
      expect(trigger.getAttribute('aria-haspopup')).toBe('menu')
      expect(trigger.getAttribute('aria-expanded')).toBe('false')
      fireEvent.click(screen.getByRole('button', { name: copy.settings }))
      expect(open).toHaveBeenCalledTimes(1)
      expect(useThemeStore.getState().mode).toBe(mode)
      expect(writeTheme).not.toHaveBeenCalled()
    }
  )

  it('设置钮缺少开窗入口时禁用', () => {
    render(<BoardHead count={0} compact />)
    expect(
      (screen.getByRole('button', { name: copy.settings }) as HTMLButtonElement).disabled
    ).toBe(true)
  })

  describe('原生三灯占位', () => {
    it('macOS 不渲染窗口控制钮和页面标题，保留设置入口', () => {
      render(<BoardHead count={0} compact onOpenSettings={vi.fn()} />)
      for (const label of ['关闭窗口', '最小化窗口', '进入或退出全屏']) {
        expect(screen.queryByRole('button', { name: label })).toBeNull()
      }
      expect(screen.queryByText(copy.appName)).toBeNull()
      expect(screen.getAllByRole('button')).toHaveLength(2)
      expect(screen.getByRole('button', { name: copy.settings })).toBeTruthy()
      expect(screen.getByRole('button', { name: copy.themeSwitch })).toBeTruthy()
    })

    // 双标题去重（plan 2026-10-23-windows-settings-finish）：非 mac 标题由系统
    // 标题栏承担，板头不再渲染应用名——改写自原「保留页面标题」用例（规格变更）
    it.each(['win32', 'linux'])('非 macOS（%s）不渲染页面标题（标题归系统标题栏）', (platform) => {
      ;(window as unknown as { api: unknown }).api = { platform }
      render(<BoardHead count={0} compact />)
      expect(screen.queryByText(copy.appName)).toBeNull()
      expect(screen.getAllByRole('button')).toHaveLength(2)
    })
  })

  describe('外观选择（共用 AppearanceModePicker）', () => {
    it.each([
      ['system', false, 'monitor'],
      ['system', true, 'monitor'],
      ['light', true, 'sun'],
      ['dark', false, 'moon']
    ] as const)('紧凑态 %s / 系统暗色 %s 显示 %s 图标', (mode, prefersDark, icon) => {
      vi.stubGlobal(
        'matchMedia',
        vi.fn().mockReturnValue({
          matches: prefersDark,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn()
        })
      )
      useThemeStore.setState({ mode })
      try {
        render(<BoardHead count={0} compact />)
        const trigger = screen.getByRole('button', { name: copy.themeSwitch })
        expect(trigger.querySelector(`svg.lucide-${icon}`)).toBeTruthy()
      } finally {
        vi.unstubAllGlobals()
      }
    })

    it('紧凑态（compact）：触发钮展开菜单，三态单选当前高亮，选中即写 store 并收起', () => {
      useThemeStore.setState({ mode: 'system' })
      render(<BoardHead count={0} compact />)
      const trigger = screen.getByRole('button', { name: copy.themeSwitch })
      fireEvent.click(trigger)
      expect(trigger.getAttribute('aria-expanded')).toBe('true')
      const menu = screen.getByRole('menu', { name: copy.themeSwitch })
      const items = [...menu.querySelectorAll('button[role="menuitemradio"]')]
      expect(items.map((item) => item.textContent)).toEqual([
        settingsCopy.system,
        settingsCopy.light,
        settingsCopy.dark
      ])
      expect(items[0].getAttribute('aria-checked')).toBe('true')
      fireEvent.click(items[1])
      expect(writeTheme).toHaveBeenCalledWith('light')
      expect(useThemeStore.getState().mode).toBe('light')
      expect(trigger.querySelector('svg.lucide-sun')).toBeTruthy()
      // 选中后菜单收起
      expect(screen.queryByRole('menu')).toBeNull()
    })

    it('紧凑态：Esc 关闭菜单，触发钮 aria-expanded 归位', () => {
      render(<BoardHead count={0} compact />)
      fireEvent.click(screen.getByRole('button', { name: copy.themeSwitch }))
      expect(screen.getByRole('menu')).toBeTruthy()
      fireEvent.keyDown(document, { key: 'Escape' })
      expect(screen.queryByRole('menu')).toBeNull()
      expect(document.activeElement).toBe(screen.getByRole('button', { name: copy.themeSwitch }))
    })

    it('紧凑态：点击组件外关闭菜单', () => {
      render(<BoardHead count={0} compact />)
      fireEvent.click(screen.getByRole('button', { name: copy.themeSwitch }))
      fireEvent.pointerDown(document.body)
      expect(screen.queryByRole('menu')).toBeNull()
      expect(
        screen.getByRole('button', { name: copy.themeSwitch }).getAttribute('aria-expanded')
      ).toBe('false')
    })

    it('宽态（compact=false）：分段直选三态，aria-pressed 跟随且选中即写 store', () => {
      useThemeStore.setState({ mode: 'light' })
      render(<BoardHead count={0} compact={false} />)
      const group = screen.getByRole('group', { name: settingsCopy.appearance })
      const buttons = [...group.querySelectorAll('button')]
      expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual([
        settingsCopy.system,
        settingsCopy.light,
        settingsCopy.dark
      ])
      expect(buttons.map((button) => button.getAttribute('aria-pressed'))).toEqual([
        'false',
        'true',
        'false'
      ])
      fireEvent.click(buttons[2])
      expect(writeTheme).toHaveBeenCalledWith('dark')
      expect(useThemeStore.getState().mode).toBe('dark')
      expect(buttons[2].getAttribute('aria-pressed')).toBe('true')
    })
  })
})
