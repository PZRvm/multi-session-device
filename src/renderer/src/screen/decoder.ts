import { h264ParseConfiguration } from '@yume-chan/scrcpy'

export interface DecoderPacket {
  type: 'configuration' | 'data'
  seq: number
  pts?: number
  keyframe?: boolean
  data: Uint8Array
}

export interface DecoderOptions {
  /** 绘制回调：调用方画完后必须 close() 该帧 */
  onFrame: (frame: VideoFrame) => void
  onError: (error: Error) => void
}

const hexTwoDigits = (value: number): string => value.toString(16).padStart(2, '0').toUpperCase()

/**
 * 保留 PTS 的 WebCodecs 薄适配器（H.264 Annex B）。
 * 配置解析与「Annex B 配置 + 首 keyframe 合并」沿用 Tango 已验证的模式；
 * 与 PoC 的差别：timestamp 按当前 generation 内相对归零的编码 PTS 映射，
 * 保留 seq 对应关系（恢复计时以回放末包对应帧绘制为准）。
 */
export class StreamDecoder {
  readonly #decoder: VideoDecoder
  #config: { raw: Uint8Array; config: VideoDecoderConfig } | null = null
  #configured = false
  #ptsBase: number | null = null

  constructor(options: DecoderOptions) {
    this.#decoder = new VideoDecoder({
      output: (frame) => options.onFrame(frame),
      error: (error) => options.onError(new Error(error.message))
    })
  }

  get decodeQueueSize(): number {
    return this.#decoder.decodeQueueSize
  }

  /** generation 变化（新配置包）由调用方负责 reset 后再喂 */
  reset(): void {
    this.#decoder.reset()
    this.#configured = false
  }

  close(): void {
    if (this.#decoder.state !== 'closed') this.#decoder.close()
  }

  handlePacket(packet: DecoderPacket): void {
    if (packet.type === 'configuration') {
      const { profileIndex, constraintSet, levelIndex } = h264ParseConfiguration(packet.data)
      // RFC 6381 ISO Base Media 命名（与 Tango WebCodecs 适配器一致）
      const codec =
        'avc1.' +
        hexTwoDigits(profileIndex) +
        hexTwoDigits(constraintSet) +
        hexTwoDigits(levelIndex)
      this.#config = {
        raw: packet.data,
        config: {
          codec,
          hardwareAcceleration: 'no-preference',
          optimizeForLatency: true
        }
      }
      this.#ptsBase = null
      this.#configured = false
      return
    }
    if (!this.#config) return // 没有配置前不喂（等配置包）

    const timestamp = this.#ptsBase === null ? 0 : Math.max(0, (packet.pts ?? 0) - this.#ptsBase)
    if (this.#ptsBase === null) this.#ptsBase = packet.pts ?? 0

    if (packet.keyframe) {
      if (this.#decoder.decodeQueueSize > 0) {
        // 解码太慢：下一个关键帧处丢弃积压，限制最大延迟到 1 个关键帧间隔
        this.reset()
      }
      if (!this.#configured) {
        this.#configureAndDecodeFirstKeyframe(packet)
        return
      }
    }
    if (!this.#configured) return // 等关键帧开始新的依赖链
    this.#decoder.decode(
      new EncodedVideoChunk({
        type: packet.keyframe === false ? 'delta' : 'key',
        timestamp,
        data: packet.data
      })
    )
  }

  #configureAndDecodeFirstKeyframe(packet: DecoderPacket): void {
    const { raw, config } = this.#config!
    this.#decoder.configure(config)
    this.#configured = true
    // Annex B：配置数据与首关键帧合并后解码
    const merged = new Uint8Array(raw.length + packet.data.length)
    merged.set(raw, 0)
    merged.set(packet.data, raw.length)
    this.#decoder.decode(new EncodedVideoChunk({ type: 'key', timestamp: 0, data: merged }))
  }
}
