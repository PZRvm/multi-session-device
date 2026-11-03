import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ExternalDevice } from '@shared/types'
import type { ScreenViewRef } from '../../hooks/useDeviceScreen'
import ExternalCanvas from '../ExternalCanvas'
import { MAIN_COPY } from '@shared/i18n'
import { useDeviceStore } from '../../stores/deviceStore'

const copy = MAIN_COPY['zh-CN']

// ExternalCanvas 组件级测试（review P3-5）：通用外框在场、工具条无电源钮、
// 拖装「仍要安装」链路。投屏/输入 hook 走替身（与 DeviceCanvas 测试同模式）。

vi.mock('../../hooks/useDeviceInput', () => ({ useDeviceInput: vi.fn() }))
vi.mock('../../hooks/useDeviceScreen', () => ({
  useDeviceScreen: () => ({
    canvasRef: { current: null },
    status: 'ready',
    format: { width: 1080, height: 2400 },
    error: null,
    screenRef: { current: {} as ScreenViewRef },
    onGenerationChange: () => () => {},
    retry: () => {},
    paintsRef: { current: 0 }
  })
}))

const realDevice: ExternalDevice = {
  id: 'DSLDU20B12002637',
  serial: 'DSLDU20B12002637',
  transport: 'usb',
  state: 'device',
  model: 'EBG_AN00'
}

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
  useDeviceStore.setState({ network: {} })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    width: 600,
    height: 800,
    left: 0,
    top: 0,
    right: 600,
    bottom: 800
  } as DOMRect)
  // RO 桩模拟首拍（生产环境 ResizeObserver 观察即回调初始尺寸）
  vi.stubGlobal(
    'ResizeObserver',
    class {
      private readonly callback: ResizeObserverCallback
      constructor(callback: ResizeObserverCallback) {
        this.callback = callback
      }
      observe(): void {
        const contentRect = {
          width: 600,
          height: 800,
          top: 0,
          left: 0,
          bottom: 800,
          right: 600,
          x: 0,
          y: 0
        } as DOMRectReadOnly
        this.callback(
          [
            {
              borderBoxSize: [],
              contentBoxSize: [],
              devicePixelContentBoxSize: [],
              target: {} as Element,
              contentRect
            } as ResizeObserverEntry
          ],
          this as unknown as ResizeObserver
        )
      }
      disconnect(): void {
        /* 无观测资源 */
      }
    }
  )
  ;(window as { api?: unknown }).api = {
    platform: 'darwin',
    screen: { input: vi.fn(async () => {}) },
    install: { install, resolveDropPaths },
    screenshot: { capture: vi.fn(async () => undefined), save: vi.fn(async () => undefined) },
    network: {
      set: vi.fn(async () => ({ state: { airplane: false, wifi: true, data: true } })),
      getAll: vi.fn(async () => ({})),
      onChanged: () => () => {}
    },
    dialog: { show: vi.fn(async () => ({ response: 0 })) }
  }
})

afterEach(() => {
  cleanup()
  document.body.replaceChildren()
  vi.unstubAllGlobals()
  delete (window as { api?: unknown }).api
})

const stageOf = (container: HTMLElement): HTMLElement => {
  const stage = container.querySelector<HTMLElement>('.stage')
  if (!stage) throw new Error('stage 未渲染')
  return stage
}

it('通用外框在场（含听筒与指示条），无前摄开孔', () => {
  const { container } = render(<ExternalCanvas device={realDevice} />)
  expect(container.querySelector('.frame-shell')).toBeTruthy()
  expect(container.querySelector('.ear-piece')).toBeTruthy()
  expect(container.querySelector('.home-indicator')).toBeTruthy()
  expect(container.querySelector('.front-camera')).toBeNull()
})

it('完整工具条：六键与旋转在场、无电源钮（review P3-5）', () => {
  render(<ExternalCanvas device={realDevice} />)
  for (const label of [copy.back, copy.home, copy.overview, copy.volumeUp, copy.volumeDown]) {
    expect(screen.getByRole('button', { name: label })).toBeTruthy()
  }
  expect(screen.queryByRole('button', { name: copy.powerOff })).toBeNull()
  expect(screen.getByRole('button', { name: copy.rotate })).toBeTruthy()
})

it('拖装「仍要安装」链路：deprecatedSdk 失败 → 按钮在场 → 点击带旗标重发', async () => {
  // 默认（第二次调用）成功；首次调用命中 deprecatedSdk 失败
  install.mockResolvedValue({ ok: true, fileName: 'old.apk' })
  install.mockResolvedValueOnce({
    ok: false,
    message:
      'APK 安装失败：targetSdk 低于 Android 14 允许的最低版本（Failure [INSTALL_FAILED_DEPRECATED_SDK_VERSION]）',
    canBypassLowTargetSdk: true
  })
  resolveDropPaths.mockReturnValue(['/tmp/old.apk'])
  const { container } = render(<ExternalCanvas device={realDevice} />)
  const stage = stageOf(container)
  fireEvent.dragEnter(stage, { dataTransfer: { types: ['Files'] } })
  fireEvent.drop(stage, {
    dataTransfer: { types: ['Files'], files: [new File([], 'old.apk')] }
  })
  await waitFor(() =>
    expect(install).toHaveBeenCalledWith('DSLDU20B12002637', '/tmp/old.apk', undefined)
  )
  const retry = await screen.findByRole('button', { name: copy.retryInstall })
  fireEvent.click(retry)
  await waitFor(() =>
    expect(install).toHaveBeenLastCalledWith('DSLDU20B12002637', '/tmp/old.apk', {
      allowLowTargetSdk: true
    })
  )
})
