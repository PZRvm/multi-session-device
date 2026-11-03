/** Header inspection only: never decode untrusted pixels in the main process. */
export const SKIN_IMAGE_MAX_SIDE = 8192
export const SKIN_IMAGE_MAX_PIXELS = 16_777_216
export const SKIN_SET_MAX_PIXELS = 67_108_864
export const SKIN_IMAGE_MAX_BYTES = 16 * 1024 * 1024
export const SKIN_SET_MAX_BYTES = 64 * 1024 * 1024

export interface SkinImageInfo {
  mime: string
  width: number
  height: number
  pixels: number
}
function malformed(): never {
  throw new Error('皮肤图片格式不受支持或文件损坏（头部或长度非法）')
}
function animated(): never {
  throw new Error('皮肤暂不支持动画图片，请使用静态 PNG/JPEG/WebP')
}
const crcTable = Array.from({ length: 256 }, (_, value) => {
  let crc = value
  for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  return crc >>> 0
})
const crc32 = (bytes: Buffer): number => {
  let crc = 0xffffffff
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff]
  return (crc ^ 0xffffffff) >>> 0
}
const pngSize = (bytes: Buffer): [number, number] => {
  let offset = 8
  let size: [number, number] | undefined
  let data = false
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset)
    const end = offset + 12 + length
    if (end > bytes.length) malformed()
    const tag = bytes.toString('ascii', offset + 4, offset + 8)
    if (crc32(bytes.subarray(offset + 4, end - 4)) !== bytes.readUInt32BE(end - 4)) malformed()
    if (!size && tag !== 'IHDR') malformed()
    if (['acTL', 'fcTL', 'fdAT'].includes(tag)) animated()
    if (tag === 'IHDR') {
      if (size || length !== 13) malformed()
      const depth = bytes[offset + 16]
      const color = bytes[offset + 17]
      const depths: Record<number, number[]> = {
        0: [1, 2, 4, 8, 16],
        2: [8, 16],
        3: [1, 2, 4, 8],
        4: [8, 16],
        6: [8, 16]
      }
      if (
        !depths[color]?.includes(depth) ||
        bytes[offset + 18] !== 0 ||
        bytes[offset + 19] !== 0 ||
        bytes[offset + 20] > 1
      )
        malformed()
      size = [bytes.readUInt32BE(offset + 8), bytes.readUInt32BE(offset + 12)]
    }
    if (tag === 'IDAT' && length > 0) data = true
    if (tag === 'IEND') {
      if (length !== 0 || end !== bytes.length || !data || !size) malformed()
      return size
    }
    offset = end
  }
  return malformed()
}
const jpegSize = (bytes: Buffer): [number, number] => {
  let offset = 2
  let size: [number, number] | undefined
  let scan = false
  while (offset < bytes.length) {
    if (bytes[offset++] !== 0xff) malformed()
    while (bytes[offset] === 0xff) offset++
    const marker = bytes[offset++]
    if (marker === 0xd9) {
      if (!size || !scan || offset !== bytes.length) malformed()
      return size
    }
    if (marker === 0xd8 || marker === 0 || marker === undefined || offset + 2 > bytes.length)
      malformed()
    const length = bytes.readUInt16BE(offset)
    const end = offset + length
    if (length < 2 || end > bytes.length) malformed()
    const sof = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)
    if (sof) {
      // Browser-supported baseline, extended sequential and progressive Huffman JPEG.
      if (
        ![0xc0, 0xc1, 0xc2].includes(marker) ||
        size ||
        length < 8 ||
        bytes[offset + 2] !== 8 ||
        bytes[offset + 7] < 1 ||
        bytes[offset + 7] > 4 ||
        length !== 8 + 3 * bytes[offset + 7]
      )
        malformed()
      size = [bytes.readUInt16BE(offset + 5), bytes.readUInt16BE(offset + 3)]
    }
    offset = end
    if (marker === 0xda) {
      if (
        !size ||
        length < 6 ||
        bytes[offset - length + 2] < 1 ||
        bytes[offset - length + 2] > 4 ||
        length !== 6 + 2 * bytes[offset - length + 2]
      )
        malformed()
      scan = true
      // Skip compressed entropy without decoding; stuffed FF and restart markers are data.
      while (offset < bytes.length) {
        if (bytes[offset] !== 0xff) {
          offset++
          continue
        }
        let next = offset + 1
        while (bytes[next] === 0xff) next++
        if (bytes[next] === 0 || (bytes[next] >= 0xd0 && bytes[next] <= 0xd7)) {
          offset = next + 1
          continue
        }
        break
      }
    }
  }
  return malformed()
}
const webpSize = (bytes: Buffer): [number, number] => {
  if (bytes.length < 20 || bytes.readUInt32LE(4) + 8 !== bytes.length) malformed()
  let offset = 12
  let canvas: [number, number] | undefined
  let frame: [number, number] | undefined
  while (offset + 8 <= bytes.length) {
    const tag = bytes.toString('ascii', offset, offset + 4)
    const length = bytes.readUInt32LE(offset + 4)
    const start = offset + 8
    const end = start + length
    const padded = end + (length % 2)
    if (padded > bytes.length || (length % 2 && bytes[end] !== 0)) malformed()
    if (tag === 'ANIM' || tag === 'ANMF') animated()
    if (tag === 'VP8X') {
      if (canvas || frame || offset !== 12 || length !== 10) malformed()
      if (bytes[start] & 2) animated()
      if (bytes[start] & 0xc1 || bytes.readUIntBE(start + 1, 3) !== 0) malformed()
      canvas = [bytes.readUIntLE(start + 4, 3) + 1, bytes.readUIntLE(start + 7, 3) + 1]
    } else if (tag === 'VP8L') {
      if (frame || length <= 5 || bytes[start] !== 0x2f) malformed()
      const bits = bytes.readUInt32LE(start + 1)
      if (bits >>> 29) malformed()
      frame = [(bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1]
    } else if (tag === 'VP8 ') {
      if (
        frame ||
        length <= 10 ||
        bytes[start] & 1 ||
        !bytes.subarray(start + 3, start + 6).equals(Buffer.from([0x9d, 1, 0x2a]))
      )
        malformed()
      frame = [bytes.readUInt16LE(start + 6) & 0x3fff, bytes.readUInt16LE(start + 8) & 0x3fff]
    }
    offset = padded
  }
  if (
    offset !== bytes.length ||
    !frame ||
    (canvas && (canvas[0] !== frame[0] || canvas[1] !== frame[1]))
  )
    malformed()
  return canvas ?? frame
}

export const inspectSkinImage = (bytes: Buffer): SkinImageInfo => {
  if (bytes.length > SKIN_IMAGE_MAX_BYTES) throw new Error('皮肤素材体积超限（单图最多 16 MiB）')
  let mime: string
  let size: [number, number]
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    mime = 'image/png'
    size = pngSize(bytes)
  } else if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    mime = 'image/jpeg'
    size = jpegSize(bytes)
  } else if (
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP'
  ) {
    mime = 'image/webp'
    size = webpSize(bytes)
  } else return malformed()
  const [width, height] = size
  const pixels = width * height
  if (!Number.isSafeInteger(pixels) || width <= 0 || height <= 0) malformed()
  if (width > SKIN_IMAGE_MAX_SIDE || height > SKIN_IMAGE_MAX_SIDE || pixels > SKIN_IMAGE_MAX_PIXELS)
    throw new Error(
      `皮肤图片 ${width}×${height} 像素超限（单边最多 ${SKIN_IMAGE_MAX_SIDE}，单图最多 ${SKIN_IMAGE_MAX_PIXELS} 像素）`
    )
  return { mime, width, height, pixels }
}

/** Count a referenced file once even when both orientations use it. */
export class SkinImageBudget {
  private readonly seen = new Map<string, SkinImageInfo>()
  private pixels = 0
  private bytes = 0
  add(file: string, bytes: Buffer): SkinImageInfo {
    const previous = this.seen.get(file)
    if (previous) return previous
    try {
      const info = inspectSkinImage(bytes)
      const total = this.pixels + info.pixels
      if (!Number.isSafeInteger(total) || total > SKIN_SET_MAX_PIXELS)
        throw new Error(`整套皮肤像素超限（${total} > ${SKIN_SET_MAX_PIXELS}）`)
      if (this.bytes + bytes.length > SKIN_SET_MAX_BYTES)
        throw new Error('整套皮肤体积超限（最多 64 MiB）')
      this.pixels = total
      this.bytes += bytes.length
      this.seen.set(file, info)
      return info
    } catch (error) {
      throw new Error(`素材 ${file}：${error instanceof Error ? error.message : String(error)}`)
    }
  }
}
