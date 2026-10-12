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
      sourceBucket="app-owned"
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
        sourceBucket="app-owned"
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

  it('出身过滤视图（plan 2026-10-12-device-list-origin-view-filter）：跨桶设备进折叠区，过渡态豁免，展开后独立分区', () => {
    const owned = { ...baseDevice, id: 'd-owned', name: '自有机' }
    const shared = {
      ...baseDevice,
      id: 'd-shared',
      name: '共享机',
      imageSourceOrigin: 'shared-studio' as const
    }
    const sharedRunning = {
      ...shared,
      id: 'd-shared-running',
      name: '共享运行机',
      status: 'running' as const,
      serial: 'emulator-5554'
    }
    // 当前桶 app-owned：自有平铺、共享运行机豁免可见、共享停止机进折叠区
    renderPane({ devices: [owned, sharedRunning, shared], sourceBucket: 'app-owned' })
    expect(screen.getByText('自有机')).toBeTruthy()
    expect(screen.getByText('共享运行机')).toBeTruthy()
    expect(screen.queryByText('共享机')).toBeNull()
    expect(screen.getByText(format(copy.otherOriginStudio, { count: 1 }))).toBeTruthy()
    // 展开：独立分区呈现，标注照旧
    fireEvent.click(
      screen.getByRole('button', { name: format(copy.otherOriginStudio, { count: 1 }) })
    )
    expect(screen.getByText('共享机')).toBeTruthy()
    // 收起
    fireEvent.click(
      screen.getByRole('button', { name: format(copy.otherOriginStudio, { count: 1 }) })
    )
    expect(screen.queryByText('共享机')).toBeNull()
  })

  it('出身过滤视图：共享桶视图下折叠行文案切换为「项目自有」', () => {
    const owned = { ...baseDevice, id: 'd-owned', name: '自有机' }
    renderPane({ devices: [owned], sourceBucket: 'shared-studio' })
    expect(screen.queryByText('自有机')).toBeNull()
    expect(screen.getByText(format(copy.otherOriginOwned, { count: 1 }))).toBeTruthy()
  })

  it('缺席出身（存量）回落 app-owned 归属', () => {
    renderPane({ devices: [baseDevice], sourceBucket: 'shared-studio' })
    expect(screen.queryByText('Pixel test')).toBeNull()
    renderPane({ devices: [baseDevice], sourceBucket: 'app-owned' })
    expect(screen.getByText('Pixel test')).toBeTruthy()
  })
})
