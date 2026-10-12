import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CreateDeviceResult, Device, DeviceSnapshot, ReconcileResult } from '@shared/types'
import { useDeviceStore } from '../deviceStore'

const device = (overrides: Partial<Device> = {}): Device => ({
  id: 'd1',
  name: 'Pixel 8 API 34',
  profileId: 'pixel_8',
  profileLabel: 'Pixel 8',
  imagePackageName: 'system-images;android-34;google_apis;arm64-v8a',
  apiDisplay: '34',
  formFactor: 'phone',
  screenSummary: { widthPx: 1080, heightPx: 2400, diagonalInches: 6.2 },
  advancedSettings: null,
  snapshotReadyAt: null,
  createdAt: 0,
  status: 'stopped',
  ...overrides
})

const snapshot = (
  devices: Device[],
  revision: number,
  extras: Partial<DeviceSnapshot> = {}
): DeviceSnapshot => ({
  revision,
  devices,
  storeHealth: { state: 'ok', issues: [] },
  reconciliation: {
    signature: null,
    unavailableCount: 0,
    orphanCount: 0,
    storeState: 'ok',
    pendingNotification: false
  },
  sourceBucket: 'app-owned',
  ...extras
})

const apiCalls = {
  list: vi.fn<() => Promise<DeviceSnapshot>>(),
  create: vi.fn<() => Promise<CreateDeviceResult>>(),
  rename: vi.fn<() => Promise<DeviceSnapshot>>(),
  remove: vi.fn<() => Promise<DeviceSnapshot>>(),
  start: vi.fn<() => Promise<DeviceSnapshot>>(),
  stop: vi.fn<() => Promise<DeviceSnapshot>>(),
  cancelStart: vi.fn<() => Promise<DeviceSnapshot>>(),
  copySerial: vi.fn<() => Promise<void>>(),
  reconcile: vi.fn<() => Promise<ReconcileResult>>(),
  reconciliationReport: vi.fn<() => Promise<unknown>>(),
  acknowledgeReconciliation: vi.fn<() => Promise<void>>(),
  onChanged: vi.fn<(callback: unknown) => () => void>(() => () => {}),
  onRuntimeError: vi.fn<(callback: unknown) => () => void>(() => () => {})
}

