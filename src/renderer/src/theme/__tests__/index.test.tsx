import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useThemeStore } from '../../stores/themeStore'
import { DeviceThemeProvider } from '..'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

// 原生外观同步已在主进程侧（boot 恢复 + theme:set-mode 落盘时一并设置）；
// provider 只担 CSS 变量注入链与跟随系统的 matchMedia 监听
describe('页面外观注入链', () => {
  let mediaDark: boolean
  let onMediaChange: (() => void) | undefined

  beforeEach(() => {
    mediaDark = true
    onMediaChange = undefined
    vi.stubGlobal('matchMedia', () => ({
      get matches(): boolean {
        return mediaDark
      },
      addEventListener: (_event: string, listener: () => void): void => {
        onMediaChange = listener
      },
      removeEventListener: (): void => {}
    }))
    useThemeStore.setState({ systemId: 'amber', mode: 'light' })
  })

  it('亮态选择注入 color-scheme 与亮态 token', () => {
    render(<DeviceThemeProvider>设备</DeviceThemeProvider>)
    expect(document.documentElement.style.colorScheme).toBe('light')
    expect(document.documentElement.style.getPropertyValue('--board-bg')).toBe('#f6f4ee')
  })

  it('切黑与跟随系统同链路翻转，系统变化继续更新页面', () => {
    render(<DeviceThemeProvider>设备</DeviceThemeProvider>)
    act(() => useThemeStore.setState({ mode: 'dark' }))
    expect(document.documentElement.style.colorScheme).toBe('dark')
    expect(document.documentElement.style.getPropertyValue('--board-bg')).toBe('#101418')
    act(() => useThemeStore.setState({ mode: 'system' }))
    expect(document.documentElement.style.colorScheme).toBe('dark')
    mediaDark = false
    act(() => onMediaChange?.())
    expect(document.documentElement.style.colorScheme).toBe('light')
    expect(document.documentElement.style.getPropertyValue('--board-bg')).toBe('#f6f4ee')
  })
})
