import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ThemeMode } from '@shared/types'
import { useThemeStore } from '../../stores/themeStore'
import { DeviceThemeProvider } from '..'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('原生与页面外观同步', () => {
  const setNativeMode = vi.fn<(mode: ThemeMode) => Promise<void>>()
  let mediaDark: boolean
  let onMediaChange: (() => void) | undefined

  beforeEach(() => {
    setNativeMode.mockReset().mockResolvedValue(undefined)
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
    ;(window as unknown as { api: unknown }).api = {
      platform: 'darwin',
      theme: { setMode: setNativeMode }
    }
    useThemeStore.setState({ systemId: 'amber', mode: 'light' })
  })

  it('恢复白天选择时，即使系统深色也同步原生为 light', () => {
    render(<DeviceThemeProvider>设备</DeviceThemeProvider>)
    expect(document.documentElement.style.colorScheme).toBe('light')
    expect(setNativeMode).toHaveBeenCalledWith('light')
  })

  it('切换黑夜与跟随系统时同步原值，系统变化继续更新页面', () => {
    render(<DeviceThemeProvider>设备</DeviceThemeProvider>)
    act(() => useThemeStore.getState().setMode('dark'))
    expect(setNativeMode).toHaveBeenLastCalledWith('dark')
    expect(document.documentElement.style.colorScheme).toBe('dark')
    act(() => useThemeStore.getState().setMode('system'))
    expect(setNativeMode).toHaveBeenLastCalledWith('system')
    mediaDark = false
    act(() => onMediaChange?.())
    expect(document.documentElement.style.colorScheme).toBe('light')
  })

  it('非 macOS 沿用页面外观，不同步原生主题', () => {
    ;(window as unknown as { api: unknown }).api = { platform: 'win32' }
    render(<DeviceThemeProvider>设备</DeviceThemeProvider>)
    expect(document.documentElement.style.colorScheme).toBe('light')
    expect(setNativeMode).not.toHaveBeenCalled()
  })

  it('同步失败时记录错误，不泄漏未处理的拒绝', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
    setNativeMode.mockRejectedValueOnce(new Error('同步失败'))
    render(<DeviceThemeProvider>设备</DeviceThemeProvider>)
    await waitFor(() => expect(errorLog).toHaveBeenCalledWith('同步原生外观失败:', '同步失败'))
  })
})
