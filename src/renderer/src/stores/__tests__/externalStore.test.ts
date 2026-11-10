import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useExternalStore } from '../externalStore'
import type { ExternalDevice } from '@shared/types'

const device = (id: string, state: ExternalDevice['state'] = 'device'): ExternalDevice => ({
  id,
  serial: id,
  transport: 'usb',
  state,
  model: id === 'A' ? 'Pixel_6' : null
})

describe('externalStore（真机列表状态）', () => {
  beforeEach(() => {
    useExternalStore.setState({ devices: [], selectedId: null })
  })

  it('apply 全量替换列表', () => {
    useExternalStore.getState().apply([device('A'), device('B', 'unauthorized')])
    expect(useExternalStore.getState().devices).toHaveLength(2)
    expect(useExternalStore.getState().devices[1]?.state).toBe('unauthorized')
  })

  it('选中设备消失（拔线）即清选中', () => {
    useExternalStore.getState().apply([device('A')])
    useExternalStore.getState().select('A')
    useExternalStore.getState().apply([])
    expect(useExternalStore.getState().selectedId).toBeNull()
  })

  it('选中健在时推送不丢选中', () => {
    useExternalStore.getState().apply([device('A')])
    useExternalStore.getState().select('A')
    useExternalStore.getState().apply([device('A'), device('B')])
    expect(useExternalStore.getState().selectedId).toBe('A')
  })

  it('select(null) 主动清空', () => {
    useExternalStore.getState().apply([device('A')])
    useExternalStore.getState().select('A')
    useExternalStore.getState().select(null)
    expect(useExternalStore.getState().selectedId).toBeNull()
  })

  it('网络态（S4）：直写独立 map，设备消失时随 apply prune', () => {
    useExternalStore.getState().apply([device('A'), device('B')])
    useExternalStore.getState().applyNetworkState('A', { airplane: false, wifi: true, data: true })
    useExternalStore.getState().applyNetworkState('B', { airplane: true, wifi: false, data: false })
    expect(useExternalStore.getState().network['A']).toEqual({
      airplane: false,
      wifi: true,
      data: true
    })
    useExternalStore.getState().apply([device('A')])
    expect(Object.keys(useExternalStore.getState().network)).toEqual(['A'])
  })

  it('网络态迟到写回（review P3-3）：设备已不在场时拒绝——不复活死键', () => {
    useExternalStore.getState().apply([device('A')])
    useExternalStore.getState().apply([])
    useExternalStore
      .getState()
      .applyNetworkState('A', { airplane: false, wifi: false, data: false })
    expect(useExternalStore.getState().network).toEqual({})
  })
})

describe('externalStore.reorder（plan 2026-11-09：乐观换序 + 失败重拉收敛）', () => {
  afterEach(() => {
    delete (window as unknown as { api?: unknown }).api
  })

  it('乐观换序（引用原样移动、选中保留）+ 应答全量替换收敛', async () => {
    const a = device('A')
    const b = device('B')
    useExternalStore.setState({ devices: [a, b], selectedId: 'A' })
    const reorderExternal = vi.fn().mockResolvedValue([b, a])
    ;(window as unknown as { api: unknown }).api = { devices: { reorderExternal } }
    useExternalStore.getState().reorder(['B', 'A'])
    expect(useExternalStore.getState().devices[0]).toBe(b)
    await vi.waitFor(() => expect(reorderExternal).toHaveBeenCalled())
    expect(useExternalStore.getState().devices.map((entry) => entry.id)).toEqual(['B', 'A'])
    expect(useExternalStore.getState().selectedId).toBe('A')
  })

  it('失败重拉收敛', async () => {
    useExternalStore.setState({ devices: [device('A'), device('B')] })
    const reorderExternal = vi.fn().mockRejectedValue(new Error('race'))
    const listExternal = vi.fn().mockResolvedValue([device('A'), device('B')])
    ;(window as unknown as { api: unknown }).api = { devices: { reorderExternal, listExternal } }
    useExternalStore.getState().reorder(['B', 'A'])
    await vi.waitFor(() => expect(listExternal).toHaveBeenCalled())
    expect(useExternalStore.getState().devices.map((entry) => entry.id)).toEqual(['A', 'B'])
  })
})
