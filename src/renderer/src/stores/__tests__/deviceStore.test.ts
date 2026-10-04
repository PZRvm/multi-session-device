import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CreateDeviceResult, Device, DeviceSnapshot } from '@shared/types'
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

const snapshot = (devices: Device[], revision: number): DeviceSnapshot => ({ revision, devices })

const apiCalls = {
  list: vi.fn<() => Promise<DeviceSnapshot>>(),
  create: vi.fn<() => Promise<CreateDeviceResult>>(),
  rename: vi.fn<() => Promise<DeviceSnapshot>>(),
  remove: vi.fn<() => Promise<DeviceSnapshot>>(),
  start: vi.fn<() => Promise<DeviceSnapshot>>(),
  stop: vi.fn<() => Promise<DeviceSnapshot>>(),
  cancelStart: vi.fn<() => Promise<DeviceSnapshot>>(),
  copySerial: vi.fn<() => Promise<void>>(),
  onChanged: vi.fn<(callback: unknown) => () => void>(() => () => {}),
  onRuntimeError: vi.fn<(callback: unknown) => () => void>(() => () => {})
}

describe('deviceStore（快照 + revision 守卫）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(window as unknown as { api: unknown }).api = { devices: apiCalls }
    useDeviceStore.setState({ devices: [], selectedId: null, revision: -1, loaded: false })
  })

  it('load：拉取快照并选中首台，loaded 落定', async () => {
    apiCalls.list.mockResolvedValue(snapshot([device(), device({ id: 'd2' })], 1))
    await useDeviceStore.getState().load()
    const state = useDeviceStore.getState()
    expect(state.devices).toHaveLength(2)
    expect(state.selectedId).toBe('d1')
    expect(state.revision).toBe(1)
    expect(state.loaded).toBe(true)
  })

  it('load 失败：loaded 仍落定，不卡加载态', async () => {
    apiCalls.list.mockRejectedValue(new Error('boom'))
    await useDeviceStore.getState().load()
    expect(useDeviceStore.getState().loaded).toBe(true)
    expect(useDeviceStore.getState().devices).toHaveLength(0)
  })

  it('较旧 revision 的快照被忽略（旧 invoke 结果不覆盖新推送）', async () => {
    useDeviceStore.setState({ revision: 5, devices: [device()] })
    useDeviceStore.getState().applySnapshot(snapshot([device({ status: 'starting' })], 3))
    expect(useDeviceStore.getState().devices[0].status).toBe('stopped')
    // 同代次幂等应用
    useDeviceStore.getState().applySnapshot(snapshot([device({ status: 'running' })], 5))
    expect(useDeviceStore.getState().devices[0].status).toBe('running')
  })

  it('create：按 createdId 选中新设备（不依赖数组尾部）', async () => {
    useDeviceStore.setState({ devices: [device()], selectedId: 'd1' })
    apiCalls.create.mockResolvedValue({
      createdId: 'new',
      snapshot: snapshot([device(), device({ id: 'new', name: '新设备' })], 2)
    })
    const result = await useDeviceStore.getState().create({
      profileId: 'pixel_8',
      profileLabel: 'Pixel 8',
      apiLevel: 34,
      variant: 'google_apis',
      name: '新设备'
    })
    expect(result.ok).toBe(true)
    expect(useDeviceStore.getState().selectedId).toBe('new')
  })

  it('start/stop/cancelStart：以返回快照覆盖镜像', async () => {
    useDeviceStore.setState({ devices: [device()], selectedId: 'd1' })
    apiCalls.start.mockResolvedValue(
      snapshot([{ ...device(), status: 'starting', serial: 'emulator-5554', runId: 'r1' }], 2)
    )
    await useDeviceStore.getState().start('d1')
    expect(useDeviceStore.getState().devices[0].status).toBe('starting')
    expect(useDeviceStore.getState().devices[0].serial).toBe('emulator-5554')

    apiCalls.stop.mockResolvedValue(snapshot([device()], 3))
    await useDeviceStore.getState().stop('d1')
    expect(useDeviceStore.getState().devices[0].status).toBe('stopped')

    apiCalls.cancelStart.mockResolvedValue(snapshot([device()], 4))
    await useDeviceStore.getState().cancelStart('d1')
    expect(useDeviceStore.getState().devices[0].status).toBe('stopped')
  })

  it('命令失败：镜像不动，返回 ok:false', async () => {
    useDeviceStore.setState({ devices: [device()], selectedId: 'd1' })
    apiCalls.rename.mockRejectedValue(new Error('非法的名称'))
    const result = await useDeviceStore.getState().rename('d1', '')
    expect(result.ok).toBe(false)
    expect(useDeviceStore.getState().devices).toHaveLength(1)
  })

  it('applySnapshot（changed 推送）：覆盖列表并维护选中态', () => {
    useDeviceStore.setState({ devices: [device()], selectedId: 'd1', revision: 1 })
    useDeviceStore
      .getState()
      .applySnapshot(snapshot([device({ id: 'd2' }), device({ id: 'd3' })], 2))
    expect(useDeviceStore.getState().devices.map((d) => d.id)).toEqual(['d2', 'd3'])
    expect(useDeviceStore.getState().selectedId).toBe('d2')

    useDeviceStore.getState().applySnapshot(snapshot([], 3))
    expect(useDeviceStore.getState().selectedId).toBeNull()
  })

  it('applySnapshot：选中的设备仍在列表时保持不动', () => {
    useDeviceStore.setState({ devices: [device({ id: 'd2' })], selectedId: 'd2', revision: 1 })
    useDeviceStore
      .getState()
      .applySnapshot(snapshot([device({ id: 'd1' }), device({ id: 'd2' })], 2))
    expect(useDeviceStore.getState().selectedId).toBe('d2')
  })

  it('remove：删除选中设备后选中回落到首台', async () => {
    useDeviceStore.setState({ devices: [device(), device({ id: 'd2' })], selectedId: 'd1' })
    apiCalls.remove.mockResolvedValue(snapshot([device({ id: 'd2' })], 2))
    await useDeviceStore.getState().remove('d1')
    expect(useDeviceStore.getState().selectedId).toBe('d2')
  })
})
