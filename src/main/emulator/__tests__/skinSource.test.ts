// @vitest-environment node
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir, symlink } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { downloadSkin, gitBlobId, officialSkinName, skinImageMime } from '../skinSource'
import { readSkinPresentation } from '../skinPresentation'
import { pngImage } from './skinImageFixture'
import { XMLParser } from 'fast-xml-parser'
import catalog from '../skinSources.json'
import { parseSkinLayout } from '../skins'

const network = vi.hoisted(() => ({ fetch: vi.fn() }))
vi.mock('electron', () => ({ net: { fetch: network.fetch } }))

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
  vi.restoreAllMocks()
  network.fetch.mockReset()
})

describe('默认官方网络路径', () => {
  const mockRemote = (): void => {
    network.fetch.mockImplementation(async (url: string) => new Response(await fetchText(url)))
  }

  it('默认路径用 Electron 网络栈，Node 直连不可用仍能获取并复用缓存', async () => {
    const root = await temporary()
    const direct = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'))
    mockRemote()
    const record = await downloadSkin('pixel_7', root, () => {})
    expect(record.name).toBe('pixel_7')
    expect(network.fetch).toHaveBeenCalledWith(
      expect.stringContaining('format=JSON'),
      expect.objectContaining({ signal: expect.any(AbortSignal), credentials: 'omit' })
    )
    expect(direct).not.toHaveBeenCalled()
    const count = network.fetch.mock.calls.length
    expect((await downloadSkin('pixel_7', root, () => {})).skinRef).toBe(record.skinRef)
    expect(network.fetch).toHaveBeenCalledTimes(count)
  })

  it.each([
    [new Error('net::ERR_PROXY_CONNECTION_FAILED'), '系统代理'],
    [new DOMException('Timed out', 'TimeoutError'), '30 秒']
  ])('连接失败 %s 有可操作提示；失败后允许重试', async (error, expected) => {
    const root = await temporary()
    network.fetch.mockRejectedValueOnce(error)
    await expect(downloadSkin('pixel_7', root, () => {})).rejects.toThrow(expected)
    await expect(readdir(join(root, 'device-skins'))).rejects.toMatchObject({ code: 'ENOENT' })
    mockRemote()
    expect((await downloadSkin('pixel_7', root, () => {})).name).toBe('pixel_7')
  })

  it.each([
    [() => new Response('denied', { status: 403 }), 'HTTP 403'],
    [() => new Response(null), '空内容'],
    [() => new Response('x'.repeat(Math.floor(16 * 1024 * 1024 * 1.4) + 1)), '体积超限'],
    [
      () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.error(new Error('connection reset'))
            }
          })
        ),
      '下载中断'
    ]
  ])('保留 HTTP/空响应/预算错误并识别中途断开：%s', async (response, expected) => {
    const root = await temporary()
    network.fetch.mockResolvedValueOnce(response())
    await expect(downloadSkin('pixel_7', root, () => {})).rejects.toThrow(expected)
  })
})

describe('固定官方来源获取', () => {
  it.each(catalog.aliases)('$profileId 的皮肤尺寸与登记画像一致（允许横竖交换）', (alias) => {
    const layout = parseSkinLayout(
      readFileSync(join(__dirname, `fixtures/skins/aliases/${alias.name}-layout`), 'utf8')
    )!
    expect(layout).not.toBeNull()
    const expected = [alias.screenWidth, alias.screenHeight].sort((a, b) => a - b)
    for (const orientation of [layout.portrait, layout.landscape].filter(
      (value) => value !== null
    )) {
      expect([orientation.screenWidth, orientation.screenHeight].sort((a, b) => a - b)).toEqual(
        expected
      )
    }
    expect([layout.portrait, layout.landscape].some((value) => value !== null)).toBe(true)
  })

  it('别名与目录名合并下载、缓存复用，且 URL 只使用白名单目录', async () => {
    const root = await temporary()
    const aliasLayout = readFileSync(join(__dirname, 'fixtures/skins/aliases/nexus_5-layout'))
    const parsed = parseSkinLayout(aliasLayout.toString('utf8'))!
    const aliasResources = new Map([
      ['layout', aliasLayout],
      ...parsed.imageAssets.map((file) => [file, png] as const)
    ])
    const aliasFetch = vi.fn(async (url: string) => {
      expect(url).toContain('/nexus_5/')
      if (url.endsWith('format=JSON'))
        return JSON.stringify({
          entries: [...aliasResources].map(([name, bytes]) => ({
            name,
            type: 'blob',
            id: gitBlobId(bytes)
          }))
        })
      return aliasResources.get(url.split('/').at(-1)!.split('?')[0])!.toString('base64')
    })
    const deps = { fetchText: aliasFetch, studioRoot: '/missing' }
    const [byAlias, byName] = await Promise.all([
      downloadSkin('Nexus 5', root, () => {}, deps),
      downloadSkin('nexus_5', root, () => {}, deps)
    ])
    expect(byAlias.skinRef).toBe(byName.skinRef)
    const calls = aliasFetch.mock.calls.length
    expect((await downloadSkin('Nexus 5', root, () => {}, deps)).skinRef).toBe(byName.skinRef)
    expect(aliasFetch).toHaveBeenCalledTimes(calls)
    expect(await readdir(join(root, 'device-skins'))).toHaveLength(1)
  })

  it('别名皮肤尺寸不符时在入库前拒绝', async () => {
    const root = await temporary()
    await expect(
      downloadSkin('Nexus 5', root, () => {}, { fetchText, studioRoot: '/missing' })
    ).rejects.toThrow('尺寸')
    await expect(readdir(join(root, 'device-skins'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('按官方 XML 的明确皮肤绑定支持旧 Nexus 和汽车别名', () => {
    const parser = new XMLParser({ removeNSPrefix: true, parseTagValue: false })
    let checked = 0
    for (const file of ['nexus', 'automotive']) {
      const xml = parser.parse(
        readFileSync(join(__dirname, `fixtures/devices-xml/${file}.xml`), 'utf8')
      )
      for (const device of xml.devices.device) {
        const id = device.id ?? device.name
        if (
          id.startsWith('Nexus ') ||
          id === 'Galaxy Nexus' ||
          ['automotive_1080p_landscape', 'automotive_ultrawide'].includes(id)
        ) {
          expect(officialSkinName(id)).toBe(device.hardware.skin)
          checked += 1
        }
      }
    }
    expect(checked).toBe(14)
    expect(officialSkinName('Nexus')).toBeNull()
    expect(officialSkinName('nexus 5')).toBeNull()
    expect(officialSkinName('pixel_fold')).toBeNull()
  })
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
