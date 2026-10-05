// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  downloadSkin,
  importSkinArchive,
  parseSkinLayout,
  scanImportedSkins,
  scanSdkSkins,
  importedSkinsRoot
} from '../skins'

/** 真实 fixture（SDK skins/pixel_7/layout，批次 1 提取） */
const PIXEL_7_LAYOUT = readFileSync(join(__dirname, 'fixtures', 'skins', 'pixel_7-layout'), 'utf8')

describe('parseSkinLayout（真实 pixel_7 layout）', () => {
  it('portrait：整框 1200×2541、屏幕 1080×2400 at (0,0)、无 landscape', () => {
    const layout = parseSkinLayout(PIXEL_7_LAYOUT)
    expect(layout).not.toBeNull()
    expect(layout?.portrait).toMatchObject({
      frameWidth: 1200,
      frameHeight: 2541,
      screenX: 0,
      screenY: 0,
      screenWidth: 1080,
      screenHeight: 2400
    })
    expect(layout?.landscape).toBeNull()
    // 素材引用：background back.webp + mask mask.webp
    expect(layout?.imageAssets.sort()).toEqual(['back.webp', 'mask.webp'].sort())
  })

  it('带 landscape 与 rotation 的皮肤解析出双向（构造样本）', () => {
    const text = `parts {
  device {
    display {
      width 1080
      height 2400
      x 0
      y 0
    }
  }
  portrait {
    background {
      image p.png
    }
  }
}
layouts {
  portrait {
    width 1100
    height 2420
    part1 {
      name portrait
      x 10
      y 10
    }
  }
  landscape {
    width 2420
    height 1100
    part1 {
      name portrait
      x 0
      y 0
      rotation 90
    }
  }
}`
    const layout = parseSkinLayout(text)
    expect(layout?.portrait).toMatchObject({
      frameWidth: 1100,
      frameHeight: 2420,
      screenX: 10,
      screenY: 10
    })
    expect(layout?.landscape?.rotation).toBe(90)
    expect(layout?.landscape?.frameWidth).toBe(2420)
  })

  it('坏 layout（缺 parts/display）返回 null 不冒充成功', () => {
    expect(parseSkinLayout('')).toBeNull()
    expect(parseSkinLayout('layouts { portrait { width 1 height 1 } }')).toBeNull()
    expect(
      parseSkinLayout('parts { device { display { width 0 height 0 } } } layouts {}')
    ).toBeNull()
  })
})

describe('scanSdkSkins（注入接缝）', () => {
  const LAYOUT_OK = PIXEL_7_LAYOUT
  const deps = {
    readdir: async (dir: string): Promise<string[]> => {
      if (dir.endsWith('/skins')) return ['pixel_7', 'broken_skin', 'not-a-dir.txt']
      return []
    },
    readFile: async (path: string): Promise<string> => {
      if (path.endsWith('broken_skin/layout')) return 'garbage {'
      return LAYOUT_OK
    },
    stat: async (path: string) => ({
      isDirectory: () => !path.endsWith('.txt')
    })
  }

  it('合法皮肤入库（sdk:<name>）；坏目录跳过不拖垮', async () => {
    const skins = await scanSdkSkins('/sdk', deps)
    expect(skins).toHaveLength(1)
    expect(skins[0]).toMatchObject({ id: 'pixel_7', skinRef: 'sdk:pixel_7', source: 'sdk' })
  })

  it('SDK skins 目录不存在返回空', async () => {
    const result = await scanSdkSkins('/missing', {
      readdir: async (): Promise<string[]> => Promise.reject(new Error('no'))
    })
    expect(result).toEqual([])
  })
})

