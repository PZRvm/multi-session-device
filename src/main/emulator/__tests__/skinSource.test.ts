// @vitest-environment node
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir, symlink } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { downloadSkin, gitBlobId, officialSkinName, skinImageMime } from '../skinSource'
import { readSkinPresentation } from '../skinPresentation'
import { pngImage } from './skinImageFixture'

const layout = readFileSync(join(__dirname, 'fixtures/skins/pixel_7-layout'))
const png = pngImage()
const resources = new Map([
  ['layout', layout],
  ['back.webp', png],
  ['mask.webp', png]
])
const fetchText = vi.fn(async (url: string) => {
  if (url.endsWith('format=JSON'))
    return (
      ")]}'\n" +
      JSON.stringify({
        entries: [...resources].map(([name, bytes]) => ({
          name,
          type: 'blob',
          id: gitBlobId(bytes)
        }))
      })
    )
  const file = url.split('/').at(-1)!.split('?')[0]
  return resources.get(file)!.toString('base64')
})
const roots: string[] = []
const temporary = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'msd-skin-test-'))
  roots.push(root)
  fetchText.mockClear()
  return root
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('固定官方来源获取', () => {
  it('精确匹配，不接受模糊画像或路径', async () => {
    expect(officialSkinName('pixel_7')).toBe('pixel_7')
    expect(officialSkinName('Pixel 7')).toBeNull()
    await expect(
      downloadSkin('../pixel_7', await temporary(), () => {}, { fetchText })
    ).rejects.toThrow('官方皮肤')
    expect(fetchText).not.toHaveBeenCalled()
  })
  it('并发合并、原子入库、重启后复用且不重新请求', async () => {
    const root = await temporary()
    const deps = { fetchText, studioRoot: '/missing-studio' }
    const records = await Promise.all([
      downloadSkin('pixel_7', root, () => {}, deps),
      downloadSkin('pixel_7', root, () => {}, deps)
    ])
    expect(records[0].skinRef).toBe(records[1].skinRef)
    expect(await readdir(join(root, 'device-skins'))).toHaveLength(1)
    const calls = fetchText.mock.calls.length
    expect((await downloadSkin('pixel_7', root, () => {}, deps)).skinRef).toBe(records[0].skinRef)
    expect(fetchText).toHaveBeenCalledTimes(calls)
    expect(await readFile(join(records[0].directory, 'PROVENANCE.txt'), 'utf8')).toContain(
      'android-studio-device-art'
    )
  })
  it('hash 不匹配时拒绝，清理暂存，重试可以成功', async () => {
    const root = await temporary()
    await expect(
      downloadSkin('pixel_7', root, () => {}, {
        studioRoot: '/missing',
        fetchText: async (url) =>
          url.includes('back.webp') ? Buffer.from('bad').toString('base64') : fetchText(url)
      })
    ).rejects.toThrow('完整性')
    expect(await readdir(join(root, 'device-skins-staging'))).toEqual([])
    expect(
      (await downloadSkin('pixel_7', root, () => {}, { fetchText, studioRoot: '/missing' })).source
    ).toBe('downloaded')
  })
  it('同版本 Studio 逐文件复用，只有一次目录元数据请求', async () => {
    const root = await temporary()
    const studioRoot = join(root, 'studio')
    await mkdir(join(studioRoot, 'pixel_7'), { recursive: true })
    for (const [file, bytes] of resources) await writeFile(join(studioRoot, 'pixel_7', file), bytes)
    await downloadSkin('pixel_7', root, () => {}, { fetchText, studioRoot })
    expect(fetchText).toHaveBeenCalledTimes(1)
  })
  it('资源接口按保存引用返回 data URL，拒绝符号链接逃逸与未知引用', async () => {
    const root = await temporary()
    const record = await downloadSkin('pixel_7', root, () => {}, {
      fetchText,
      studioRoot: '/missing'
    })
    const presentation = await readSkinPresentation(record.skinRef, '/missing-sdk', root)
    expect(presentation?.portrait?.screenX).toBe(59)
    expect(presentation?.images.map((image) => image.file).sort()).toEqual([
      'back.webp',
      'mask.webp'
    ])
    expect(presentation?.images[0].url).toMatch(/^data:image\/png;base64,/)
    await expect(readSkinPresentation('imported:missing', '/missing', root)).rejects.toThrow('丢失')
    const external = join(root, 'outside.png')
    await writeFile(external, png)
    await rm(join(record.directory, 'back.webp'))
    await symlink(external, join(record.directory, 'back.webp'))
    await expect(readSkinPresentation(record.skinRef, '/missing', root)).rejects.toThrow('越界')
    expect(() => skinImageMime(Buffer.from('<svg/>'))).toThrow('格式')
  })
})

describe('解码前像素预算', () => {
  it('官方获取在入库前拒绝小文件大尺寸，清理 staging', async () => {
    const root = await temporary()
    const huge = pngImage(8193, 1)
    const forgedFetch = async (url: string): Promise<string> => {
      if (url.endsWith('format=JSON'))
        return JSON.stringify({
          entries: [...resources].map(([name, bytes]) => ({
            name,
            type: 'blob',
            id: gitBlobId(name === 'back.webp' ? huge : bytes)
          }))
        })
      return url.includes('back.webp') ? huge.toString('base64') : fetchText(url)
    }
    await expect(
      downloadSkin('pixel_7', root, () => {}, { fetchText: forgedFetch, studioRoot: '/missing' })
    ).rejects.toThrow(/back.webp.*8193/)
    expect(await readdir(join(root, 'device-skins-staging'))).toEqual([])
    await expect(readdir(join(root, 'device-skins'))).rejects.toThrow()
  })
  it('既有皮肤被外部替换为大尺寸时拒绝 presentation', async () => {
    const root = await temporary()
    const record = await downloadSkin('pixel_7', root, () => {}, {
      fetchText,
      studioRoot: '/missing'
    })
    await writeFile(join(record.directory, 'back.webp'), pngImage(4097, 4096))
    await expect(readSkinPresentation(record.skinRef, '/missing', root)).rejects.toThrow(
      /back.webp.*4097.*4096/
    )
  })
})
