import { act, cleanup, fireEvent, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useApkInstall, fileNameOf, resetApkInstallStateForTests } from '../useApkInstall'

const install =
  vi.fn<
    (
      deviceId: string,
      filePath: string,
      opts?: { allowLowTargetSdk?: boolean }
    ) => Promise<
      | { ok: true; fileName: string }
      | { ok: false; message: string; canBypassLowTargetSdk: boolean }
    >
  >()
const resolveDropPaths = vi.fn<(files: File[]) => string[]>()

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  // 安装态是模块级单源（跨挂载存活）——测试间必须清空，否则状态泄漏到下个用例
  resetApkInstallStateForTests()
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
    install.mockResolvedValue({ ok: true, fileName: 'app.apk' })
    resolveDropPaths.mockReturnValue(['/tmp/app.apk'])
    const { result } = renderHook(() => useApkInstall('d1'))
    const target = mountTarget(result.current.dragHandlers)
    drop(target, [apkFile()])
    expect(result.current.phase).toEqual({ phase: 'installing', fileName: 'app.apk' })
    expect(install).toHaveBeenCalledWith('d1', '/tmp/app.apk', undefined)
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

  it('安装中再拖入（真实序列 dragenter→drop）：不打断 spinner，busyNote 4 秒后消失，无失败卡', async () => {
    let resolveInstall!: (value: { ok: true; fileName: string }) => void
    install.mockReturnValue(
      new Promise((resolve) => {
        resolveInstall = resolve
      })
    )
    resolveDropPaths.mockReturnValue(['/tmp/app.apk'])
    const { result } = renderHook(() => useApkInstall('d1'))
    const target = mountTarget(result.current.dragHandlers)
    drop(target, [apkFile()])
    expect(result.current.phase).toEqual({ phase: 'installing', fileName: 'app.apk' })
    // 真实拖放序列：dragenter 必然先于 drop（issue 2026-10-10-apk-install-busy-unreachable）
    dragEnter(target)
    expect(result.current.phase).toEqual({ phase: 'installing', fileName: 'app.apk' })
    expect(result.current.busyNote).toBe(true)
    drop(target, [apkFile()])
    expect(install).toHaveBeenCalledTimes(1)
    expect(result.current.phase).toEqual({ phase: 'installing', fileName: 'app.apk' })
    expect(result.current.busyNote).toBe(true)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000)
    })
    expect(result.current.busyNote).toBe(false)
    expect(result.current.phase.phase).toBe('installing')
    await act(async () => {
      resolveInstall({ ok: true as const, fileName: 'app.apk' })
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(result.current.phase.phase).toBe('installed')
  })

  it('结果卡展示中拖入新文件：进入新一轮高亮，不残留旧结果', async () => {
    install.mockResolvedValue({ ok: true, fileName: 'a.apk' })
    resolveDropPaths.mockReturnValue(['/tmp/a.apk'])
    const { result } = renderHook(() => useApkInstall('d1'))
    const target = mountTarget(result.current.dragHandlers)
    drop(target, [apkFile()])
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(result.current.phase).toEqual({ phase: 'installed', fileName: 'a.apk' })
    dragEnter(target)
    expect(result.current.phase.phase).toBe('dragging')
    // 新一轮 drop 正常发起新安装
    resolveDropPaths.mockReturnValue(['/tmp/b.apk'])
    drop(target, [new File(['x'], 'b.apk')])
    expect(install).toHaveBeenCalledTimes(2)
    expect(result.current.phase).toEqual({ phase: 'installing', fileName: 'b.apk' })
  })

  it('切设备卸载后重挂载：恢复 installing 并接住结局（busy 不再误呈失败卡）', async () => {
    let resolveInstall!: (value: { ok: true; fileName: string }) => void
    install.mockReturnValue(
      new Promise((resolve) => {
        resolveInstall = resolve
      })
    )
    resolveDropPaths.mockReturnValue(['/tmp/app.apk'])
    const first = renderHook(() => useApkInstall('d1'))
    drop(mountTarget(first.result.current.dragHandlers), [apkFile()])
    expect(first.result.current.phase.phase).toBe('installing')
    // 切走：画布卸载（App 以 id:runId 为 key），原 hook 的 invoke 结果无人接收
    first.unmount()
    // 切回：全新画布从模块单源恢复 installing，而非 idle（issue P2-4）
    const second = renderHook(() => useApkInstall('d1'))
    expect(second.result.current.phase).toEqual({ phase: 'installing', fileName: 'app.apk' })
    // 重挂载期间再拖入：走 busyNote（串行约束提示），不再触发第二次 install
    dragEnter(mountTarget(second.result.current.dragHandlers))
    expect(second.result.current.busyNote).toBe(true)
    expect(install).toHaveBeenCalledTimes(1)
    await act(async () => {
      resolveInstall({ ok: true as const, fileName: 'app.apk' })
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(second.result.current.phase).toEqual({ phase: 'installed', fileName: 'app.apk' })
    second.unmount()
  })

  it('卸载后安装完成：保留窗口内重挂载直接看到结果卡并自动清理，超窗不再展示', async () => {
    install.mockResolvedValue({ ok: true, fileName: 'app.apk' })
    resolveDropPaths.mockReturnValue(['/tmp/app.apk'])
    const first = renderHook(() => useApkInstall('d1'))
    drop(mountTarget(first.result.current.dragHandlers), [apkFile()])
    first.unmount()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    // 结果完成于卸载期间：保留窗口（5 秒）内切回，仍能看到结局，且照常自动清理
    const second = renderHook(() => useApkInstall('d1'))
    expect(second.result.current.phase).toEqual({ phase: 'installed', fileName: 'app.apk' })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000)
    })
    expect(second.result.current.phase.phase).toBe('idle')
    second.unmount()
    // 超窗清除：迟到重挂载不展示陈旧结果
    const third = renderHook(() => useApkInstall('d1'))
    expect(third.result.current.phase.phase).toBe('idle')
    third.unmount()
  })

  it('安装先于 busyNote 4 秒完成：busyNote 随终态清理，不与结果卡同屏', async () => {
    install.mockResolvedValue({ ok: true, fileName: 'app.apk' })
    resolveDropPaths.mockReturnValue(['/tmp/app.apk'])
    const { result } = renderHook(() => useApkInstall('d1'))
    const target = mountTarget(result.current.dragHandlers)
    drop(target, [apkFile()])
    dragEnter(target)
    expect(result.current.busyNote).toBe(true)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })
    expect(result.current.phase).toEqual({ phase: 'installed', fileName: 'app.apk' })
    expect(result.current.busyNote).toBe(false)
  })
})

describe('fileNameOf', () => {
  it('正斜杠/反斜杠/无路径各自取尾段', () => {
    expect(fileNameOf('/tmp/x/app.apk')).toBe('app.apk')
    expect(fileNameOf('C:\\Downloads\\应用.apk')).toBe('应用.apk')
    expect(fileNameOf('app.apk')).toBe('app.apk')
  })
})
