// @vitest-environment node
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readSkinPresentation } from '../skinPresentation'
import { pngImage } from './skinImageFixture'
import AdmZip from 'adm-zip'
import { importSkinArchive } from '../skins'
import { downloadSkin, gitBlobId } from '../skinSource'
import { readFile, readdir } from 'node:fs/promises'
const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
const prepare = async (count: number): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'msd-skin-pixel-'))
  roots.push(root)
  const dir = join(root, 'device-skins', 'test')
  await mkdir(dir, { recursive: true })
  const images = Array.from({ length: count }, (_, i) => `image${i}.png`)
  const definitions = images
    .map((file, i) => `art${i} {\n background {\n image ${file}\n }\n}`)
    .join('\n')
  const references = images.map((_, i) => `part${i + 2} {\n name art${i}\n}`).join('\n')
  const orientation = `width 2\nheight 2\npart1 {\n name device\n}\n${references}`
  await writeFile(
    join(dir, 'layout'),
    `parts {\ndevice {\n display {\n width 1\n height 1\n}\n}\n${definitions}\n}\nlayouts {\nportrait {\n${orientation}\n}\nlandscape {\n${orientation}\n}\n}`
  )
  for (const file of images) await writeFile(join(dir, file), pngImage(4096, 4096))
  return root
}
describe('presentation unique pixel budget', () => {
  it('deduplicates both orientation references and returns the inclusive set limit', async () => {
    const root = await prepare(4)
    const result = await readSkinPresentation('imported:test', '/missing', root)
    expect(result?.images).toHaveLength(4)
    expect(result?.portrait?.backgrounds).toHaveLength(4)
    expect(result?.landscape?.backgrounds).toHaveLength(4)
  })
  it('refuses an entire set whose individual assets pass; no partial presentation', async () => {
    const root = await prepare(5)
    await expect(readSkinPresentation('imported:test', '/missing', root)).rejects.toThrow(
      /image4.png.*整套皮肤像素超限/
    )
  })
})

describe('acquisition set budgets', () => {
  it('import rejects aggregate overflow before admission and cleans staging', async () => {
    const root = await prepare(5)
    const dir = join(root, 'device-skins', 'test')
    const zip = new AdmZip()
    zip.addFile('layout', await readFile(join(dir, 'layout')))
    for (let i = 0; i < 5; i++) zip.addFile(`image${i}.png`, pngImage(4096, 4096))
    const archive = join(root, 'skin.zip')
    zip.writeZip(archive)
    const target = join(root, 'import-test')
    await expect(importSkinArchive(archive, target)).rejects.toThrow(/image4.png.*整套皮肤像素超限/)
    expect(await readdir(join(target, 'device-skins-staging'))).toEqual([])
    await expect(readdir(join(target, 'device-skins'))).rejects.toThrow()
  })
  it('official download rejects aggregate overflow after provenance verification', async () => {
    const root = await prepare(5)
    const assets = new Map<string, Buffer>([
      ['layout', await readFile(join(root, 'device-skins', 'test', 'layout'))]
    ])
    for (let i = 0; i < 5; i++) assets.set(`image${i}.png`, pngImage(4096, 4096))
    const target = join(root, 'download-test')
    await expect(
      downloadSkin('pixel_7', target, () => {}, {
        studioRoot: '/missing',
        fetchText: async (url) =>
          url.endsWith('format=JSON')
            ? JSON.stringify({
                entries: [...assets].map(([name, bytes]) => ({
                  name,
                  type: 'blob',
                  id: gitBlobId(bytes)
                }))
              })
            : assets.get(url.split('/').at(-1)!.split('?')[0])!.toString('base64')
      })
    ).rejects.toThrow(/image4.png.*整套皮肤像素超限/)
    expect(await readdir(join(target, 'device-skins-staging'))).toEqual([])
    await expect(readdir(join(target, 'device-skins'))).rejects.toThrow()
  })
})
