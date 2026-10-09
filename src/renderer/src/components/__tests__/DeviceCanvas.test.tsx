import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Device, DeviceSkinPresentation } from '@shared/types'
import DeviceCanvas from '../DeviceCanvas'

vi.mock('../../hooks/useDeviceInput', () => ({ useDeviceInput: () => {} }))
vi.mock('../../hooks/useDeviceScreen', () => ({
  useDeviceScreen: () => ({
    canvasRef: { current: null },
    status: 'ready',
    format: { width: 1080, height: 2400 },
    error: null,
    onGenerationChange: () => () => {},
    screenRef: { current: { envelope: null } },
    retry: () => {},
    paintsRef: { current: 0 }
  })
}))
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  delete (window as { api?: unknown }).api
})

const maskPixels = vi.fn(() => new Uint8ClampedArray([0, 0, 0, 255, 0, 0, 0, 0]))
beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  maskPixels.mockReturnValue(new Uint8ClampedArray([0, 0, 0, 255, 0, 0, 0, 0]))
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage: vi.fn(),
    getImageData: () => ({ data: maskPixels() })
  } as unknown as CanvasRenderingContext2D)
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private callback: (entries: unknown[]) => void) {}
      observe(): void {
        this.callback([{ contentRect: { width: 600, height: 800 } }])
      }
      disconnect(): void {
        this.callback = () => undefined
      }
    }
  )
  vi.stubGlobal(
    'Image',
    class {
      naturalWidth = 1080
      naturalHeight = 2400
      onload?: () => void
      set src(_url: string) {
        queueMicrotask(() => this.onload?.())
      }
    }
  )
})

const skin: DeviceSkinPresentation = {
  name: 'pixel_7',
  landscape: null,
  portrait: {
    frameWidth: 1200,
    frameHeight: 2541,
    screenX: 59,
    screenY: 58,
    screenWidth: 1080,
    screenHeight: 2400,
    rotation: 0,
    foregroundMask: 'mask.webp',
    backgrounds: []
  },
  images: [{ file: 'mask.webp', url: 'data:image/webp;base64,fixture' }]
}
const device = {
  id: 'skin-test',
  name: 'Pixel 7',
  status: 'running',
  advancedSettings: { skinRef: 'downloaded:test' }
} as Device

it('真实皮肤前景在视频上方，透传输入；通用外框没有该遮罩', async () => {
  ;(window as { api?: unknown }).api = { sdk: { deviceSkinPresentation: vi.fn(async () => skin) } }
  const { container, rerender } = render(<DeviceCanvas device={device} onStop={async () => {}} />)
  await screen.findByLabelText('Pixel 7 画面')
  const mask = await waitFor(() => {
    const image = container.querySelector('img')
    expect(image).not.toBeNull()
    return image!
  })
  const canvas = container.querySelector('canvas')!
  expect(mask.parentElement).toBe(canvas.parentElement)
  expect(mask.compareDocumentPosition(canvas) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy()
  expect(getComputedStyle(mask).zIndex).toBe('1')
  expect(getComputedStyle(mask).pointerEvents).toBe('none')
  expect(mask.style.transform).toBe('none')
  rerender(
    <DeviceCanvas
      device={{ ...device, advancedSettings: { ...device.advancedSettings!, skinRef: null } }}
      onStop={async () => {}}
    />
  )
  await waitFor(() => expect(container.querySelector('img')).toBeNull())
})

it('完全不透明的前景回退通用外框，保留视频且顶部没有提示文字', async () => {
  maskPixels.mockReturnValue(new Uint8ClampedArray([68, 68, 68, 255, 68, 68, 68, 255]))
  ;(window as { api?: unknown }).api = { sdk: { deviceSkinPresentation: vi.fn(async () => skin) } }
  const { container } = render(<DeviceCanvas device={device} onStop={async () => {}} />)
  await act(async () => {
    await Promise.resolve()
  })
  expect(maskPixels).toHaveBeenCalled()
  expect(screen.queryByRole('status')).toBeNull()
  expect(screen.queryByText(/暂用通用外框/)).toBeNull()
  expect(container.querySelector('img')).toBeNull()
  expect(screen.getByLabelText('Pixel 7 画面')).not.toBeNull()
})

it('普通背景允许不透明，不被当作前景遮罩拒绝', async () => {
  maskPixels.mockReturnValue(new Uint8ClampedArray([68, 68, 68, 255]))
  const backgroundOnly: DeviceSkinPresentation = {
    ...skin,
    portrait: {
      ...skin.portrait!,
      foregroundMask: undefined,
      backgrounds: [{ file: 'mask.webp', x: 0, y: 0, rotation: 0 }]
    }
  }
  ;(window as { api?: unknown }).api = {
    sdk: { deviceSkinPresentation: vi.fn(async () => backgroundOnly) }
  }
  const { container } = render(<DeviceCanvas device={device} onStop={async () => {}} />)
  await waitFor(() => expect(container.querySelector('img')).not.toBeNull())
  expect(screen.queryByRole('status')).toBeNull()
})

it('无法检查前景透明度时保留设备视频并回退', async () => {
  vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(null)
  ;(window as { api?: unknown }).api = { sdk: { deviceSkinPresentation: vi.fn(async () => skin) } }
  const { container } = render(<DeviceCanvas device={device} onStop={async () => {}} />)
  await act(async () => {
    await Promise.resolve()
  })
  expect(HTMLCanvasElement.prototype.getContext).toHaveBeenCalled()
  expect(screen.queryByRole('status')).toBeNull()
  expect(container.querySelector('img')).toBeNull()
  expect(screen.getByLabelText('Pixel 7 画面')).not.toBeNull()
})

it('皮肤与视频比例不匹配时静默回退，画面顶部没有文字', async () => {
  ;(window as { api?: unknown }).api = {
    sdk: {
      deviceSkinPresentation: vi.fn(async () => ({
        ...skin,
        portrait: { ...skin.portrait!, screenWidth: 240, screenHeight: 320 }
      }))
    }
  }
  const { container } = render(<DeviceCanvas device={device} onStop={async () => {}} />)
  await act(async () => {
    await Promise.resolve()
  })
  expect(maskPixels).toHaveBeenCalled()
  expect(container.querySelector('img')).toBeNull()
  expect(screen.queryByRole('status')).toBeNull()
  expect(screen.getByLabelText('Pixel 7 画面')).not.toBeNull()
})
