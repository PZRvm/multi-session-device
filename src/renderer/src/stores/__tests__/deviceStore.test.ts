import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Device } from '@shared/types'
import { useDeviceStore } from '../deviceStore'

const device = (overrides: Partial<Device> = {}): Device => ({
  id: 'd1',
  name: 'Pixel 8 API 34',
  profileId: 'pixel_8',
  profileLabel: 'Pixel 8',
  apiLevel: 34,
  variant: 'google_apis',
  createdAt: 0,
  status: 'stopped',
  ...overrides
})

const listCalls = {
  list: vi.fn<() => Promise<Device[]>>(),
  create: vi.fn<() => Promise<Device[]>>(),
  rename: vi.fn<() => Promise<Device[]>>(),
  remove: vi.fn<() => Promise<Device[]>>(),
  setRunning: vi.fn<() => Promise<Device[]>>(),
  onChanged: vi.fn<(callback: unknown) => () => void>(() => () => {})
}

describe('deviceStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(window as unknown as { api: unknown }).api = { devices: listCalls }
    useDeviceStore.setState({ devices: [], selectedId: null, loaded: false })
  })

  it('load：拉取列表并选中首台，loaded 落定', async () => {
    listCalls.list.mockResolvedValue([device(), device({ id: 'd2' })])
    await useDeviceStore.getState().load()
    const state = useDeviceStore.getState()
    expect(state.devices).toHaveLength(2)
    expect(state.selectedId).toBe('d1')
    expect(state.loaded).toBe(true)
  })

  it('load 失败：loaded 仍落定，不卡加载态', async () => {
    listCalls.list.mockRejectedValue(new Error('boom'))
    await useDeviceStore.getState().load()
    expect(useDeviceStore.getState().loaded).toBe(true)
    expect(useDeviceStore.getState().devices).toHaveLength(0)
  })

  it('create：以 handler 返回的新列表为准，选中新设备（主进程追加在尾部）', async () => {
    useDeviceStore.setState({ devices: [device()], selectedId: 'd1' })
    const created = device({ id: 'new', name: '新设备' })
    listCalls.create.mockResolvedValue([device(), created])
    const result = await useDeviceStore.getState().create({
      profileId: 'pixel_8',
      profileLabel: 'Pixel 8',
      apiLevel: 34,
      variant: 'google_apis',
      name: '新设备'
    })
    expect(result.ok).toBe(true)
    expect(useDeviceStore.getState().selectedId).toBe('new')
    expect(useDeviceStore.getState().devices.map((d) => d.id)).toEqual(['d1', 'new'])
  })

  it('remove：删除选中设备后选中回落到首台', async () => {
    useDeviceStore.setState({ devices: [device(), device({ id: 'd2' })], selectedId: 'd1' })
    listCalls.remove.mockResolvedValue([device({ id: 'd2' })])
    await useDeviceStore.getState().remove('d1')
    expect(useDeviceStore.getState().selectedId).toBe('d2')
  })

  it('setRunning：以返回列表覆盖镜像', async () => {
    useDeviceStore.setState({ devices: [device()], selectedId: 'd1' })
    listCalls.setRunning.mockResolvedValue([device({ status: 'running' })])
    await useDeviceStore.getState().setRunning('d1', true)
    expect(useDeviceStore.getState().devices[0].status).toBe('running')
  })

  it('命令失败：镜像不动，返回 ok:false', async () => {
    useDeviceStore.setState({ devices: [device()], selectedId: 'd1' })
    listCalls.rename.mockRejectedValue(new Error('非法的名称'))
    const result = await useDeviceStore.getState().rename('d1', '')
    expect(result.ok).toBe(false)
    expect(useDeviceStore.getState().devices).toHaveLength(1)
  })

  it('applyDevices（changed 推送）：覆盖列表并维护选中态', () => {
    useDeviceStore.setState({ devices: [device()], selectedId: 'd1' })
    useDeviceStore.getState().applyDevices([device({ id: 'd2' }), device({ id: 'd3' })])
    expect(useDeviceStore.getState().devices.map((d) => d.id)).toEqual(['d2', 'd3'])
    expect(useDeviceStore.getState().selectedId).toBe('d2')

    useDeviceStore.getState().applyDevices([])
    expect(useDeviceStore.getState().selectedId).toBeNull()
  })

  it('applyDevices：选中的设备仍在列表时保持不动', () => {
    useDeviceStore.setState({ devices: [device({ id: 'd2' })], selectedId: 'd2' })
    useDeviceStore.getState().applyDevices([device({ id: 'd1' }), device({ id: 'd2' })])
    expect(useDeviceStore.getState().selectedId).toBe('d2')
  })
})
