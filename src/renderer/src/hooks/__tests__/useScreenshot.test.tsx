import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Device } from '@shared/types'
import { useScreenshot } from '../useScreenshot'

const capture =
  vi.fn<(id: string) => Promise<{ pngBase64: string; width: number; height: number }>>()
const save = vi.fn<(id: string) => Promise<{ fileName: string }>>()
const openEditor = vi.fn<(id: string) => Promise<void>>()

const device = (status: Device['status']): Device =>
  ({ id: 'd1', name: '测试设备', status }) as unknown as Device

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  ;(window as { api?: unknown }).api = {
    screenshot: { capture, save, openEditor }
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

  it('error 态不自动消失：60s 后仍在，dismiss 可手动收起', async () => {
    capture.mockRejectedValueOnce(new Error('boom'))
    const { result } = renderHook(() => useScreenshot(device('running')))
    await act(async () => {
      await result.current.capture()
    })
    expect(result.current.state.phase).toBe('error')
    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    expect(result.current.state.phase).toBe('error')
    act(() => {
      result.current.dismiss()
    })
    expect(result.current.state.phase).toBe('idle')
  })

  it('save 进行中自动消失计时被清除：超过原 10s 期限仍停在 saving 并正常完成', async () => {
    capture.mockResolvedValue({ pngBase64: 'QUJD', width: 1, height: 1 })
    save.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({ fileName: 'f.png' }), 11_000))
    )
    const { result } = renderHook(() => useScreenshot(device('running')))
    await act(async () => {
      await result.current.capture()
    })
    let pending: Promise<void> | null = null
    act(() => {
      pending = result.current.save()
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_500)
    })
    expect(result.current.state.phase).toBe('saving')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
      await pending
    })
    expect(result.current.state).toEqual({
      phase: 'saved',
      thumbnail: 'data:image/png;base64,QUJD',
      fileName: 'f.png'
    })
  })

  it('save 过期回调丢弃：saving 期间重新截屏，旧 save 完成不覆盖新 copied', async () => {
    capture.mockResolvedValueOnce({ pngBase64: 'QUJD', width: 1, height: 1 })
    capture.mockResolvedValueOnce({ pngBase64: 'REVGI', width: 1, height: 1 })
    let releaseSave: (value: { fileName: string }) => void = () => undefined
    save.mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseSave = resolve
        })
    )
    const { result } = renderHook(() => useScreenshot(device('running')))
    await act(async () => {
      await result.current.capture()
    })
    let pendingSave: Promise<void> | null = null
    act(() => {
      pendingSave = result.current.save()
    })
    expect(result.current.state.phase).toBe('saving')
    let pendingCapture: Promise<void> | null = null
    act(() => {
      pendingCapture = result.current.capture()
    })
    await act(async () => {
      await pendingCapture
    })
    expect(result.current.state).toEqual({
      phase: 'copied',
      thumbnail: 'data:image/png;base64,REVGI'
    })
    await act(async () => {
      releaseSave({ fileName: 'old.png' })
      await pendingSave
    })
    expect(result.current.state).toEqual({
      phase: 'copied',
      thumbnail: 'data:image/png;base64,REVGI'
    })
  })
})

describe('useScreenshot.edit（plan 2026-11-02-screenshot-editor T5）', () => {
  it('edit 成功：openEditor 携设备 id，气泡态不变（不再次发起截屏），editing 复员', async () => {
    capture.mockResolvedValue({ pngBase64: 'QUJD', width: 1, height: 1 })
    openEditor.mockResolvedValue(undefined)
    const { result } = renderHook(() => useScreenshot(device('running')))
    await act(async () => {
      await result.current.capture()
    })
    let pending: Promise<void> | null = null
    act(() => {
      pending = result.current.edit()
    })
    expect(result.current.editing).toBe(true)
    await act(async () => {
      await pending
    })
    expect(openEditor).toHaveBeenCalledWith('d1')
    expect(openEditor).toHaveBeenCalledTimes(1)
    expect(result.current.editing).toBe(false)
    // 编辑走缓存现图：气泡保持 copied，capture 不因开窗再次发生
    expect(result.current.state).toEqual({
      phase: 'copied',
      thumbnail: 'data:image/png;base64,QUJD'
    })
    expect(capture).toHaveBeenCalledTimes(1)
  })

  it('edit 防重复：开窗在途再点不重复调 openEditor；busy 无条件复员', async () => {
    let release: () => void = () => undefined
    openEditor.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        })
    )
    const { result } = renderHook(() => useScreenshot(device('running')))
    let pending: Promise<void> | null = null
    act(() => {
      pending = result.current.edit()
    })
    expect(result.current.editing).toBe(true)
    await act(async () => {
      await result.current.edit()
    })
    expect(openEditor).toHaveBeenCalledTimes(1)
    await act(async () => {
      release()
      await pending
    })
    expect(result.current.editing).toBe(false)
  })

  it('edit 失败：error 态带主进程文案、保留原缩略图，不自动消失', async () => {
    capture.mockResolvedValue({ pngBase64: 'QUJD', width: 1, height: 1 })
    openEditor.mockRejectedValue(new Error('设备不在运行中'))
    const { result } = renderHook(() => useScreenshot(device('running')))
    await act(async () => {
      await result.current.capture()
    })
    await act(async () => {
      await result.current.edit()
    })
    expect(result.current.state).toEqual({
      phase: 'error',
      message: '设备不在运行中',
      thumbnail: 'data:image/png;base64,QUJD'
    })
    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    expect(result.current.state.phase).toBe('error')
  })

  it('edit 过期回填丢弃：开窗期间重新截屏，旧失败不覆盖新 copied（busy 仍复员）', async () => {
    capture
      .mockResolvedValueOnce({ pngBase64: 'QUJD', width: 1, height: 1 })
      .mockResolvedValueOnce({ pngBase64: 'REVGI', width: 1, height: 1 })
    let rejectEdit: (reason?: unknown) => void = () => undefined
    openEditor.mockImplementation(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectEdit = reject
        })
    )
    const { result } = renderHook(() => useScreenshot(device('running')))
    await act(async () => {
      await result.current.capture()
    })
    let pendingEdit: Promise<void> | null = null
    act(() => {
      pendingEdit = result.current.edit()
    })
    await act(async () => {
      await result.current.capture()
    })
    expect(result.current.state).toEqual({
      phase: 'copied',
      thumbnail: 'data:image/png;base64,REVGI'
    })
    await act(async () => {
      rejectEdit(new Error('late failure'))
      await pendingEdit
    })
    expect(result.current.state).toEqual({
      phase: 'copied',
      thumbnail: 'data:image/png;base64,REVGI'
    })
    expect(result.current.editing).toBe(false)
  })
})
