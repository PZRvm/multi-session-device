import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Device, DeviceSnapshot } from '@shared/types'
import type { ScreenViewRef } from '../../hooks/useDeviceScreen'
import DeviceCanvas from '../DeviceCanvas'
import App from '../../App'
import { useDeviceStore } from '../../stores/deviceStore'

const mocks = vi.hoisted(() => ({
  inputHook: vi.fn(),
  status: 'ready',
  screenRef: { current: {} as ScreenViewRef },
  onGenerationChange: () => () => {}
}))
vi.mock('../../hooks/useDeviceInput', () => ({ useDeviceInput: mocks.inputHook }))
vi.mock('../../hooks/useDeviceScreen', () => ({
  useDeviceScreen: () => ({
    canvasRef: { current: null },
    status: mocks.status,
    format: { width: 1080, height: 2400 },
    error: null,
    screenRef: mocks.screenRef,
    onGenerationChange: mocks.onGenerationChange,
    retry: () => {},
    paintsRef: { current: 0 }
  })
}))
vi.mock('../BoardHead', () => ({ default: () => null }))
vi.mock('../ResizeHandle', () => ({ default: () => null }))

const device: Device = {
  id: 'd1',
  name: 'Pixel test',
  status: 'running',
  runId: 'r1',
  serial: 'emulator-5554',
  advancedSettings: null,
  frameKind: 'generic',
  profileId: 'pixel_8',
  profileLabel: 'Pixel 8',
  imagePackageName: 'system-images;android-34;google_apis;arm64-v8a',
  apiDisplay: '34',
  formFactor: 'phone',
  screenSummary: { widthPx: 1080, heightPx: 2400, diagonalInches: 6.2 },
  snapshotReadyAt: null,
  createdAt: 0
}

const deferred = <T,>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: Error) => void
} => {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((ok, fail) => {
    resolve = ok
    reject = fail
  })
  return { promise, resolve, reject }
}

const input = vi.fn<() => Promise<void>>()
const stop = vi.fn<() => Promise<DeviceSnapshot>>()
const start = vi.fn<() => Promise<DeviceSnapshot>>()
const dialog = vi.fn(async () => ({ response: 0 }))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.status = 'ready'
  mocks.screenRef.current = {
    envelope: { deviceId: 'd1', runId: 'r1', streamId: 's1', generation: 1, viewToken: 'vt' },
    width: 1080,
    height: 2400
  }
  input.mockResolvedValue(undefined)
  useDeviceStore.setState({ devices: [device], selectedId: device.id, revision: 1, loaded: true })
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {
        /* 此测试不需要尺寸回调 */
      }
      disconnect(): void {
        /* 无观测资源 */
      }
    }
  )
  ;(window as { api?: unknown }).api = {
    screen: { input },
    dialog: { show: dialog },
    devices: {
      list: async () => ({ devices: [device], revision: 1 }),
      stop,
      start,
      onChanged: () => () => {},
      onRuntimeError: () => () => {}
    }
  }
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  delete (window as { api?: unknown }).api
})

it('旋转失败显示原因，恢复后允许再次点击', async () => {
  input.mockRejectedValueOnce(new Error('锁定屏幕旋转失败：permission denied'))
  render(<DeviceCanvas device={device} onStop={async () => {}} />)
  fireEvent.click(screen.getByRole('button', { name: '旋转屏幕' }))
  expect(await screen.findByText('锁定屏幕旋转失败：permission denied')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '旋转屏幕' }))
  await waitFor(() => expect(input).toHaveBeenCalledTimes(2))
})

