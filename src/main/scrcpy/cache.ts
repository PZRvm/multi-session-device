import type { ScreenPacketType } from '@shared/types'

/** 缓存预算（设计值）：超限清空整链等新关键帧，保证内存有界且不保留坏 P 帧依赖 */
export const CACHE_MAX_BYTES = 8 * 1024 * 1024
export const CACHE_MAX_PACKETS = 120
export const CACHE_MAX_PTS_SPAN_MS = 1_500
/** 配置包单独限额 */
export const CONFIG_MAX_BYTES = 64 * 1024

export interface CachedPacket {
  seq: number
  type: ScreenPacketType
  pts?: number
  keyframe?: boolean
  data: Uint8Array
}

export interface CacheSnapshot {
  config: CachedPacket | null
  /** 从最新关键帧起的完整包链（可能为空：尚无关键帧） */
  chain: CachedPacket[]
}

/**
 * 有界 GOP 缓存：最新配置 + 最新关键帧起的完整包链。
 * 按编码 PTS 与字节管理，不按静置墙钟年龄丢弃（静态画面可立刻回放）。
 */
export class GopCache {
  #config: CachedPacket | null = null
  #chain: CachedPacket[] = []
  #bytes = 0
  /** 清链后等待新关键帧：裸 delta 依赖已废弃的链，不得重新积压 */
  #awaitingKeyframe = false

  push(packet: CachedPacket): void {
    if (packet.type === 'configuration') {
      if (packet.data.byteLength > CONFIG_MAX_BYTES) {
        throw new Error(`配置包超预算（${packet.data.byteLength} > ${CONFIG_MAX_BYTES}）`)
      }
      this.#config = packet
      this.clearChain()
      this.#awaitingKeyframe = false
      return
    }
    if (packet.keyframe) {
      this.clearChain()
      this.#awaitingKeyframe = false
    } else if (this.#awaitingKeyframe) {
      return
    }
    this.#chain.push(packet)
    this.#bytes += packet.data.byteLength
    this.#trim()
  }

  #trim(): void {
    // 静态 GOP 的 PTS 不增长：只有包数/字节超限才清链，清就是整链废弃
    while (
      this.#chain.length > CACHE_MAX_PACKETS ||
      this.#bytes > CACHE_MAX_BYTES ||
      this.#ptsSpan() > CACHE_MAX_PTS_SPAN_MS
    ) {
      this.clearChain()
    }
  }

  #ptsSpan(): number {
    const first = this.#chain[0]
    const last = this.#chain.at(-1)
    if (!first || !last || first.pts === undefined || last.pts === undefined) return 0
    return Math.max(0, last.pts - first.pts)
  }

  clearChain(): void {
    this.#chain = []
    this.#bytes = 0
    this.#awaitingKeyframe = true
  }

  snapshot(): CacheSnapshot {
    return { config: this.#config, chain: [...this.#chain] }
  }

  get hasKeyframe(): boolean {
    return this.#chain.length > 0
  }
}

/**
 * 回放序列：配置 + 完整链。缓存不可用时返回 null（调用方走 resetVideo 等新配置）。
 * main 在串行包流中衔接回放与实时包，seq 连续不重复。
 */
export function buildReplay(cache: GopCache): CachedPacket[] | null {
  const snap = cache.snapshot()
  if (!snap.config || snap.chain.length === 0) return null
  return [snap.config, ...snap.chain]
}
