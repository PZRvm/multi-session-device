import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Device } from '@shared/types'
import type { ScreenViewRef } from '../../hooks/useDeviceScreen'
import DeviceCanvas from '../DeviceCanvas'

const mocks = vi.hoisted(() => ({
  status: 'ready',
  screenRef: { current: {} as ScreenViewRef }
}))

vi.mock('../../hooks/useDeviceInput', () => ({ useDeviceInput: vi.fn() }))
vi.mock('../../hooks/useDeviceScreen', () => ({
  useDeviceScreen: () => ({
    canvasRef: { current: null },
    status: mocks.status,
    format: { width: 1080, height: 2400 },
    error: null,
    screenRef: mocks.screenRef,
    onGenerationChange: () => () => {},
    retry: () => {},
    paintsRef: { current: 0 }
  })
}))

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
  mocks.status = 'ready'
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    width: 600,
    height: 800,
    left: 0,
    top: 0,
    right: 600,
    bottom: 800
  } as DOMRect)
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {
        /* 拖放测试不需要尺寸回调 */
      }
      disconnect(): void {
        /* 无观测资源 */
      }
    }
  )
  ;(window as { api?: unknown }).api = {
    screen: { input: vi.fn(async () => {}) },
    install: { install, resolveDropPaths }
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

const apkFile = (): File =>
  new File(['bytes'], 'app.apk', { type: 'application/vnd.android.package-archive' })

it('拖入 .stage 出现安装提示，松开安装成功显示结果', async () => {
  install.mockResolvedValue({ ok: true, fileName: 'app.apk' })
  resolveDropPaths.mockReturnValue(['/tmp/app.apk'])
  const { container } = render(<DeviceCanvas device={device} onStop={vi.fn(async () => {})} />)
  const stage = stageOf(container)
  fireEvent.dragEnter(stage, { dataTransfer: { types: ['Files'] } })
  expect(screen.getByText('松开安装到 Pixel test')).toBeTruthy()
  fireEvent.drop(stage, { dataTransfer: { types: ['Files'], files: [apkFile()] } })
  expect(install).toHaveBeenCalledWith('d1', '/tmp/app.apk', undefined)
  await waitFor(() => {
    expect(screen.getByText('已安装 app.apk')).toBeTruthy()
  })
})

it('非 .apk 松开：无安装调用、提示收起', () => {
  resolveDropPaths.mockReturnValue(['/tmp/readme.txt'])
  const { container } = render(<DeviceCanvas device={device} onStop={vi.fn(async () => {})} />)
  const stage = stageOf(container)
  fireEvent.dragEnter(stage, { dataTransfer: { types: ['Files'] } })
  expect(screen.getByText('松开安装到 Pixel test')).toBeTruthy()
  fireEvent.drop(stage, { dataTransfer: { types: ['Files'], files: [new File([''], 'r.txt')] } })
  expect(install).not.toHaveBeenCalled()
  expect(screen.queryByText('松开安装到 Pixel test')).toBeNull()
})

it('安装失败显示主进程错误文案', async () => {
  install.mockRejectedValue(new Error('APK 安装失败：设备存储空间不足（detail）'))
  resolveDropPaths.mockReturnValue(['/tmp/app.apk'])
  const { container } = render(<DeviceCanvas device={device} onStop={vi.fn(async () => {})} />)
  const stage = stageOf(container)
  fireEvent.drop(stage, { dataTransfer: { types: ['Files'], files: [apkFile()] } })
  await waitFor(() => {
    expect(screen.getByText(/设备存储空间不足/)).toBeTruthy()
  })
})
