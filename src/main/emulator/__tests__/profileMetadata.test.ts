// @vitest-environment node
import { deflateRawSync } from 'node:zlib'
import { describe, expect, it, vi } from 'vitest'
import {
  classifyFrameKind,
  loadFrameKindIndex,
  parseDeviceFrameXml,
  readZipEntry,
  sdklibJarCandidates,
  TABLET_MIN_DIAGONAL
} from '../profileMetadata'

/** 最小 ZIP 组装（EOCD + 中央目录 + 本地头；crc 不校验置 0） */
const buildZip = (entries: Array<{ name: string; data: Buffer; deflate?: boolean }>): Buffer => {
  const parts: Buffer[] = []
  const centralParts: Buffer[] = []
  let offset = 0
  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8')
    const payload = entry.deflate ? deflateRawSync(entry.data) : entry.data
    const method = entry.deflate ? 8 : 0
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 6)
    local.writeUInt16LE(method, 8)
    local.writeUInt32LE(0, 14)
    local.writeUInt32LE(payload.length, 18)
    local.writeUInt32LE(entry.data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(method, 10)
    central.writeUInt32LE(payload.length, 20)
    central.writeUInt32LE(entry.data.length, 24)
    central.writeUInt16LE(nameBuf.length, 28)
    central.writeUInt32LE(offset, 42)
    parts.push(local, nameBuf, payload)
    centralParts.push(central, nameBuf)
    offset += 30 + nameBuf.length + payload.length
  }
  const centralDir = Buffer.concat(centralParts)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(centralDir.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...parts, centralDir, eocd])
}

const DEVICES_XML = `<?xml version="1.0"?>
<d:devices xmlns:d="http://schemas.android.com/sdk/devices/9">
  <d:device>
    <d:name>Pixel 8</d:name>
    <d:id>pixel_8</d:id>
    <d:hardware><d:screen><d:diagonal-length>6.17</d:diagonal-length></d:screen></d:hardware>
  </d:device>
  <d:device>
    <d:name>Pixel Tablet</d:name>
    <d:id>pixel_tablet</d:id>
    <d:hardware><d:screen><d:diagonal-length>10.95</d:diagonal-length></d:screen></d:hardware>
  </d:device>
  <d:device>
    <d:name>Pixel Fold</d:name>
    <d:id>pixel_fold</d:id>
    <d:hardware>
      <d:screen>
        <d:diagonal-length>7.58</d:diagonal-length>
        <d:foldable-region><d:x-folded-dimension>1080</d:x-folded-dimension></d:foldable-region>
      </d:screen>
      <d:change-orientation-on-fold>1</d:change-orientation-on-fold>
    </d:hardware>
    <d:skin>pixel_fold</d:skin>
  </d:device>
  <d:device>
    <d:name>Nexus One</d:name>
    <d:hardware><d:screen><d:diagonal-length>3.7</d:diagonal-length></d:screen></d:hardware>
  </d:device>
  <d:device>
    <d:name>Mystery</d:name>
    <d:id>mystery</d:id>
    <d:hardware><d:screen/></d:hardware>
  </d:device>
  <device>
    <name>NoPrefix Phone</name>
    <id>no_prefix</id>
    <hardware><screen><diagonal-length>6.0</diagonal-length></screen></hardware>
  </device>
</d:devices>
`

const NEXUS_XML = `<?xml version="1.0"?>
<d:devices xmlns:d="http://schemas.android.com/sdk/devices/9">
  <d:device>
    <d:name>7" WSVGA (Tablet)</d:name>
    <d:id>7in WSVGA (Tablet)</d:id>
    <d:hardware><d:screen><d:diagonal-length>7.0</d:diagonal-length></d:screen></d:hardware>
  </d:device>
</d:devices>
`

describe('readZipEntry', () => {
  it('stored 与 deflate 条目都能读出', () => {
    const archive = buildZip([
      { name: 'a.txt', data: Buffer.from('hello') },
      { name: 'dir/b.xml', data: Buffer.from('<x/>'), deflate: true }
    ])
    expect(readZipEntry(archive, 'a.txt')?.toString()).toBe('hello')
    expect(readZipEntry(archive, 'dir/b.xml')?.toString()).toBe('<x/>')
  })

  it('条目不存在 / 非 ZIP / 截断档案返回 null', () => {
    const archive = buildZip([{ name: 'a.txt', data: Buffer.from('hello') }])
    expect(readZipEntry(archive, 'missing.txt')).toBeNull()
    expect(readZipEntry(Buffer.from('not a zip at all'), 'a.txt')).toBeNull()
    expect(readZipEntry(archive.subarray(0, 10), 'a.txt')).toBeNull()
  })
})

