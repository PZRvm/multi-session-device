import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { net } from 'electron'
import catalog from './skinSources.json'
import { inspectSkinImage, SkinImageBudget } from './skinImageLimits'
import {
  importedSkinsRoot,
  parseSkinLayout,
  renderableArtFiles,
  scanImportedSkins,
  type SkinRecord
} from './skins'
import { msg } from '../locale'

export const SKIN_SOURCE_URL = `https://android.googlesource.com/platform/tools/adt/idea/+/${catalog.ref}/artwork/resources/device-art-resources`
export const officialSkinName = (profileId: string): string | null =>
  catalog.names.includes(profileId)
    ? profileId
    : (catalog.aliases.find((entry) => entry.profileId === profileId)?.name ?? null)

/** 别名只开放经过画像与 layout 尺寸核验的目录；横竖屏交换不改变像素尺寸。 */
const verifyAliasLayout = (name: string, layout: SkinRecord['layout']): void => {
  const alias = catalog.aliases.find((entry) => entry.name === name)
  if (!alias) return
  const matches = [layout.portrait, layout.landscape].some(
    (orientation) =>
      orientation !== null &&
      ((orientation.screenWidth === alias.screenWidth &&
        orientation.screenHeight === alias.screenHeight) ||
        (orientation.screenWidth === alias.screenHeight &&
          orientation.screenHeight === alias.screenWidth))
  )
  if (!matches) throw new Error(msg('officialScreenMismatch', { name }))
}

const FILE_LIMIT = 16 * 1024 * 1024
const TOTAL_LIMIT = 64 * 1024 * 1024
export const gitBlobId = (bytes: Buffer): string =>
  createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')

/** Header metadata and limits are verified before renderer decoding. */
export const skinImageMime = (bytes: Buffer): string => inspectSkinImage(bytes).mime

const boundedFetch = async (url: string): Promise<string> => {
  const signal = AbortSignal.timeout(30_000)
  let response: Response
  try {
    // Chromium 使用系统代理；Node fetch 的直连在代理网络下可能不可用。
    response = await net.fetch(url, { signal, credentials: 'omit' })
  } catch (cause) {
    const timedOut = signal.aborted || (cause instanceof Error && cause.name === 'TimeoutError')
    throw new Error(
      timedOut
        ? msg('officialRequestTimeout')
        : msg('officialSourceUnreachable', {
            cause: cause instanceof Error ? cause.message : String(cause)
          }),
      { cause }
    )
  }
  if (!response.ok) throw new Error(msg('officialHttpError', { status: response.status }))
  if (!response.body) throw new Error(msg('officialEmptyBody'))
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const result = await reader.read().catch((cause: unknown) => {
        throw new Error(msg('officialDownloadInterrupted'), { cause })
      })
      if (result.done) break
      size += result.value.length
      if (size > FILE_LIMIT * 1.4) throw new Error(msg('officialFileTooLarge'))
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
  const canonicalName = officialSkinName(name)
  if (canonicalName === null) return Promise.reject(new Error(msg('noOfficialSkinVerified')))
  const key = `${userData}|${canonicalName}`
  const pending = inFlight.get(key)
  if (pending) return pending
  const job = acquireSkin(canonicalName, userData, onProgress, deps).finally(() =>
    inFlight.delete(key)
  )
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
      verifyAliasLayout(name, record.layout)
      const blobs = JSON.parse(
        await readFile(join(record.directory, 'BLOBS.json'), 'utf8')
      ) as Record<string, string>
      const needed = ['layout', ...record.layout.imageAssets]
      const budget = new SkinImageBudget()
      let valid = needed.every((file) => /^[\w.-]+$/.test(file))
      for (const file of needed) {
        if (!valid || (await stat(join(record.directory, file))).size > FILE_LIMIT) {
          valid = false
          break
        }
        const bytes = await readFile(join(record.directory, file))
        if (gitBlobId(bytes) !== blobs[file]) {
          valid = false
          break
        }
        if (file !== 'layout') budget.add(file, bytes)
      }
      if (valid) {
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
    throw new Error(msg('officialManifestInvalid'))
  const entries = new Map(
    listing.entries.filter((entry) => entry.type === 'blob').map((entry) => [entry.name, entry.id])
  )
  let total = 0
  const load = async (file: string): Promise<Buffer> => {
    const expected = entries.get(file)
    if (!/^[\w.-]+$/.test(file) || !expected || !/^[a-f0-9]{40}$/.test(expected))
      throw new Error(msg('officialAssetRefFailed', { file }))
    let bytes: Buffer | null = null
    const studioRoot =
      deps.studioRoot ??
      '/Applications/Android Studio.app/Contents/plugins/android/resources/device-art-resources'
    try {
      const localPath = join(studioRoot, name, file)
      if ((await stat(localPath)).size > FILE_LIMIT) throw new Error(msg('localResourceTooLarge'))
      const local = await readFile(localPath)
      if (gitBlobId(local) === expected) bytes = local
    } catch {
      /* Studio 未安装或版本不同，转固定版本上游。 */
    }
    if (bytes === null) {
      const encoded = await fetchText(`${url}/${file}?format=TEXT`)
      if (encoded.length > FILE_LIMIT * 1.4) throw new Error(msg('officialFileTooLarge'))
      bytes = Buffer.from(encoded, 'base64')
    }
    total += bytes.length
    if (bytes.length > FILE_LIMIT || total > TOTAL_LIMIT)
      throw new Error(msg('officialFileTooLarge'))
    if (gitBlobId(bytes) !== expected) throw new Error(msg('officialIntegrityFailed', { file }))
    return bytes
  }
  const layoutBytes = await load('layout')
  const layout = parseSkinLayout(layoutBytes.toString('utf8'))
  // 与导入/扫描/投屏同口径：零可渲染素材的官方目录直接判核验失败
  if (!layout || renderableArtFiles(layout).length === 0)
    throw new Error(msg('officialLayoutInvalid'))
  verifyAliasLayout(name, layout)
  const id = randomUUID()
  const staging = join(userData, 'device-skins-staging', id)
  const target = join(importedSkinsRoot(userData), id)
  await mkdir(staging, { recursive: true })
  try {
    await writeFile(join(staging, 'layout'), layoutBytes)
    const blobs: Record<string, string> = { layout: entries.get('layout')! }
    const budget = new SkinImageBudget()
    for (const [index, file] of layout.imageAssets.entries()) {
      const bytes = await load(file)
      budget.add(file, bytes)
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
