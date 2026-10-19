/* eslint-disable @typescript-eslint/explicit-function-return-type -- 原生 JS 探针不含 TypeScript 返回类型语法 */
import { open } from 'node:fs/promises'

// 与 capture.mjs 的固定 32 字节记录头一致；只读取完整记录，不接受截断尾部。
export async function* packets(path) {
  const file = await open(path, 'r')
  let offset = 0
  try {
    for (;;) {
      const header = Buffer.alloc(32)
      if ((await file.read(header, 0, 32, offset)).bytesRead !== 32) return
      const length = header.readUInt32BE(16)
      if (length > 16 * 1024 * 1024) throw new Error('invalid packet length')
      const data = Buffer.alloc(length)
      if ((await file.read(data, 0, length, offset + 32)).bytesRead !== length) return
      yield {
        configuration: header[0] === 0,
        keyframe: header[1] === 1,
        pts: header.readBigInt64BE(8),
        receivedUs: header.readBigInt64BE(24),
        data
      }
      offset += 32 + length
    }
  } finally {
    await file.close()
  }
}
