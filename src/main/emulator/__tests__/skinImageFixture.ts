import { deflateSync } from 'node:zlib'

const crc32 = (bytes: Buffer): number => {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}
export const pngChunk = (type: string, payload: Buffer): Buffer => {
  const chunk = Buffer.alloc(payload.length + 12)
  chunk.writeUInt32BE(payload.length)
  chunk.write(type, 4)
  payload.copy(chunk, 8)
  chunk.writeUInt32BE(crc32(chunk.subarray(4, -4)), chunk.length - 4)
  return chunk
}
/** Genuine transparent 1×1 PNG; dimension overrides exercise the pre-decoding header boundary. */
export const pngImage = (width = 1, height = 1): Buffer => {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 6
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(Buffer.alloc(5))),
    pngChunk('IEND', Buffer.alloc(0))
  ])
}
