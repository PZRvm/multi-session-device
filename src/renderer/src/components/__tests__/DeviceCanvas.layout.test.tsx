import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Device, ScreenFormat } from '@shared/types'
import DeviceCanvas from '../DeviceCanvas'

const stream = vi.hoisted(() => ({
  format: { codec: 'h264', width: 1080, height: 2400 } as ScreenFormat | null,
  screenRef: {
    current: {
      envelope: { deviceId: 'd1', runId: 'r1', streamId: 's1', generation: 1, viewToken: 'vt' },
      width: 1080,
      height: 2400
    }
  }
}))
vi.mock('../../hooks/useDeviceScreen', () => ({
  useDeviceScreen: () => ({
    canvasRef: { current: null },
    status: 'ready',
    format: stream.format,
    error: null,
    screenRef: stream.screenRef,
    onGenerationChange: () => () => {},
    retry: () => {},
    paintsRef: { current: 0 }
  })
}))

const device = {
  id: 'd1',
  name: 'Layout test',
  status: 'running',
  advancedSettings: null,
  frameKind: 'generic'
} as Device
const input = vi.fn(async () => {})
let initialSize = { width: 600, height: 800 }
let resize: (width: number, height: number) => void
const rectOf = (width: number, height: number): DOMRect =>
  ({ width, height, left: 0, top: 0, right: width, bottom: height, x: 0, y: 0 }) as DOMRect

beforeEach(() => {
  input.mockClear()
  stream.format = { codec: 'h264', width: 1080, height: 2400 }
  initialSize = { width: 600, height: 800 }
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() =>
    rectOf(initialSize.width, initialSize.height)
  )
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: ResizeObserverCallback) {
        resize = (width, height) =>
          callback([{ contentRect: rectOf(width, height) } as ResizeObserverEntry], this)
      }
      observe(): void {
        // 首次回调由测试手动推进。
      }
      unobserve(): void {
        // 没有实际观察资源。
      }
      disconnect(): void {
        // 没有实际观察资源。
      }
    }
  )
  ;(window as { api?: unknown }).api = { screen: { input } }
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  delete (window as { api?: unknown }).api
})

const mount = (): ReturnType<typeof render> =>
  render(<DeviceCanvas device={device} onStop={async () => {}} />)

it('观察者首回调迟到：挂载即量尺寸，画面有布局并允许输入', () => {
  mount()
  const canvas = screen.getByLabelText('Layout test 画面')
  expect(parseFloat(getComputedStyle(canvas.parentElement!).width)).toBeGreaterThan(0)
  expect(screen.queryByText('正在准备画面…')).toBeNull()
  expect((screen.getByRole('button', { name: '旋转屏幕' }) as HTMLButtonElement).disabled).toBe(
    false
  )
  fireEvent.keyDown(screen.getByLabelText('Layout test 输入'), { key: 'Enter' })
  expect(input).toHaveBeenCalledOnce()
})

it('初测扣除边框和 padding，与观察者内容区域尺寸一致', () => {
  const computed = window.getComputedStyle
  vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => {
    const style = computed(element)
    return {
      borderLeftWidth: '2px',
      borderRightWidth: '2px',
      borderTopWidth: '3px',
      borderBottomWidth: '3px',
      paddingLeft: '10px',
      paddingRight: '10px',
      paddingTop: '10px',
      paddingBottom: '10px',
      width: style.width,
      height: style.height
    } as CSSStyleDeclaration
  })
  mount()
  const slot = screen.getByLabelText('Layout test 画面').parentElement!
  const size = (): string[] => {
    const style = computed(slot)
    return [style.width, style.height, style.left, style.top]
  }
  const before = size()
  expect(parseFloat(before[0])).toBeGreaterThan(0)
  act(() => resize(576, 774))
  expect(size()).toEqual(before)
})

it('零尺寸时提示等待并丢弃输入；恢复尺寸后开放且不补发旧输入', () => {
  initialSize = { width: 0, height: 0 }
  mount()
  expect(screen.getByText('正在准备画面…')).toBeTruthy()
  expect((screen.getByRole('button', { name: '旋转屏幕' }) as HTMLButtonElement).disabled).toBe(
    true
  )
  const proxy = screen.getByLabelText('Layout test 输入')
  fireEvent.keyDown(proxy, { key: 'Enter' })
  expect(input).not.toHaveBeenCalled()
  act(() => resize(600, 800))
  expect(screen.queryByText('正在准备画面…')).toBeNull()
  expect(input).not.toHaveBeenCalled()
  fireEvent.keyDown(proxy, { key: 'Enter' })
  expect(input).toHaveBeenCalledOnce()
  act(() => resize(0, 0))
  expect(screen.getByText('正在准备画面…')).toBeTruthy()
})

it('连接 ready 但格式迟到：继续等待，格式有效后自动恢复', () => {
  stream.format = null
  const view = mount()
  expect(screen.getByText('正在准备画面…')).toBeTruthy()
  fireEvent.keyDown(screen.getByLabelText('Layout test 输入'), { key: 'Enter' })
  expect(input).not.toHaveBeenCalled()
  stream.format = { codec: 'h264', width: 1080, height: 2400 }
  view.rerender(<DeviceCanvas device={device} onStop={async () => {}} />)
  expect(screen.queryByText('正在准备画面…')).toBeNull()
})
