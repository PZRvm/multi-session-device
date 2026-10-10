import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Device } from '@shared/types'
import { useScreenshot } from '../useScreenshot'

const capture =
  vi.fn<(id: string) => Promise<{ pngBase64: string; width: number; height: number }>>()
const save = vi.fn<(id: string) => Promise<{ fileName: string }>>()

const device = (status: Device['status']): Device =>
  ({ id: 'd1', name: '测试设备', status }) as unknown as Device

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  ;(window as { api?: unknown }).api = {
    screenshot: { capture, save }
  }
})

afterEach(() => {
  vi.useRealTimers()
  cleanup()
  delete (window as { api?: unknown }).api
})

describe('useScreenshot', () => {
  it('capture 成功：capturing → copied，缩略图带 data 前缀，busy 随阶段翻转', async () => {
    capture.mockResolvedValue({ pngBase64: 'QUJD', width: 1080, height: 2340 })
    const { result } = renderHook(() => useScreenshot(device('running')))
    expect(result.current.state.phase).toBe('idle')
    let pending: Promise<void> | null = null
    act(() => {
      pending = result.current.capture()
    })
    expect(result.current.state.phase).toBe('capturing')
    expect(result.current.busy).toBe(true)
    await act(async () => {
      await pending
    })
    expect(result.current.state).toEqual({
      phase: 'copied',
      thumbnail: 'data:image/png;base64,QUJD'
    })
    expect(result.current.busy).toBe(false)
  })

  it('capture 失败：error 态携带主进程文案且无缩略图', async () => {
    capture.mockRejectedValue(new Error('screenshotDeviceNotRunning'))
    const { result } = renderHook(() => useScreenshot(device('running')))
    await act(async () => {
      await result.current.capture()
    })
    expect(result.current.state).toEqual({
      phase: 'error',
      message: 'screenshotDeviceNotRunning',
      thumbnail: null
    })
  })

  it('save 流程：copied → saving → saved（文件名回填）；非 copied 态 save 是空操作', async () => {
    capture.mockResolvedValue({ pngBase64: 'QUJD', width: 1, height: 1 })
    save.mockResolvedValue({ fileName: '测试设备-20261010-130509.png' })
    const { result } = renderHook(() => useScreenshot(device('running')))
    await act(async () => {
      await result.current.save()
    })
    expect(save).not.toHaveBeenCalled()
    await act(async () => {
      await result.current.capture()
    })
    save.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({ fileName: 'f.png' }), 50))
    )
    let pending: Promise<void> | null = null
    act(() => {
      pending = result.current.save()
    })
    expect(result.current.state.phase).toBe('saving')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60)
      await pending
    })
    expect(result.current.state).toEqual({
      phase: 'saved',
      thumbnail: 'data:image/png;base64,QUJD',
      fileName: 'f.png'
    })
  })

  it('save 失败：error 态保留原缩略图', async () => {
    capture.mockResolvedValue({ pngBase64: 'QUJD', width: 1, height: 1 })
    save.mockRejectedValue(new Error('screenshotSaveFailed:…'))
    const { result } = renderHook(() => useScreenshot(device('running')))
    await act(async () => {
      await result.current.capture()
    })
    await act(async () => {
      await result.current.save()
    })
    expect(result.current.state).toEqual({
      phase: 'error',
      message: 'screenshotSaveFailed:…',
      thumbnail: 'data:image/png;base64,QUJD'
    })
  })

  it('copied 后 10 秒自动消失；新截屏重置计时', async () => {
    capture.mockResolvedValue({ pngBase64: 'QUJD', width: 1, height: 1 })
    const { result } = renderHook(() => useScreenshot(device('running')))
    await act(async () => {
      await result.current.capture()
    })
    act(() => {
      vi.advanceTimersByTime(9_900)
    })
    expect(result.current.state.phase).toBe('copied')
    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(result.current.state.phase).toBe('idle')
    await act(async () => {
      await result.current.capture()
    })
    act(() => {
      vi.advanceTimersByTime(9_900)
    })
    expect(result.current.state.phase).toBe('copied')
  })

  it('设备离开 running：气泡立即收起', async () => {
    capture.mockResolvedValue({ pngBase64: 'QUJD', width: 1, height: 1 })
    const { result, rerender } = renderHook(({ status }) => useScreenshot(device(status)), {
      initialProps: { status: 'running' as Device['status'] }
    })
    await act(async () => {
      await result.current.capture()
    })
    expect(result.current.state.phase).toBe('copied')
    rerender({ status: 'stopping' })
    expect(result.current.state.phase).toBe('idle')
  })
})
