import { act, cleanup, fireEvent, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useApkInstall, fileNameOf } from '../useApkInstall'

const install = vi.fn<(deviceId: string, filePath: string) => Promise<{ fileName: string }>>()
const resolveDropPaths = vi.fn<(files: File[]) => string[]>()

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  ;(window as { api?: unknown }).api = {
    install: { install, resolveDropPaths }
  }
})
afterEach(() => {
  cleanup()
  document.body.replaceChildren()
  vi.useRealTimers()
  delete (window as { api?: unknown }).api
})

/** 原生事件挂载面：DOM 只认小写事件名，hook 的 React.DragEvent 处理器结构兼容原生事件 */
const mountTarget = (
  dragHandlers: ReturnType<typeof useApkInstall>['dragHandlers']
): HTMLElement => {
  const target = document.createElement('div')
  target.addEventListener('dragenter', dragHandlers.onDragEnter as unknown as EventListener)
  target.addEventListener('dragover', dragHandlers.onDragOver as unknown as EventListener)
  target.addEventListener('dragleave', dragHandlers.onDragLeave as unknown as EventListener)
  target.addEventListener('drop', dragHandlers.onDrop as unknown as EventListener)
  document.body.append(target)
  return target
}

const apkFile = (): File =>
  new File(['bytes'], 'app.apk', { type: 'application/vnd.android.package-archive' })

const dragEnter = (target: HTMLElement): void => {
  fireEvent.dragEnter(target, { dataTransfer: { types: ['Files'] } })
}
const drop = (target: HTMLElement, files: File[]): void => {
  fireEvent.drop(target, { dataTransfer: { types: ['Files'], files } })
}

describe('useApkInstall 状态机', () => {
  it('Files 拖入高亮；非 Files 拖入不响应', () => {
    const { result } = renderHook(() => useApkInstall('d1'))
    const target = mountTarget(result.current.dragHandlers)
    fireEvent.dragEnter(target, { dataTransfer: { types: ['text/plain'] } })
    expect(result.current.phase.phase).toBe('idle')
    dragEnter(target)
    expect(result.current.phase.phase).toBe('dragging')
  })

  it('dragLeave 离开舞台收起；经过子元素不收', () => {
    const { result } = renderHook(() => useApkInstall('d1'))
    const target = mountTarget(result.current.dragHandlers)
    const child = document.createElement('span')
    target.append(child)
    dragEnter(target)
    // jsdom DragEvent 不从 init 读 relatedTarget——手工派发并注入
    const dragLeaveWith = (relatedTarget: EventTarget | null): void => {
      const event = new Event('dragleave', { bubbles: true, cancelable: true })
      Object.defineProperty(event, 'dataTransfer', { value: { types: ['Files'], files: [] } })
      Object.defineProperty(event, 'relatedTarget', { value: relatedTarget })
      act(() => {
        target.dispatchEvent(event)
      })
    }
    dragLeaveWith(child)
    expect(result.current.phase.phase).toBe('dragging')
    dragLeaveWith(null)
    expect(result.current.phase.phase).toBe('idle')
  })

  it('单个 .apk：installing → installed，5 秒后回 idle', async () => {
    install.mockResolvedValue({ fileName: 'app.apk' })
    resolveDropPaths.mockReturnValue(['/tmp/app.apk'])
    const { result } = renderHook(() => useApkInstall('d1'))
    const target = mountTarget(result.current.dragHandlers)
    drop(target, [apkFile()])
    expect(result.current.phase).toEqual({ phase: 'installing', fileName: 'app.apk' })
    expect(install).toHaveBeenCalledWith('d1', '/tmp/app.apk')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(result.current.phase).toEqual({ phase: 'installed', fileName: 'app.apk' })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000)
    })
    expect(result.current.phase.phase).toBe('idle')
  })

  it('安装失败：failed 带错误文案，10 秒后回 idle', async () => {
    install.mockRejectedValue(new Error('APK 安装失败：exit 1'))
    resolveDropPaths.mockReturnValue(['/tmp/app.apk'])
    const { result } = renderHook(() => useApkInstall('d1'))
    const target = mountTarget(result.current.dragHandlers)
    drop(target, [apkFile()])
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(result.current.phase).toEqual({ phase: 'failed', message: 'APK 安装失败：exit 1' })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
    expect(result.current.phase.phase).toBe('idle')
  })

  it('非 .apk 与多文件：静默无效，不调 install', () => {
    resolveDropPaths.mockReturnValue(['/tmp/readme.txt'])
    const { result } = renderHook(() => useApkInstall('d1'))
    const target = mountTarget(result.current.dragHandlers)
    dragEnter(target)
    drop(target, [new File([''], 'readme.txt', { type: 'text/plain' })])
    expect(result.current.phase.phase).toBe('idle')
    resolveDropPaths.mockReturnValue(['/tmp/a.apk', '/tmp/b.apk'])
    drop(target, [apkFile(), apkFile()])
    expect(result.current.phase.phase).toBe('idle')
    expect(install).not.toHaveBeenCalled()
  })

  it('安装中再拖入：不排队，busyNote 4 秒后消失', async () => {
    let resolveInstall!: (value: { fileName: string }) => void
    install.mockReturnValue(
      new Promise((resolve) => {
        resolveInstall = resolve
      })
    )
    resolveDropPaths.mockReturnValue(['/tmp/app.apk'])
    const { result } = renderHook(() => useApkInstall('d1'))
    const target = mountTarget(result.current.dragHandlers)
    drop(target, [apkFile()])
    drop(target, [apkFile()])
    expect(result.current.busyNote).toBe(true)
    expect(install).toHaveBeenCalledTimes(1)
    expect(result.current.phase).toEqual({ phase: 'installing', fileName: 'app.apk' })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000)
    })
    expect(result.current.busyNote).toBe(false)
    await act(async () => {
      resolveInstall({ fileName: 'app.apk' })
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(result.current.phase.phase).toBe('installed')
  })
})

describe('fileNameOf', () => {
  it('正斜杠/反斜杠/无路径各自取尾段', () => {
    expect(fileNameOf('/tmp/x/app.apk')).toBe('app.apk')
    expect(fileNameOf('C:\\Downloads\\应用.apk')).toBe('应用.apk')
    expect(fileNameOf('app.apk')).toBe('app.apk')
  })
})
