import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../App'
import { useDeviceStore } from '../../stores/deviceStore'
import { MAIN_COPY } from '@shared/i18n'
import type { Device, DeviceSnapshot, LogcatBatchMessage } from '@shared/types'
import { networkApiMock } from './networkApiMock'

const copy = MAIN_COPY['zh-CN']

vi.mock('../DeviceCanvas', () => ({ default: () => null }))
vi.mock('../ResizeHandle', () => ({ default: () => null }))
vi.mock('../DeviceListPane', () => ({
  default: () => <div data-testid="list-pane" />
}))

const runningDevice = {
  id: 'd1',
  name: 'Pixel 8',
  status: 'running',
  serial: 'emulator-5554',
  runId: 'run-1'
} as unknown as Device

const snapshotOf = (devices: Device[]): DeviceSnapshot =>
  ({
    revision: 1,
    devices,
    storeHealth: { state: 'ok', issues: [] },
    reconciliation: {
      signature: null,
      unavailableCount: 0,
      orphanCount: 0,
      storeState: 'ok',
      pendingNotification: false
    }
  }) as unknown as DeviceSnapshot

const openLogcatWindow = vi.fn(async () => undefined)
const isWindowOpen = vi.fn(async () => false)
const dialogShow = vi.fn(async () => ({ response: 0 }))
// main 侧「锁 minWidth + 拉宽」的真实行为在测试里模拟为：expanded 时视口拉宽
const setDockState = vi.fn(async (state: { expanded: boolean; minWidth?: number }) => {
  if (state.expanded && state.minWidth && window.innerWidth < state.minWidth) {
    setViewport(state.minWidth)
    window.dispatchEvent(new Event('resize'))
  }
})
const subscribe = vi.fn(async () => undefined)
const unsubscribe = vi.fn(async () => undefined)
const ack = vi.fn(async () => undefined)

const setViewport = (width: number): void => {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true })
}

