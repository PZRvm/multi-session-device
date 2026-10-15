import type { ScreenPacketType } from '@shared/types'

/** 缓存预算（设计值）：超限清空整链等新关键帧，保证内存有界且不保留坏 P 帧依赖 */
export const CACHE_MAX_BYTES = 8 * 1024 * 1024
export const CACHE_MAX_PACKETS = 120
export const CACHE_MAX_PTS_SPAN_MS = 1_500
/** 相邻帧间隔超过此值视为 idle 空档：连续跨度归零但保留链（2026-10-15 修复 A） */
export const CACHE_IDLE_GAP_RESET_MS = 500
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
  /** 连续帧跨度（ms）：只累计相邻帧间隔，idle 空档归零（2026-10-15 修复 A） */
  #continuousSpanMs = 0
  #lastPts: number | null = null

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
    // 跨度只看相邻间隔（修复 A）：单个大间隔是 idle 空档（息屏/静止），不是回放
    // 负担——归零累计但保留链。旧算法（末减首）会在唤醒首帧把唯一 GOP 清掉，
    // 实测荣耀 IDR 间隔≈∞，缓存从此恒不可回放（见 issue 2026-10-15-刚连上首操作
    // 画面冻结数秒）。内存有界仍由包数/字节预算兜底。
    // 注意 pts 是 scrcpy 微秒——与毫秒常量比较前先归一（旧代码 µs 比 ms，跨度
    // 检查实际 1.5ms 即清链，真实流第二帧就清，比诊断更糟；旧测试喂 ms 值掩盖了）
    if (packet.pts !== undefined) {
      if (this.#lastPts !== null) {
        const gapMs = (packet.pts - this.#lastPts) / 1000
        if (gapMs > CACHE_IDLE_GAP_RESET_MS) this.#continuousSpanMs = 0
        else if (gapMs > 0) this.#continuousSpanMs += gapMs
      }
      this.#lastPts = packet.pts
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
    // 连续运动超跨度才清链（清就是整链废弃）；idle 空档不触发
    while (
      this.#chain.length > CACHE_MAX_PACKETS ||
      this.#bytes > CACHE_MAX_BYTES ||
      this.#continuousSpanMs > CACHE_MAX_PTS_SPAN_MS
    ) {
      this.clearChain()
    }
  }

  clearChain(): void {
    this.#chain = []
    this.#bytes = 0
    this.#continuousSpanMs = 0
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