it('旋转等待时暂停画布与工具条，重复点击只发一次，仍可电源关机', async () => {
  const pending = deferred<void>()
  input.mockReturnValueOnce(pending.promise)
  const onStop = vi.fn(async () => {})
  render(<DeviceCanvas device={device} onStop={onStop} />)
  const rotate = screen.getByRole('button', { name: '旋转屏幕' }) as HTMLButtonElement
  act(() => {
    rotate.click()
    rotate.click()
  })
  expect(input).toHaveBeenCalledTimes(1)
  expect(rotate.disabled).toBe(true)
  expect(mocks.inputHook.mock.lastCall?.[0].enabled).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: '关闭设备' }))
  expect(onStop).toHaveBeenCalledOnce()
  await act(async () => pending.resolve())
  expect(rotate.disabled).toBe(false)
})

it('等待期间 generation 原地更新后，旧请求失败不显示到新画面', async () => {
  const pending = deferred<void>()
  input.mockReturnValueOnce(pending.promise)
  render(<DeviceCanvas device={device} onStop={async () => {}} />)
  fireEvent.click(screen.getByRole('button', { name: '旋转屏幕' }))
  mocks.screenRef.current.envelope!.generation += 1
  await act(async () => pending.reject(new Error('归属过期')))
  expect(screen.queryByText('归属过期')).toBeNull()
})

it('切换设备时新画布不继承旋转等待，旧请求失败不显示到新设备', async () => {
  const pending = deferred<void>()
  input.mockReturnValueOnce(pending.promise)
  render(<App />)
  await act(async () => {})
  fireEvent.click(screen.getByRole('button', { name: '旋转屏幕' }))
  const second: Device = { ...device, id: 'd2', name: 'Second Pixel', runId: 'r2' }
  act(() => {
    mocks.screenRef.current.envelope = {
      deviceId: 'd2',
      runId: 'r2',
      streamId: 's2',
      generation: 1,
      viewToken: 'vt-2'
    }
    useDeviceStore.setState({ devices: [device, second], selectedId: 'd2' })
  })
  expect((screen.getByRole('button', { name: '旋转屏幕' }) as HTMLButtonElement).disabled).toBe(
    false
  )
  await act(async () => pending.reject(new Error('旧设备锁定失败')))
  expect(screen.queryByText('旧设备锁定失败')).toBeNull()
  expect(screen.getByLabelText('Second Pixel 画面')).toBeTruthy()
})

it('电源停止当前设备，停止后显示占位，只在左侧点击启动时再次运行', async () => {
  const pending = deferred<DeviceSnapshot>()
  stop.mockReturnValueOnce(pending.promise)
  start.mockResolvedValueOnce({ revision: 3, devices: [device] })
  render(<App />)
  const power = screen.getByRole('button', { name: '关闭设备' }) as HTMLButtonElement
  act(() => {
    power.click()
    power.click()
  })
  expect(stop).toHaveBeenCalledExactlyOnceWith('d1')
  expect(power.disabled).toBe(true)
  expect(input).not.toHaveBeenCalled()
  await act(async () =>
    pending.resolve({
      revision: 2,
      devices: [{ ...device, status: 'stopped', serial: undefined, runId: undefined }]
    })
  )
  expect(await screen.findByText('设备已停止，从左侧列表启动它')).toBeTruthy()
  expect(screen.queryByRole('button', { name: '关闭设备' })).toBeNull()
  expect(start).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '启动 Pixel test' }))
  await waitFor(() => expect(start).toHaveBeenCalledExactlyOnceWith('d1'))
  expect(await screen.findByRole('button', { name: '关闭设备' })).toBeTruthy()
})

it('画面连接失败仍能关机，停止失败沿用提示且可重试', async () => {
  mocks.status = 'error'
  stop.mockRejectedValueOnce(new Error('停止进程失败'))
  render(<App />)
  fireEvent.click(screen.getByRole('button', { name: '关闭设备' }))
  await waitFor(() =>
    expect(dialog).toHaveBeenCalledWith({
      title: '停止失败',
      message: '停止进程失败',
      buttons: ['知道了']
    })
  )
  await waitFor(() =>
    expect((screen.getByRole('button', { name: '关闭设备' }) as HTMLButtonElement).disabled).toBe(
      false
    )
  )
})
