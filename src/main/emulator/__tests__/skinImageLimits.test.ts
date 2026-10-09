// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { inspectSkinImage, SkinImageBudget, SKIN_SET_MAX_PIXELS } from '../skinImageLimits'
import { pngImage, pngChunk } from './skinImageFixture'
const jpeg = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iiigD//2Q==',
  'base64'
)
const webp = Buffer.from('UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAUAmJaQAA3AA/vz0AAA=', 'base64')
const riff = (...chunks: Buffer[]): Buffer => {
  const body = Buffer.concat([Buffer.from('WEBP'), ...chunks])
  const prefix = Buffer.alloc(8)
  prefix.write('RIFF')
  prefix.writeUInt32LE(body.length, 4)
  return Buffer.concat([prefix, body])
}
const chunk = (tag: string, payload: Buffer): Buffer => {
  const header = Buffer.alloc(8)
  header.write(tag)
  header.writeUInt32LE(payload.length, 4)
  return Buffer.concat([header, payload, Buffer.alloc(payload.length % 2)])
}

describe('skin image headers before decoding', () => {
  it.each([
    [pngImage(), 'image/png'],
    [jpeg, 'image/jpeg'],
    [webp, 'image/webp']
  ] as const)('accepts genuine supported static image %#', (bytes, mime) => {
    expect(inspectSkinImage(bytes)).toEqual({ mime, width: 1, height: 1, pixels: 1 })
  })
  it('accepts inclusive side/image limits and rejects above each limit', () => {
    expect(inspectSkinImage(pngImage(8192, 2048)).pixels).toBe(16_777_216)
    expect(() => inspectSkinImage(pngImage(8193, 1))).toThrow('8193×1')
    expect(() => inspectSkinImage(pngImage(4097, 4096))).toThrow('4097×4096')
    expect(() => inspectSkinImage(pngImage(0, 1))).toThrow('损坏')
    expect(() => inspectSkinImage(pngImage(0xffffffff, 0xffffffff))).toThrow('损坏')
  })
  it('checks JPEG SOF and WebP bitstream sizes, not filename or container alone', () => {
    const largeJpeg = Buffer.from(jpeg)
    const sof = largeJpeg.indexOf(Buffer.from([0xff, 0xc0]))
    largeJpeg.writeUInt16BE(8193, sof + 7)
    expect(() => inspectSkinImage(largeJpeg)).toThrow('8193×1')
    const largeWebp = Buffer.from(webp)
    largeWebp.writeUInt16LE(8193, 26)
    expect(() => inspectSkinImage(largeWebp)).toThrow('8193×1')
    const lossless = Buffer.alloc(6)
    lossless[0] = 0x2f
    expect(inspectSkinImage(riff(chunk('VP8L', lossless))).pixels).toBe(1)
    const extended = Buffer.alloc(10)
    expect(inspectSkinImage(riff(chunk('VP8X', extended), webp.subarray(12))).pixels).toBe(1)
    extended[4] = 1
    expect(() => inspectSkinImage(riff(chunk('VP8X', extended), webp.subarray(12)))).toThrow('损坏')
  })
  it('rejects truncated headers, illegal lengths, CRC corruption and zero-size variants', () => {
    for (const image of [pngImage(), jpeg, webp]) {
      expect(() => inspectSkinImage(image.subarray(0, 12))).toThrow('损坏')
      expect(() => inspectSkinImage(image.subarray(0, -1))).toThrow('损坏')
    }
    const png = pngImage()
    png[16] ^= 1
    expect(() => inspectSkinImage(png)).toThrow('损坏')
    const invalid = Buffer.from(webp)
    invalid.writeUInt32LE(0xffffffff, 16)
    expect(() => inspectSkinImage(invalid)).toThrow('损坏')
    const zero = Buffer.from(webp)
    zero.writeUInt16LE(0, 26)
    expect(() => inspectSkinImage(zero)).toThrow('损坏')
  })
  it('rejects animation, including flags or chunks after the image header', () => {
    const png = pngImage()
    const animatedPng = Buffer.concat([
      png.subarray(0, 33),
      pngChunk('acTL', Buffer.alloc(8)),
      png.subarray(33)
    ])
    expect(() => inspectSkinImage(animatedPng)).toThrow('动画')
    const extended = Buffer.alloc(10)
    extended[0] = 2
    expect(() => inspectSkinImage(riff(chunk('VP8X', extended), webp.subarray(12)))).toThrow('动画')
    expect(() =>
      inspectSkinImage(riff(webp.subarray(12), chunk('ANMF', Buffer.alloc(16))))
    ).toThrow('动画')
  })
  it('counts unique files once; inclusive aggregate boundary and next pixel rejected', () => {
    const budget = new SkinImageBudget()
    for (let i = 0; i < 4; i++) {
      budget.add(`image${i}.png`, pngImage(4096, 4096))
      budget.add(`image${i}.png`, pngImage(4096, 4096))
    }
    expect(SKIN_SET_MAX_PIXELS).toBe(4 * 4096 * 4096)
    expect(() => budget.add('next.png', pngImage())).toThrow(/next.png.*整套.*67108865/)
  })
})
