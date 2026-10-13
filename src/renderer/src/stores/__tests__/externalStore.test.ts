import { beforeEach, describe, expect, it } from 'vitest'
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
})
