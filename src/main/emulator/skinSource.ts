import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import catalog from './skinSources.json'
import {
  importedSkinsRoot,
  parseSkinLayout,
  renderableArtFiles,
  scanImportedSkins,
  type SkinRecord
} from './skins'

export const SKIN_SOURCE_URL = `https://android.googlesource.com/platform/tools/adt/idea/+/${catalog.ref}/artwork/resources/device-art-resources`
export const officialSkinName = (profileId: string): string | null =>
  catalog.names.includes(profileId) ? profileId : null

const FILE_LIMIT = 16 * 1024 * 1024
const TOTAL_LIMIT = 64 * 1024 * 1024
export const gitBlobId = (bytes: Buffer): string =>
  createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')

/** 不以扩展名信任图片；完整解码由 renderer 完成，失败显示诊断。 */
export const skinImageMime = (bytes: Buffer): string => {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    return 'image/png'
  if (bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) return 'image/jpeg'
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP')
    return 'image/webp'
  throw new Error('皮肤图片格式不受支持或文件损坏')
}

const boundedFetch = async (url: string): Promise<string> => {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) })
  if (!response.ok) throw new Error(`官方皮肤源响应 HTTP ${response.status}，请稍后重试`)
  if (!response.body) throw new Error('官方皮肤源返回空内容')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const result = await reader.read()
      if (result.done) break
      size += result.value.length
      if (size > FILE_LIMIT * 1.4) throw new Error('官方皮肤文件体积超限')
      chunks.push(result.value)
    }
  } finally {
    await reader.cancel().catch(() => undefined)
  }
  return Buffer.concat(chunks).toString('utf8')
}

export interface OfficialSkinDeps {
  fetchText?: (url: string) => Promise<string>
  /** 本机 Studio 资源只在逐文件 hash 与固定上游版本一致时复用。 */
  studioRoot?: string
}

const inFlight = new Map<string, Promise<SkinRecord>>()

export const downloadSkin = (
  name: string,
  userData: string,
  onProgress: (percent: number) => void,
  deps: OfficialSkinDeps = {}
): Promise<SkinRecord> => {
  if (officialSkinName(name) === null)
    return Promise.reject(new Error('该机型暂无已核实的官方皮肤'))
  const key = `${userData}|${name}`
  const pending = inFlight.get(key)
  if (pending) return pending
  const job = acquireSkin(name, userData, onProgress, deps).finally(() => inFlight.delete(key))
  inFlight.set(key, job)
  return job
}

const acquireSkin = async (
  name: string,
  userData: string,
  progress: (percent: number) => void,
  deps: OfficialSkinDeps
): Promise<SkinRecord> => {
  for (const record of await scanImportedSkins(userData)) {
    if (record.name !== name || record.source !== 'downloaded') continue
    const provenance = await readFile(join(record.directory, 'PROVENANCE.txt'), 'utf8')
    if (!provenance.includes(`ref: ${catalog.ref}\n`)) continue
    try {
      const blobs = JSON.parse(
        await readFile(join(record.directory, 'BLOBS.json'), 'utf8')
      ) as Record<string, string>
      const needed = ['layout', ...record.layout.imageAssets]
      if (
        needed.every((file) => /^[\w.-]+$/.test(file)) &&
        (await Promise.all(
          needed.map(
            async (file) => gitBlobId(await readFile(join(record.directory, file))) === blobs[file]
          )
        ).then((valid) => valid.every(Boolean)))
      ) {
        progress(100)
        return record
      }
    } catch {
      /* 损坏缓存保留，重新获取到新目录，不覆盖旧设备引用。 */
    }
  }
  const fetchText = deps.fetchText ?? boundedFetch
  const url = `${SKIN_SOURCE_URL}/${name}`
  progress(5)
  const text = await fetchText(`${url}/?format=JSON`)
  const listing = JSON.parse(text.replace(/^\)\]\}'\s*/, '')) as {
    entries?: Array<{ type: string; name: string; id: string }>
  }
  if (!Array.isArray(listing.entries) || listing.entries.length > 200)
    throw new Error('官方皮肤清单核验失败')
  const entries = new Map(
    listing.entries.filter((entry) => entry.type === 'blob').map((entry) => [entry.name, entry.id])
  )
  let total = 0
  const load = async (file: string): Promise<Buffer> => {
    const expected = entries.get(file)
    if (!/^[\w.-]+$/.test(file) || !expected || !/^[a-f0-9]{40}$/.test(expected))
      throw new Error(`官方素材引用核验失败：${file}`)
    let bytes: Buffer | null = null
    const studioRoot =
      deps.studioRoot ??
      '/Applications/Android Studio.app/Contents/plugins/android/resources/device-art-resources'
    try {
      const localPath = join(studioRoot, name, file)
      if ((await stat(localPath)).size > FILE_LIMIT) throw new Error('本机资源过大')
      const local = await readFile(localPath)
      if (gitBlobId(local) === expected) bytes = local
    } catch {
      /* Studio 未安装或版本不同，转固定版本上游。 */
    }
    if (bytes === null) {
      const encoded = await fetchText(`${url}/${file}?format=TEXT`)
      if (encoded.length > FILE_LIMIT * 1.4) throw new Error('官方皮肤文件体积超限')
      bytes = Buffer.from(encoded, 'base64')
    }
    total += bytes.length
    if (bytes.length > FILE_LIMIT || total > TOTAL_LIMIT) throw new Error('官方皮肤文件体积超限')
    if (gitBlobId(bytes) !== expected) throw new Error(`官方皮肤完整性核验失败：${file}`)
    return bytes
  }
  const layoutBytes = await load('layout')
  const layout = parseSkinLayout(layoutBytes.toString('utf8'))
  // 与导入/扫描/投屏同口径：零可渲染素材的官方目录直接判核验失败
  if (!layout || renderableArtFiles(layout).length === 0)
    throw new Error('官方皮肤 layout 核验失败')
  const id = randomUUID()
  const staging = join(userData, 'device-skins-staging', id)
  const target = join(importedSkinsRoot(userData), id)
  await mkdir(staging, { recursive: true })
  try {
    await writeFile(join(staging, 'layout'), layoutBytes)
    const blobs: Record<string, string> = { layout: entries.get('layout')! }
    for (const [index, file] of layout.imageAssets.entries()) {
      const bytes = await load(file)
      skinImageMime(bytes)
      await writeFile(join(staging, file), bytes)
      blobs[file] = entries.get(file)!
      progress(10 + Math.floor((80 * (index + 1)) / layout.imageAssets.length))
    }
    await writeFile(join(staging, 'BLOBS.json'), JSON.stringify(blobs))
    await writeFile(
      join(staging, 'PROVENANCE.txt'),
      `source: android-studio-device-art\nname: ${name}\nurl: ${url}\nref: ${catalog.ref}\nlicense: upstream terms; see source repository\nimportedAt: ${new Date().toISOString()}\n`
    )
    await mkdir(importedSkinsRoot(userData), { recursive: true })
    await rename(staging, target)
    progress(100)
    return {
      id,
      name,
      skinRef: `downloaded:${id}`,
      directory: target,
      layout,
      source: 'downloaded'
    }
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}