describe('deviceStore（快照 + revision 守卫）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(window as unknown as { api: unknown }).api = { devices: apiCalls }
    useDeviceStore.setState({
      devices: [],
      selectedId: null,
      revision: -1,
      loaded: false,
      loadError: null,
      storeHealth: { state: 'ok', issues: [] },
      reconciliation: {
        signature: null,
        unavailableCount: 0,
        orphanCount: 0,
        storeState: 'ok',
        pendingNotification: false
      },
      network: {}
    })
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

  it('load 失败：loaded 仍落定并保留 loadError（读取失败 ≠ 空库）', async () => {
    apiCalls.list.mockRejectedValue(new Error('boom'))
    await useDeviceStore.getState().load()
    const state = useDeviceStore.getState()
    expect(state.loaded).toBe(true)
    expect(state.devices).toHaveLength(0)
    expect(state.loadError).toBe('boom')
    // 后续成功 load 清掉错误
    apiCalls.list.mockResolvedValue(snapshot([device()], 1))
    await useDeviceStore.getState().load()
    expect(useDeviceStore.getState().loadError).toBeNull()
  })

  it('applySnapshot 消费健康字段：storeHealth 与 reconciliation 摘要进 state', () => {
    useDeviceStore.setState({ revision: -1 })
    useDeviceStore.getState().applySnapshot(
      snapshot([device()], 1, {
        storeHealth: {
          state: 'read-only',
          issues: [{ code: 'metadata-changed', message: '外部修改' }]
        },
        reconciliation: {
          signature: 'sig-1',
          unavailableCount: 1,
          orphanCount: 2,
          storeState: 'read-only',
          pendingNotification: true
        }
      })
    )
    const state = useDeviceStore.getState()
    expect(state.storeHealth.state).toBe('read-only')
    expect(state.reconciliation.signature).toBe('sig-1')
    expect(state.reconciliation.pendingNotification).toBe(true)
  })

  it('reconcile：应用合并快照，失败返回 ok:false', async () => {
    useDeviceStore.setState({ devices: [device()], revision: 1 })
    apiCalls.reconcile.mockResolvedValue({
      snapshot: snapshot(
        [device({ availability: { state: 'missing', issues: [], checkedAt: 2 } })],
        2
      ),
      report: {
        revision: 2,
        signature: 's',
        checkedAt: 2,
        storeHealth: { state: 'ok', issues: [] },
        deviceIssues: [],
        orphanEntries: [],
        unrecognizedCount: 0,
        pendingIds: [],
        scanError: null,
        pendingNotification: false
      }
    })
    const ok = await useDeviceStore.getState().reconcile()
    expect(ok.ok).toBe(true)
    expect(useDeviceStore.getState().devices[0].availability?.state).toBe('missing')

    apiCalls.reconcile.mockRejectedValue(new Error('检查服务异常'))
    const failed = await useDeviceStore.getState().reconcile()
    expect(failed.ok).toBe(false)
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
      imagePackageName: 'system-images;android-34;google_apis;arm64-v8a',
      name: '新设备',
      advancedSettings: null
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

describe('deviceStore 网络态切片（plan 2026-10-12-network-switch-group）', () => {
  beforeEach(() => {
    useDeviceStore.setState({
      devices: [],
      selectedId: null,
      revision: -1,
      network: {}
    })
  })

  it('applyNetworkState：直写设备键，不影响其余键', () => {
    useDeviceStore.setState({
      network: { d1: { airplane: false, wifi: true, data: true } }
    })
    useDeviceStore.getState().applyNetworkState('d2', { airplane: true, wifi: false, data: false })
    expect(useDeviceStore.getState().network).toEqual({
      d1: { airplane: false, wifi: true, data: true },
      d2: { airplane: true, wifi: false, data: false }
    })
  })

  it('applySnapshot：快照里消失的设备剪除网络态键', () => {
    useDeviceStore.setState({
      devices: [device(), device({ id: 'd2' })],
      network: {
        d1: { airplane: false, wifi: true, data: true },
        d2: { airplane: false, wifi: true, data: true }
      }
    })
    useDeviceStore.getState().applySnapshot(snapshot([device({ id: 'd2' })], 2))
    expect(useDeviceStore.getState().network).toEqual({
      d2: { airplane: false, wifi: true, data: true }
    })
  })

  it('applySnapshot：无过期键时网络态保持原引用（免无谓重渲染）', () => {
    const network = { d1: { airplane: false, wifi: true, data: true } }
    useDeviceStore.setState({ devices: [device()], network })
    useDeviceStore.getState().applySnapshot(snapshot([device()], 1))
    expect(useDeviceStore.getState().network).toBe(network)
  })

  it('applyNetworkStates：批量合并（刷新初值恢复）并按当前设备表剪枝（P3-1）', () => {
    useDeviceStore.setState({
      devices: [device(), device({ id: 'd2' })],
      network: { d1: { airplane: true, wifi: false, data: false } }
    })
    useDeviceStore.getState().applyNetworkStates({
      d1: { airplane: false, wifi: true, data: true },
      d2: { airplane: false, wifi: true, data: true },
      d3: { airplane: true, wifi: true, data: true }
    })
    // d1 被批量值覆盖、d2 新增、d3 不在设备表被剪除
    expect(useDeviceStore.getState().network).toEqual({
      d1: { airplane: false, wifi: true, data: true },
      d2: { airplane: false, wifi: true, data: true }
    })
  })
})

describe('活动来源桶（plan 2026-10-12-device-list-origin-view-filter）', () => {
  it('快照携带 sourceBucket：applySnapshot 覆写，缺席回落当前值', () => {
    useDeviceStore
      .getState()
      .applySnapshot(snapshot([device()], 5, { sourceBucket: 'shared-studio' }))
    expect(useDeviceStore.getState().sourceBucket).toBe('shared-studio')
  })

  it('默认桶 app-owned；来源切换后新快照翻转', () => {
    // zustand 模块级单例：前测的桶状态会泄漏，显式复位到初值再断言默认
    useDeviceStore.setState({ sourceBucket: 'app-owned', revision: -1 })
    expect(useDeviceStore.getState().sourceBucket).toBe('app-owned')
    useDeviceStore.getState().applySnapshot(snapshot([], 6, { sourceBucket: 'shared-studio' }))
    expect(useDeviceStore.getState().sourceBucket).toBe('shared-studio')
    // 快照缺席 sourceBucket → 回落当前值（?? 语义）
    useDeviceStore.getState().applySnapshot(snapshot([], 7, { sourceBucket: undefined }))
    expect(useDeviceStore.getState().sourceBucket).toBe('shared-studio')
  })
})
