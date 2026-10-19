import { describe, expect, it } from 'vitest'
import { AacClock, inSegment, mapTime, parseAacConfig, segmentDuration } from '../timeline'

describe('recording media timeline', () => {
  it('retains the shared device clock anchor and eliminates accumulated AAC packet PTS drift', () => {
    const format = parseAacConfig(Uint8Array.of(0x11, 0x90))
    expect(format).toMatchObject({ sampleRate: 48000, channels: 2, samples: 1024 })
    const clock = new AacClock(format)
    const anchor = 42_000_000n
    expect(clock.next(anchor)).toBe(anchor)
    let time = anchor
    for (let i = 1; i <= 29000; i++) time = clock.next(anchor + BigInt(i) * 21345n)
    expect(time).toBe(anchor + (29000n * 1024n * 1_000_000n) / 48000n)
  })
  it('derives 44.1k mono and 960 samples, rejects truncated or unsupported configurations', () => {
    expect(parseAacConfig(Uint8Array.of(0x12, 0x0c))).toMatchObject({
      sampleRate: 44100,
      channels: 1,
      samples: 960
    })
    expect(() => parseAacConfig(Uint8Array.of(0x11))).toThrow()
    expect(() => parseAacConfig(Uint8Array.of(0x2b, 0x90))).toThrow()
  })
  it('does not silently close a gap in interrupted audio', () => {
    const clock = new AacClock(parseAacConfig(Uint8Array.of(0x11, 0x90)))
    clock.next(1_000_000n)
    expect(() => clock.next(2_100_000n)).toThrow('discontinuity')
  })
  it('uses the same offset for both tracks across removed pauses', () => {
    const segments = [
      { index: 0, start: '1000000', end: '4000000', offset: '0', width: 1080, height: 2400 },
      { index: 1, start: '9000000', end: '11000000', offset: '3000000', width: 2400, height: 1080 }
    ]
    expect(segmentDuration(segments)).toBe(5_000_000n)
    expect(mapTime(segments[1], 9_021_333n)).toBe(3_021_333n)
    expect(inSegment(segments[1], 10_990_000n, 21_333n)).toBe(false)
    expect(inSegment(segments[1], 9_021_333n, 21_333n)).toBe(true)
  })
})
