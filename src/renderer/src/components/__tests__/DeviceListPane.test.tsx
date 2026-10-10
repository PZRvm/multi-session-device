import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Device } from '@shared/types'
import DeviceListPane from '../DeviceListPane'
import { MAIN_COPY, format } from '@shared/i18n'
const copy = MAIN_COPY['zh-CN']

afterEach(cleanup)

const baseDevice: Device = {
  id: 'd1',
  name: 'Pixel test',
  profileId: 'pixel_8',
  profileLabel: 'Pixel 8',
  imagePackageName: 'system-images;android-34;google_apis;arm64-v8a',
  apiDisplay: '34',
  formFactor: 'phone',
  screenSummary: null,
  advancedSettings: null,
  snapshotReadyAt: null,
  createdAt: 0,
  availability: { state: 'valid', issues: [], checkedAt: 1 },
  status: 'stopped'
}

const renderPane = (overrides: Partial<Parameters<typeof DeviceListPane>[0]>): void => {
  render(
    <DeviceListPane
      devices={[]}
      selectedId={null}
      storeTrusted
      metaWritable
      storeState="ok"
      loadError={null}
      onRetryLoad={vi.fn()}
      onSelect={vi.fn()}
      onStart={vi.fn()}
      onStop={vi.fn()}
      onCancelStart={vi.fn()}
      onCopySerial={vi.fn()}
      onDelete={vi.fn()}
      onRename={vi.fn()}
      onEdit={vi.fn()}
      {...overrides}
    />
  )
}

describe('DeviceListPane 空库文案（review P2-3/P3）', () => {
  it('正常空库：还没有设备', () => {
    renderPane({})
    expect(screen.getByText(new RegExp(copy.emptyList.split('，')[0]))).toBeTruthy()
  })

  it('list invoke 失败（loadError）：显示读取失败与重试入口，不显示普通空库文案', () => {
    const onRetryLoad = vi.fn()
    renderPane({ loadError: 'boom', onRetryLoad })
    expect(screen.getByText(format(copy.loadFailed, { message: 'boom' }))).toBeTruthy()
    expect(screen.queryByText(/还没有设备/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: copy.retryLoad }))
    expect(onRetryLoad).toHaveBeenCalledTimes(1)
  })

  it('store error：devices.json 异常文案', () => {
    renderPane({ storeState: 'error' })
    expect(screen.getByText(new RegExp(copy.listReadFailed.split('：')[0]))).toBeTruthy()
    expect(screen.queryByText(/还没有设备/)).toBeNull()
  })

  it('read-only 且无可显示行：提示条目异常，不再自相矛盾地说「还没有设备」', () => {
    renderPane({ storeState: 'read-only' })
    expect(screen.getByText(new RegExp(copy.readOnlyEmpty.split('（')[0]))).toBeTruthy()
    expect(screen.queryByText(/还没有设备/)).toBeNull()
  })

  it('有设备行时正常渲染列表', () => {
    render(
      <DeviceListPane
        devices={[baseDevice]}
        selectedId="d1"
        storeTrusted
        metaWritable
        storeState="ok"
        loadError={null}
        onRetryLoad={vi.fn()}
        onSelect={vi.fn()}
        onStart={vi.fn()}
        onStop={vi.fn()}
        onCancelStart={vi.fn()}
        onCopySerial={vi.fn()}
        onDelete={vi.fn()}
        onRename={vi.fn()}
        onEdit={vi.fn()}
      />
    )
    expect(screen.getByText('Pixel test')).toBeTruthy()
  })
})
