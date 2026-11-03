// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  buildReplay,
  CACHE_MAX_PACKETS,
  CONFIG_MAX_BYTES,
  GopCache,
  type CachedPacket
} from '../cache'

const configPacket = {
  seq: 0,
  type: 'configuration' as const,
  data: new Uint8Array([1, 2, 3])
}

const dataPacket = (
  seq: number,
  keyframe = false,
  pts = seq * 33_000,
  size = 10
): CachedPacket => ({
  seq,
  type: 'data' as const,
  pts,
  keyframe,
  data: new Uint8Array(size)
})

describe('GopCache', () => {
  it('配置与关键帧链：回放 = 配置 + 从最新关键帧起的整链', () => {
    const cache = new GopCache()
    cache.push(configPacket)
    cache.push(dataPacket(1, true))
    cache.push(dataPacket(2))
    cache.push(dataPacket(3))
    const replay = buildReplay(cache)!
    expect(replay).toHaveLength(4)
    expect(replay[0].type).toBe('configuration')
    expect(replay[1].keyframe).toBe(true)
  })

  it('新关键帧到来：旧链整链废弃（不留坏 P 帧依赖）', () => {
    const cache = new GopCache()
    cache.push(configPacket)
    cache.push(dataPacket(1, true))
    cache.push(dataPacket(2))
    cache.push(dataPacket(3, true))
    cache.push(dataPacket(4))
    const snap = cache.snapshot()
    expect(snap.chain.map((packet) => packet.seq)).toEqual([3, 4])
  })

  it('无配置或无关键帧：不可回放', () => {
    const onlyData = new GopCache()
    onlyData.push(dataPacket(1, true))
    expect(buildReplay(onlyData)).toBeNull()

    const onlyConfig = new GopCache()
    onlyConfig.push(configPacket)
    expect(buildReplay(onlyConfig)).toBeNull()
  })

  it('配置包超预算：抛错', () => {
    const cache = new GopCache()
    expect(() =>
      cache.push({ seq: 0, type: 'configuration', data: new Uint8Array(CONFIG_MAX_BYTES + 1) })
    ).toThrow('配置包超预算')
  })

  it(`包数超限（>${CACHE_MAX_PACKETS}，静态画面）：清链等新关键帧`, () => {
    const cache = new GopCache()
    cache.push(configPacket)
    cache.push(dataPacket(1, true, 0)) // PTS 恒 0：只有包数会触限
    for (let seq = 2; seq <= CACHE_MAX_PACKETS + 5; seq += 1) cache.push(dataPacket(seq, false, 0))
    const snap = cache.snapshot()
    expect(snap.chain).toHaveLength(0) // 清空整链，不保留中间段
  })

  it('清链后的裸 delta 被丢弃，直到新关键帧', () => {
    const cache = new GopCache()
    cache.push(configPacket)
    cache.push(dataPacket(1, true, 0))
    for (let seq = 2; seq <= 50; seq += 1) cache.push(dataPacket(seq, false, 0))
    cache.push(dataPacket(51, false, 2_000_000)) // 2s（微秒）跨度超限 → 清链
    cache.push(dataPacket(52, false, 2_033_000)) // 裸 delta：丢弃
    expect(cache.snapshot().chain).toHaveLength(0)
    cache.push(dataPacket(53, true, 2_066_000)) // 新关键帧：重建链
    expect(cache.snapshot().chain.map((packet) => packet.seq)).toEqual([53])
  })

  it('PTS 跨度超 1.5s：清链；静态画面（PTS 不增长）可一直保留', () => {
    const cache = new GopCache()
    cache.push(configPacket)
    cache.push(dataPacket(1, true, 0))
    // 静态：PTS 不增长，包数与字节都在限内
    for (let seq = 2; seq <= 50; seq += 1) cache.push(dataPacket(seq, false, 0))
    expect(cache.snapshot().chain).toHaveLength(50)
    // PTS 跨度超限 → 清链
    cache.push(dataPacket(51, false, 2_000_000))
    expect(cache.snapshot().chain).toHaveLength(0)
  })

  it('真实微秒 PTS：33ms 帧间隔不清链，恰好 1.5s 仍可回放，超过才清链', () => {
    const cache = new GopCache()
    cache.push(configPacket)
    cache.push(dataPacket(1, true, 5_000_000))
    cache.push(dataPacket(2, false, 5_033_000))
    expect(buildReplay(cache)?.map((packet) => packet.seq)).toEqual([0, 1, 2])
    cache.push(dataPacket(3, false, 6_500_000))
    expect(buildReplay(cache)?.map((packet) => packet.seq)).toEqual([0, 1, 2, 3])
    cache.push(dataPacket(4, false, 6_500_001))
    expect(buildReplay(cache)).toBeNull()
  })
})
