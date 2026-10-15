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

const dataPacket = (seq: number, keyframe = false, pts = seq * 33, size = 10): CachedPacket => ({
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
    // 连续运动累计跨度超限 → 清链（pts µs：33ms/帧，46 帧 ≈ 1.52s）
    for (let seq = 2; seq <= 47; seq += 1) {
      cache.push(dataPacket(seq, false, (seq - 1) * 33_000))
    }
    cache.push(dataPacket(48, false, 47 * 33_000)) // 裸 delta：丢弃
    expect(cache.snapshot().chain).toHaveLength(0)
    cache.push(dataPacket(53, true, 2_066_000)) // 新关键帧：重建链
    expect(cache.snapshot().chain.map((packet) => packet.seq)).toEqual([53])
  })

  it('跨度只算连续帧间隔：idle 空档（单个大间隔）归零跨度但保留链（修复 A）', () => {
    const cache = new GopCache()
    cache.push(configPacket)
    cache.push(dataPacket(1, true, 0))
    for (let seq = 2; seq <= 50; seq += 1) cache.push(dataPacket(seq, false, 0))
    expect(cache.snapshot().chain).toHaveLength(50)
    // 唤醒/恢复场景：间隔 10s（pts µs）的单帧（>idle 阈值 500ms）——链保留、跨度归零
    cache.push(dataPacket(51, false, 10_000_000))
    expect(cache.hasKeyframe).toBe(true)
    expect(cache.snapshot().chain).toHaveLength(51)
  })

  it('连续运动累计跨度超 1.5s：仍清链（pts µs，33ms/帧逐帧累加）', () => {
    const cache = new GopCache()
    cache.push(configPacket)
    cache.push(dataPacket(1, true, 0))
    // 60fps 连续运动：每帧 +33ms，累计超 1.5s（46 帧 ≈ 1.52s）后清链
    for (let seq = 2; seq <= 47; seq += 1) {
      cache.push(dataPacket(seq, false, (seq - 1) * 33_000))
    }
    expect(cache.snapshot().chain).toHaveLength(0)
  })
})
