import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Device, ExternalDevice } from '@shared/types'
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
      externalDevices={[]}
      selectedExternalId={null}
      onSelectExternal={vi.fn()}
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
        externalDevices={[]}
        selectedExternalId={null}
        onSelectExternal={vi.fn()}
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

  it('真机区（plan 2026-10-13-real-device-usb-and-apk-install）：组头计数、行卡标题与未授权引导', () => {
    renderPane({
      externalDevices: [
        {
          id: 'R58N',
          serial: 'R58N',
          transport: 'usb',
          state: 'unauthorized',
          model: 'Pixel_6_Pro'
        }
      ]
    })
    expect(screen.getByText(format(copy.realDeviceSectionCount, { count: 1 }))).toBeTruthy()
    expect(screen.getByText('Pixel_6_Pro')).toBeTruthy()
    expect(screen.getByText(copy.realDeviceUnauthorizedHint)).toBeTruthy()
    expect(screen.getByRole('img', { name: copy.usbTransportAria })).toBeTruthy()
  })

  it('真机区点击行选中；无真机时空态提示', () => {
    const onSelectExternal = vi.fn()
    renderPane({ externalDevices: [], onSelectExternal })
    expect(screen.getByText(copy.realDeviceEmpty)).toBeTruthy()
    renderPane({
      externalDevices: [{ id: 'X', serial: 'X', transport: 'usb', state: 'device', model: null }],
      onSelectExternal
    })
    // model 缺省：标题落 serial，元信息只带状态
    fireEvent.click(screen.getAllByText(copy.realDeviceOnline)[0])
    expect(onSelectExternal).toHaveBeenCalledWith('X')
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
    // 集成层（review P3-5）：折叠区行跨桶只读——编辑/删除禁用带说明；F2 走拦截回调
    const sharedEdit = screen.getByRole('button', {
      name: format(copy.editAria, { name: '共享机' })
    }) as HTMLButtonElement
    const sharedDelete = screen.getByRole('button', {
      name: format(copy.deleteAria, { name: '共享机' })
    }) as HTMLButtonElement
    expect(sharedEdit.disabled).toBe(true)
    expect(sharedDelete.disabled).toBe(true)
    expect(sharedEdit.title).toBe(copy.crossBucketBlockedTitle)
    const onCrossBucketBlocked = vi.fn()
    cleanup()
    renderPane({
      devices: [owned, shared],
      sourceBucket: 'app-owned',
      onCrossBucketBlocked
    })
    fireEvent.click(
      screen.getByRole('button', { name: format(copy.otherOriginStudio, { count: 1 }) })
    )
    fireEvent.keyDown(screen.getByText('共享机').parentElement!, { key: 'F2' })
    expect(onCrossBucketBlocked).toHaveBeenCalledTimes(1)
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

// ---- 无线批（plan 2026-10-15-real-device-wireless）----

const usbDevice = (over: Partial<ExternalDevice> = {}): ExternalDevice => ({
  id: 'DSLU20B12002637',
  serial: 'DSLU20B12002637',
  transport: 'usb',
  state: 'device',
  model: 'EBG_AN00',
  ...over
})

const wirelessApi = (
  over: {
    open?: () => Promise<void>
    scan?: () => Promise<unknown>
    promote?: (input: unknown) => Promise<unknown>
    disconnect?: (serial: string) => Promise<unknown>
  } = {}
): { open: ReturnType<typeof vi.fn> } => {
  const open = vi.fn(over.open ?? (async () => undefined))
  ;(window as { api?: unknown }).api = {
    devices: {
      openExternalWireless: open,
      onWirelessRecoveryChanged: () => () => {},
      getWirelessRecoveryState: async () => ({ phase: 'idle', blocked: [] }),
      scanExternalWireless: over.scan ?? vi.fn(async () => []),
      promoteExternalWireless:
        over.promote ?? vi.fn(async () => ({ ok: true, serial: '192.168.31.102:5555' })),
      disconnectExternal: over.disconnect ?? vi.fn(async () => undefined)
    }
  }
  return { open }
}

describe('真机区无线入口（plan 2026-10-15-real-device-wireless）', () => {
  it('组头常驻无线按钮 + 空态内联动作都发起开原生窗（渲染层不再有弹层）', async () => {
    const { open } = wirelessApi()
    renderPane({})
    fireEvent.click(screen.getByRole('button', { name: copy.wirelessConnectAria }))
    await waitFor(() => {
      expect(open).toHaveBeenCalledTimes(1)
    })
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: copy.wirelessConnectEmpty }))
    await waitFor(() => {
      expect(open).toHaveBeenCalledTimes(2)
    })
  })

  it('USB device 行有「转为无线」：成功后行内提示可拔线；失败带原因文案', async () => {
    wirelessApi()
    renderPane({ externalDevices: [usbDevice()] })
    fireEvent.click(screen.getByRole('button', { name: copy.wirelessPromote }))
    await waitFor(() => {
      expect(screen.getByText(copy.wirelessPromoteDone)).toBeTruthy()
    })
    cleanup()
    wirelessApi({
      promote: vi.fn(async () => ({ ok: false, reason: 'no-wifi', host: 'DSLU20B12002637' }))
    })
    renderPane({ externalDevices: [usbDevice()] })
    fireEvent.click(screen.getByRole('button', { name: copy.wirelessPromote }))
    await waitFor(() => {
      expect(screen.getByText(copy.wirelessFailNoWifi)).toBeTruthy()
    })
  })

  it('无线 device 行有「断开」；无线 offline 死条目有「删除」并走 disconnect；USB offline 无钮', async () => {
    const disconnect = vi.fn(async () => undefined)
    wirelessApi({ disconnect })
    renderPane({
      externalDevices: [
        usbDevice({
          id: '192.168.31.102:5555',
          serial: '192.168.31.102:5555',
          transport: 'wireless'
        }),
        usbDevice({
          id: '198.18.0.7:5555',
          serial: '198.18.0.7:5555',
          transport: 'wireless',
          state: 'offline'
        }),
        usbDevice({ id: 'U2', serial: 'U2', state: 'unauthorized' }),
        usbDevice({ id: 'O3', serial: 'O3', state: 'offline' })
      ]
    })
    fireEvent.click(screen.getByRole('button', { name: copy.wirelessDisconnect }))
    await waitFor(() => {
      expect(disconnect).toHaveBeenCalledWith('192.168.31.102:5555')
    })
    // 无线 offline（如 TUN 幽灵死条目）：删除入口存在，文案分流为无线引导
    fireEvent.click(screen.getByRole('button', { name: copy.wirelessDelete }))
    await waitFor(() => {
      expect(disconnect).toHaveBeenCalledWith('198.18.0.7:5555')
    })
    expect(screen.getByText(copy.realDeviceOfflineWirelessHint)).toBeTruthy()
    expect(screen.getByText(copy.realDeviceOfflineHint)).toBeTruthy()
    expect(screen.queryByRole('button', { name: copy.wirelessPromote })).toBeNull()
  })

  it('P3-10：两台设备先后断开失败，行内错误并存不互相覆盖', async () => {
    const fail = vi.fn(async () => {
      throw new Error('adb 不在线')
    })
    wirelessApi({ disconnect: fail })
    renderPane({
      externalDevices: [
        usbDevice({ id: 'A:5555', serial: 'A:5555', transport: 'wireless' }),
        usbDevice({ id: 'B:5555', serial: 'B:5555', transport: 'wireless' })
      ]
    })
    const buttons = screen.getAllByRole('button', { name: copy.wirelessDisconnect })
    expect(buttons).toHaveLength(2)
    fireEvent.click(buttons[0])
    await waitFor(() => {
      expect(screen.getByText('adb 不在线')).toBeTruthy()
    })
    fireEvent.click(buttons[1])
    await waitFor(() => {
      expect(screen.getAllByText('adb 不在线')).toHaveLength(2)
    })
  })

  it('P3-9：卸载清理自清定时器（clearTimeout 被调用）', async () => {
    wirelessApi()
    renderPane({ externalDevices: [usbDevice()] })
    fireEvent.click(screen.getByRole('button', { name: copy.wirelessPromote }))
    await waitFor(() => {
      expect(screen.getByText(copy.wirelessPromoteDone)).toBeTruthy()
    })
    const clearSpy = vi.spyOn(window, 'clearTimeout')
    cleanup()
    expect(clearSpy).toHaveBeenCalled()
    clearSpy.mockRestore()
  })

  it('转无线反馈随设备离场清账（拔线后不悬挂）', async () => {
    wirelessApi()
    const defaults = {
      devices: [],
      selectedId: null,
      storeTrusted: true,
      metaWritable: true,
      storeState: 'ok' as const,
      sourceBucket: 'app-owned' as const,
      loadError: null,
      externalDevices: [usbDevice()],
      selectedExternalId: null,
      onSelectExternal: vi.fn(),
      onRetryLoad: vi.fn(),
      onSelect: vi.fn(),
      onStart: vi.fn(),
      onStop: vi.fn(),
      onCancelStart: vi.fn(),
      onCopySerial: vi.fn(),
      onDelete: vi.fn(),
      onRename: vi.fn(),
      onEdit: vi.fn()
    }
    const { rerender } = render(<DeviceListPane {...defaults} />)
    fireEvent.click(screen.getByRole('button', { name: copy.wirelessPromote }))
    await waitFor(() => {
      expect(screen.getByText(copy.wirelessPromoteDone)).toBeTruthy()
    })
    rerender(<DeviceListPane {...defaults} externalDevices={[]} />)
    await waitFor(() => {
      expect(screen.queryByText(copy.wirelessPromoteDone)).toBeNull()
    })
  })
})

it('renders one stable recovery action group outside the section toggle', async () => {
  wirelessApi({
    promote: async () => ({
      ok: false,
      reason: 'unreachable',
      host: '192.168.31.162',
      attemptId: 'attempt',
      repairable: true,
      diagnosis: {
        kind: 'service-suspected',
        tcp: 'reachable',
        stage: 'connect',
        code: 1,
        detail: 'No route to host'
      }
    })
  })
  renderPane({ externalDevices: [usbDevice()] })
  fireEvent.click(screen.getByRole('button', { name: copy.wirelessPromote }))
  const action = await screen.findByRole('button', { name: '修复连接' })
  expect(screen.getAllByRole('button', { name: '修复连接' })).toHaveLength(1)
  expect(action.parentElement?.closest('button')).toBeNull()
})