describe('importSkinArchive（zip 导入核验）', () => {
  const makeDeps = (
    layoutText: string,
    files: string[]
  ): { deps: Record<string, unknown>; written: Array<{ target: string }> } => {
    const written: Array<{ target: string }> = []
    return {
      deps: {
        mkdir: async () => {},
        rm: async () => {},
        cp: async (_src: string, target: string) => {
          written.push({ target })
        },
        readFile: async (path: string) => (path.endsWith('layout') ? layoutText : ''),
        readdir: async (dir: string) => (dir.includes('staging') ? ['layout', ...files] : files),
        stat: async () => ({ isDirectory: () => true }),
        extractZip: () => {}
      },
      written
    }
  }

  it('合法压缩包：解包核验后入库 imported:<uuid>', async () => {
    const { deps } = makeDeps(PIXEL_7_LAYOUT, ['back.webp', 'mask.webp'])
    const record = await importSkinArchive('/archive.zip', '/userdata', deps)
    expect(record.skinRef).toMatch(/^imported:/)
    expect(record.source).toBe('imported')
    expect(record.directory.startsWith(importedSkinsRoot('/userdata'))).toBe(true)
  })

  it('素材缺失拒绝导入并给中文原因', async () => {
    const { deps } = makeDeps(PIXEL_7_LAYOUT, ['back.webp'])
    await expect(importSkinArchive('/archive.zip', '/userdata', deps)).rejects.toThrow('素材缺失')
  })

  it('素材引用越界（../ 逃逸）拒绝导入', async () => {
    const evil = PIXEL_7_LAYOUT.replace('image back.webp', 'image ../../etc/passwd.png')
    const { deps } = makeDeps(evil, ['back.webp'])
    await expect(importSkinArchive('/archive.zip', '/userdata', deps)).rejects.toThrow('越界')
  })

  it('layout 不完整拒绝（不用通用外框冒充成功导入）', async () => {
    const { deps } = makeDeps('garbage {', [])
    await expect(importSkinArchive('/archive.zip', '/userdata', deps)).rejects.toThrow('layout')
  })
})

describe('downloadSkin（受控源 + PROVENANCE）', () => {
  it('无已核实源时拒绝并说明（不把暂无可下载当完成）', async () => {
    await expect(downloadSkin('pixel_7', '/userdata', () => {}, {})).rejects.toThrow(
      '暂无已核实的官方皮肤下载源'
    )
  })

  it('有源时下载核验入库，写来源/版本/许可记录，进度到 100', async () => {
    // 注入受控源样本（验证链路；产品源清单为空——见 skins.ts 核实记录）
    const { SKIN_DOWNLOAD_SOURCES } = await import('../skins')
    SKIN_DOWNLOAD_SOURCES.push({
      id: 'test-source',
      label: '测试源',
      license: 'Apache-2.0',
      ref: 'test-ref',
      archiveUrl: (name: string) => `https://example.test/skins/${name}.tar.gz`
    })
    const progress: number[] = []
    const writes: string[] = []
    const record = await downloadSkin('pixel_7', '/userdata', (p) => progress.push(p), {
      fetcher: async () => new ArrayBuffer(8),
      extractTarGz: () => {},
      readFile: async (path: string) => (path.endsWith('layout') ? PIXEL_7_LAYOUT : ''),
      readdir: async () => ['layout', 'back.webp', 'mask.webp'],
      stat: async () => ({ isDirectory: () => true }),
      mkdir: async () => {},
      rm: async () => {},
      cp: async () => {},
      writeFile: async (path: string, data: string) => {
        writes.push(`${path}:${data}`)
      }
    })
    expect(record.skinRef).toMatch(/^downloaded:/)
    expect(record.name).toBe('pixel_7')
    expect(progress.at(-1)).toBe(100)
    const provenance = writes.find((entry) => entry.includes('PROVENANCE'))
    expect(provenance).toContain('Apache-2.0')
    expect(provenance).toContain(SKIN_DOWNLOAD_SOURCES[0].id)
  })

  it('下载内容 layout 坏 → 来源核验失败拒绝', async () => {
    await expect(
      downloadSkin('bad', '/userdata', () => {}, {
        fetcher: async () => new ArrayBuffer(8),
        extractTarGz: () => {},
        readFile: async () => 'garbage {',
        readdir: async () => ['layout'],
        stat: async () => ({ isDirectory: () => true }),
        mkdir: async () => {},
        rm: async () => {},
        cp: async () => {}
      })
    ).rejects.toThrow('核验失败')
  })
})

describe('scanImportedSkins（应用皮肤库）', () => {
  it('库目录扫描：合法条目入库 imported:<id>', async () => {
    const skins = await scanImportedSkins('/userdata', {
      readdir: async () => ['abc123'],
      readFile: async (path: string) => (path.endsWith('layout') ? PIXEL_7_LAYOUT : ''),
      stat: async () => ({ isDirectory: () => true })
    })
    expect(skins).toHaveLength(1)
    expect(skins[0]?.id).toBe('abc123')
  })
})