describe.each(['darwin', 'win32', 'linux'])('主窗日志 dock（%s）', (platform) => {
  beforeEach(() => {
    vi.clearAllMocks()
    setViewport(1400)
    useDeviceStore.setState({
      devices: [runningDevice],
      selectedId: 'd1',
      revision: 1,
      loaded: true,
      loadError: null,
      storeHealth: { state: 'ok', issues: [] },
      reconciliation: {
        signature: null,
        unavailableCount: 0,
        orphanCount: 0,
        storeState: 'ok',
        pendingNotification: false
      }
    })
    ;(window as unknown as { api: unknown }).api = {
      platform,
      wizard: { open: vi.fn(async () => undefined), openEditor: vi.fn(async () => undefined) },
      settings: { open: vi.fn(async () => undefined) },
      dialog: { show: dialogShow },
      devices: {
        list: vi.fn(async () => snapshotOf([runningDevice])),
        onChanged: () => () => {},
        onRuntimeError: () => () => {},
        listExternal: vi.fn(async () => []),
        onExternalChanged: () => () => {}
      },
      network: networkApiMock(),
      logcat: {
        openWindow: openLogcatWindow,
        isWindowOpen: isWindowOpen,
        setDockState,
        dockBack: vi.fn(async () => undefined),
        onDockBack: (): (() => void) => () => {},
        subscribe,
        unsubscribe,
        ack,
        onBatch: (): (() => void) => () => {}
      }
    }
  })

  afterEach(() => {
    cleanup()
    delete (window as unknown as { api?: unknown }).api
    setViewport(1024)
  })

  const toggleButton = (): HTMLElement => screen.getByRole('button', { name: copy.logcatTitle })

  it('板头留在列表内，Windows 开关浮在右上且不创建独立顶部行', async () => {
    const { container } = render(<App />)
    const button = toggleButton()
    const selector = platform === 'win32' ? '.window-actions' : '.canvas-tools'
    expect(button.closest(selector)).toBeTruthy()
    expect(container.querySelectorAll('.log-toggle')).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: copy.settings })).toHaveLength(1)
    expect(container.querySelector('.list-pane')?.querySelector('.settings-button')).toBeTruthy()
    expect(container.querySelector('.workspace')).toBeNull()
    expect(container.querySelector('.windows-header')).toBeNull()
    expect(Boolean(container.querySelector('.window-drag-region'))).toBe(platform === 'win32')
    fireEvent.click(button)
    await screen.findByRole('log')
    expect(button.closest(selector)).toBeTruthy()
    expect(container.querySelectorAll('.log-toggle')).toHaveLength(1)
  })

  it('dock 默认收起（不持久化）；点击展开并订阅，再点收起退订', async () => {
    render(<App />)
    const button = toggleButton()
    expect(button.getAttribute('aria-pressed')).toBe('false')
    expect(screen.queryByRole('log')).toBeNull()
    fireEvent.click(button)
    expect(await screen.findByRole('log')).toBeTruthy()
    expect(subscribe).toHaveBeenCalledWith('d1')
    expect(button.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(button)
    // 收起链经 isWindowOpen IPC + setLogDockOpen + 卸载 effect 多个微任务拍——
    // 固定拍数在整仓并行下会抖（issue 2026-10-13-AppLogcatDock测试偶发抖动），改轮询
    await waitFor(() => expect(unsubscribe).toHaveBeenCalledWith('d1'))
    expect(screen.queryByRole('log')).toBeNull()
  })

  it('独立日志窗开着时点击入口 = 聚焦该窗，不重开 dock', async () => {
    isWindowOpen.mockResolvedValueOnce(true)
    render(<App />)
    fireEvent.click(toggleButton())
    await waitFor(() => expect(openLogcatWindow).toHaveBeenCalledWith('d1'))
    expect(screen.queryByRole('log')).toBeNull()
    expect(subscribe).not.toHaveBeenCalled()
  })

  it('弹出独立窗失败：弹原生 dialog 报 openLogcatWindowFailed，dock 保持展开不消失', async () => {
    openLogcatWindow.mockRejectedValueOnce(new Error('加载日志窗口超时'))
    render(<App />)
    fireEvent.click(toggleButton())
    await screen.findByRole('log')
    fireEvent.click(screen.getByTitle(copy.logcatPopOut))
    await waitFor(() => expect(dialogShow).toHaveBeenCalledTimes(1))
    expect(dialogShow).toHaveBeenCalledWith(
      expect.objectContaining({ title: copy.openLogcatWindowFailed })
    )
    // 失败时 dock 不收起（成功路径才 setLogDockOpen(false)）
    expect(screen.getByRole('log')).toBeTruthy()
    expect(toggleButton().getAttribute('aria-pressed')).toBe('true')
  })

  it('独立窗贴回事件到达后 dock 重新展开', async () => {
    let dockBackListener: (() => void) | null = null
    ;(window as unknown as { api: { logcat: { onDockBack: unknown } } }).api.logcat.onDockBack = (
      callback: () => void
    ): (() => void) => {
      dockBackListener = callback
      return () => {
        dockBackListener = null
      }
    }
    render(<App />)
    expect(screen.queryByRole('log')).toBeNull()
    act(() => {
      dockBackListener?.()
    })
    expect(await screen.findByRole('log')).toBeTruthy()
    expect(subscribe).toHaveBeenCalledWith('d1')
  })

  it('窄窗点击入口：通知 main 锁 minWidth 并拉宽，dock 黏滞右侧展开（不退化独立窗）', async () => {
    setViewport(1000)
    render(<App />)
    fireEvent.click(toggleButton())
    await screen.findByRole('log')
    expect(setDockState).toHaveBeenCalledWith({ expanded: true, minWidth: 1165 })
    expect(openLogcatWindow).not.toHaveBeenCalled()
  })

  it('收起 dock 时通知 main 解锁 minWidth', async () => {
    render(<App />)
    fireEvent.click(toggleButton())
    await screen.findByRole('log')
    fireEvent.click(toggleButton())
    await waitFor(() => expect(setDockState).toHaveBeenLastCalledWith({ expanded: false }))
    expect(screen.queryByRole('log')).toBeNull()
  })

  it('dock 展开后窗口收窄到不足时自动隐藏，回宽恢复', async () => {
    render(<App />)
    fireEvent.click(toggleButton())
    await screen.findByRole('log')
    act(() => {
      setViewport(1000)
      window.dispatchEvent(new Event('resize'))
    })
    expect(screen.queryByRole('log')).toBeNull()
    act(() => {
      setViewport(1400)
      window.dispatchEvent(new Event('resize'))
    })
    expect(screen.getByRole('log')).toBeTruthy()
  })

  it('面板弹出：开独立窗（带目标设备）成功后 dock 收起并解锁 minWidth', async () => {
    render(<App />)
    fireEvent.click(toggleButton())
    await screen.findByRole('log')
    fireEvent.click(screen.getByTitle(copy.logcatPopOut))
    expect(openLogcatWindow).toHaveBeenCalledWith('d1')
    await waitFor(() => expect(screen.queryByRole('log')).toBeNull())
    // 独立窗口态主窗宽度自由：dock 不可见即解锁
    await waitFor(() => expect(setDockState).toHaveBeenLastCalledWith({ expanded: false }))
  })

  it('窄窗贴回：按需拉宽主窗并黏滞展开 dock', async () => {
    setViewport(1000)
    let dockBackListener: (() => void) | null = null
    ;(window as unknown as { api: { logcat: { onDockBack: unknown } } }).api.logcat.onDockBack = (
      callback: () => void
    ): (() => void) => {
      dockBackListener = callback
      return () => {
        dockBackListener = null
      }
    }
    render(<App />)
    expect(screen.queryByRole('log')).toBeNull()
    act(() => {
      dockBackListener?.()
    })
    // mock 的 setDockState 在 expanded 且当前视口不足时把视口拉宽到 minWidth
    expect(setDockState).toHaveBeenCalledWith({ expanded: true, minWidth: 1165 })
    expect(await screen.findByRole('log')).toBeTruthy()
    expect(window.innerWidth).toBe(1165)
  })

  it('设备停止后：入口消失且 dock 自动收起、minWidth 解锁（不留死锁）', async () => {
    const { rerender } = render(<App />)
    fireEvent.click(toggleButton())
    await screen.findByRole('log')
    const stopped = {
      ...runningDevice,
      status: 'stopped' as const,
      serial: undefined,
      runId: undefined
    }
    act(() => {
      useDeviceStore.setState({ devices: [stopped] })
    })
    rerender(<App />)
    expect(screen.queryByRole('button', { name: copy.logcatTitle })).toBeNull()
    // dock 自动收起（不再保留空态挂死）
    expect(screen.queryByRole('log')).toBeNull()
    // 解锁随 dockVisible 变 false 发出
    expect(setDockState).toHaveBeenLastCalledWith({ expanded: false })
  })

  it('批次推送渲染到面板（端到端：App 装配 → useLogcatFeed）', async () => {
    let listener: ((message: LogcatBatchMessage) => void) | null = null
    ;(window as unknown as { api: { logcat: { onBatch: unknown } } }).api.logcat.onBatch = (
      callback: (message: LogcatBatchMessage) => void
    ): (() => void) => {
      listener = callback
      return () => {
        listener = null
      }
    }
    render(<App />)
    fireEvent.click(toggleButton())
    await screen.findByRole('log')
    act(() => {
      listener?.({
        deviceId: 'd1',
        runId: 'run-1',
        replay: true,
        lines: [{ seq: 1, text: 'app-level-line' }],
        dropped: 0
      })
    })
    expect(screen.getByText('app-level-line')).toBeTruthy()
  })
})