describe('parseDeviceFrameXml 与判型', () => {
  const hints = parseDeviceFrameXml(DEVICES_XML)

  it('解析 id/name/对角线；无 id 条目以 name 作 key（与 avdmanager 一致）', () => {
    const byKey = new Map(hints.map((hint) => [hint.key, hint]))
    expect(byKey.get('pixel_8')?.diagonalInches).toBeCloseTo(6.17)
    expect(byKey.get('Nexus One')?.diagonalInches).toBeCloseTo(3.7)
    expect(byKey.has('no_prefix')).toBe(true)
  })

  it('折叠标记认元素名：skin 内容含 fold 不误判', () => {
    const fold = hints.find((hint) => hint.key === 'pixel_fold')
    expect(fold?.foldable).toBe(true)
  })

  it('判型：手机/平板/折叠归手机/对角线缺失为 null', () => {
    const byKey = new Map(hints.map((hint) => [hint.key, hint]))
    expect(classifyFrameKind(byKey.get('pixel_8')!)).toBe('phone')
    expect(classifyFrameKind(byKey.get('pixel_tablet')!)).toBe('tablet')
    expect(classifyFrameKind(byKey.get('pixel_fold')!)).toBe('phone')
    expect(classifyFrameKind(byKey.get('Nexus One')!)).toBe('phone')
    expect(classifyFrameKind(byKey.get('mystery')!)).toBeNull()
    expect(TABLET_MIN_DIAGONAL).toBe(7)
  })
})

describe('loadFrameKindIndex', () => {
  const jarPath = sdklibJarCandidates('/sdk')[0]
  const archive = buildZip([
    {
      name: 'com/android/sdklib/devices/devices.xml',
      data: Buffer.from(DEVICES_XML),
      deflate: true
    },
    { name: 'com/android/sdklib/devices/nexus.xml', data: Buffer.from(NEXUS_XML) }
  ])

  it('从 JAR 提取 XML 并按 id 判型；未知 id 与缺失对角线条目兜底', async () => {
    const readFile = vi.fn(async () => archive)
    const statFile = vi.fn(async () => ({ mtimeMs: 1_000, size: archive.length }))
    const index = await loadFrameKindIndex('/sdk', { statFile, readFile })
    expect(readFile).toHaveBeenCalledWith(jarPath)
    expect(index.lookup('pixel_8')).toBe('phone')
    expect(index.lookup('pixel_tablet')).toBe('tablet')
    expect(index.lookup('pixel_fold')).toBe('phone') // 折叠 7.58" 不判平板
    expect(index.lookup('Nexus One')).toBe('phone') // 无 id 条目按 name 命中
    expect(index.lookup('7in WSVGA (Tablet)')).toBe('tablet')
    expect(index.lookup('mystery')).toBe('generic') // 对角线缺失不入表
    expect(index.lookup('unknown_id')).toBe('generic')
  })

  it('SDK 缺失（stat 全空）→ 空索引，不抛', async () => {
    const statFile = vi.fn(async () => null)
    const index = await loadFrameKindIndex('/missing-sdk', { statFile })
    expect(index.entries).toBe(0)
    expect(index.lookup('pixel_8')).toBe('generic')
  })

  it('读文件抛错不阻塞：收敛为空索引', async () => {
    const statFile = vi.fn(async () => ({ mtimeMs: 2_000, size: 10 }))
    const readFile = vi.fn(async () => {
      throw new Error('disk error')
    })
    const index = await loadFrameKindIndex('/sdk', { statFile, readFile })
    expect(index.entries).toBe(0)
  })

  it('缓存按 JAR stat 失效：mtime 不变不重读，变化后重建', async () => {
    const readFile = vi.fn(async () => archive)
    let mtime = 3_000
    // 只让首选 JAR 存在：每次载入恰读一次，便于计数
    const statFile = vi.fn(async (path: string) =>
      path === jarPath ? { mtimeMs: mtime, size: archive.length } : null
    )
    await loadFrameKindIndex('/sdk', { statFile, readFile })
    await loadFrameKindIndex('/sdk', { statFile, readFile })
    expect(readFile).toHaveBeenCalledTimes(1)
    mtime = 3_001
    await loadFrameKindIndex('/sdk', { statFile, readFile })
    expect(readFile).toHaveBeenCalledTimes(2)
  })
})
