import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Device, NetworkState } from '@shared/types'
import { useDeviceStore } from '../../stores/deviceStore'
import { useNetworkSwitch } from '../useNetworkSwitch'

const set = vi.fn<
  (
    id: string,
    target: 'airplane' | 'wifi' | 'data',
    enabled: boolean
  ) => Promise<{
    state: NetworkState | null
  }>
>()
const show = vi.fn<
  (options: { title: string; message: string; buttons: string[] }) => Promise<unknown>
>(async () => undefined)

const device = (status: Device['status']): Device =>
  ({ id: 'd1', name: '测试设备', status }) as unknown as Device

const online: NetworkState = { airplane: false, wifi: true, data: true }

beforeEach(() => {
  vi.clearAllMocks()
  ;(window as { api?: unknown }).api = {
    network: { set },
    dialog: { show }
  }
  useDeviceStore.setState({ network: { d1: online } })
})

afterEach(() => {
  cleanup()
  delete (window as { api?: unknown }).api
})

describe('useNetworkSwitch（plan 2026-10-12-network-switch-group）', () => {
  it('toggle 成功：按当前态翻转目标、busy 流转、读回态直写 store', async () => {
    set.mockResolvedValue({ state: { airplane: true, wifi: true, data: true } })
    const { result } = renderHook(() => useNetworkSwitch(device('running')))
    expect(result.current.state).toEqual(online)
    let pending: Promise<void> | null = null
    act(() => {
      pending = result.current.toggle('airplane')
    })
    expect(result.current.busyTarget).toBe('airplane')
    await act(async () => {
      await pending
    })
    expect(set).toHaveBeenCalledWith('d1', 'airplane', true)
    expect(result.current.busyTarget).toBeNull()
    expect(useDeviceStore.getState().network.d1).toEqual({
      airplane: true,
      wifi: true,
      data: true
    })
  })

  it('读回为 null（命令成功但读暂不可用）：不写 store、不弹窗，等轮询补推', async () => {
    set.mockResolvedValue({ state: null })
    const { result } = renderHook(() => useNetworkSwitch(device('running')))
    await act(async () => {
      await result.current.toggle('wifi')
    })
    expect(set).toHaveBeenCalledWith('d1', 'wifi', false)
    expect(useDeviceStore.getState().network.d1).toEqual(online)
    expect(show).not.toHaveBeenCalled()
  })

  it('失败：原生 dialog 展示主进程错误文案；store 不动', async () => {
    set.mockRejectedValue(new Error('networkCommandFailed:{"detail":"svc: boom"}'))
    const { result } = renderHook(() => useNetworkSwitch(device('running')))
    await act(async () => {
      await result.current.toggle('data')
    })
    expect(show).toHaveBeenCalledTimes(1)
    const payload = show.mock.calls[0][0] as { title: string; message: string }
    expect(payload.title).toBe('网络开关操作失败')
    expect(payload.message).toContain('networkCommandFailed')
    expect(useDeviceStore.getState().network.d1).toEqual(online)
  })

  it('网络态未知（无初值）：toggle 空操作，不触 IPC', async () => {
    useDeviceStore.setState({ network: {} })
    const { result } = renderHook(() => useNetworkSwitch(device('running')))
    expect(result.current.state).toBeNull()
    await act(async () => {
      await result.current.toggle('airplane')
    })
    expect(set).not.toHaveBeenCalled()
  })

  it('busy 期间再点其他目标：第二发被吞（同设备串行）', async () => {
    let release: (() => void) | null = null
    set.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ state: online })
        })
    )
    const { result } = renderHook(() => useNetworkSwitch(device('running')))
    let pending: Promise<void> | null = null
    act(() => {
      pending = result.current.toggle('airplane')
    })
    await act(async () => {
      await result.current.toggle('wifi')
    })
    expect(set).toHaveBeenCalledTimes(1)
    release!()
    await act(async () => {
      await pending
    })
    expect(result.current.busyTarget).toBeNull()
  })
})
