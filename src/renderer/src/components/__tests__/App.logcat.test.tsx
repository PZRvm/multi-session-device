import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../App'
import { useDeviceStore } from '../../stores/deviceStore'
import { MAIN_COPY } from '@shared/i18n'
import type { Device, DeviceSnapshot, LogcatBatchMessage } from '@shared/types'

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

describe('主窗日志 dock', () => {
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
      platform: 'darwin',
      wizard: { open: vi.fn(async () => undefined), openEditor: vi.fn(async () => undefined) },
      settings: { open: vi.fn(async () => undefined) },
      dialog: { show: vi.fn(async () => ({ response: 0 })) },
      devices: {
        list: vi.fn(async () => snapshotOf([runningDevice])),
        onChanged: () => () => {},
        onRuntimeError: () => () => {}
      },
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

  const toggleButton = (): HTMLElement => screen.getByTitle(copy.logcatTitle)

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
    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.queryByRole('log')).toBeNull()
    expect(unsubscribe).toHaveBeenCalledWith('d1')
  })

  it('独立日志窗开着时点击入口 = 聚焦该窗，不重开 dock', async () => {
    isWindowOpen.mockResolvedValueOnce(true)
    render(<App />)
    fireEvent.click(toggleButton())
    await act(async () => {
      await Promise.resolve()
    })
    expect(openLogcatWindow).toHaveBeenCalledWith('d1')
    expect(screen.queryByRole('log')).toBeNull()
    expect(subscribe).not.toHaveBeenCalled()
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
    await act(async () => {
      await Promise.resolve()
    })
    expect(setDockState).toHaveBeenLastCalledWith({ expanded: false })
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

  it('面板弹出：开独立窗（带目标设备）成功后 dock 收起', async () => {
    render(<App />)
    fireEvent.click(toggleButton())
    await screen.findByRole('log')
    fireEvent.click(screen.getByTitle(copy.logcatPopOut))
    expect(openLogcatWindow).toHaveBeenCalledWith('d1')
    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.queryByRole('log')).toBeNull()
  })

  it('设备停止后入口消失、dock 保留空态（无设备订阅）', async () => {
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
    expect(screen.queryByTitle(copy.logcatTitle)).toBeNull()
    // dock 不自动强收：面板显示无设备空态
    expect(screen.getByText(copy.logcatNoDevice)).toBeTruthy()
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
