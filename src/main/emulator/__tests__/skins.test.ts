// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  importSkinArchive,
  parseSkinLayout,
  scanImportedSkins,
  scanSdkSkins,
  importedSkinsRoot
} from '../skins'

/** 真实 fixture（SDK skins/pixel_7/layout，批次 1 提取） */
const PIXEL_7_LAYOUT = readFileSync(join(__dirname, 'fixtures', 'skins', 'pixel_7-layout'), 'utf8')

/** 可解析但零可渲染素材（无 background/foreground 引用）——review P3 口径样本 */
const LAYOUT_NO_ART = `parts {
  device {
    display {
      width 1080
      height 2400
    }
  }
}
layouts {
  portrait {
    width 1200
    height 2541
    part2 {
      name device
      x 59
      y 58
    }
  }
}`

describe('parseSkinLayout（真实 pixel_7 layout）', () => {
  it('portrait：整框 1200×2541、屏幕 1080×2400 at (59,58)、无 landscape', () => {
    const layout = parseSkinLayout(PIXEL_7_LAYOUT)
    expect(layout).not.toBeNull()
    expect(layout?.portrait).toMatchObject({
      frameWidth: 1200,
      frameHeight: 2541,
      screenX: 59,
      screenY: 58,
      screenWidth: 1080,
      screenHeight: 2400,
      foregroundMask: 'mask.webp'
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
    part2 {
      name device
      x 10
      y 10
    }
  }
  landscape {
    width 2420
    height 1100
    part1 {
      name portrait
      x 2410
      y 10
      rotation 1
    }
    part2 {
      name device
      x 2410
      y 10
      rotation 1
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
    expect(layout?.landscape?.rotation).toBe(1)
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

  it('零可渲染素材（无 background/foreground 引用）不入库——可解析也不冒充可渲染', async () => {
    const skins = await scanSdkSkins('/sdk', {
      readdir: async () => ['no_art'],
      readFile: async () => LAYOUT_NO_ART,
      stat: async () => ({ isDirectory: () => true })
    })
    expect(skins).toEqual([])
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

  it('layout 可解析但零可渲染素材：导入拒绝（不把不可渲染皮肤放进可选清单）', async () => {
    const { deps } = makeDeps(LAYOUT_NO_ART, [])
    await expect(importSkinArchive('/archive.zip', '/userdata', deps)).rejects.toThrow(
      '没有可渲染的背景图片'
    )
  })

  it('资源限额：体积超限（> 256 MB）中文拒绝（plan 设计 6 / review P3）', async () => {
    await expect(
      importSkinArchive('/archive.zip', '/userdata', {
        mkdir: async () => {},
        rm: async () => {},
        cp: async () => {},
        readFile: async (path: string) => (path.endsWith('layout') ? PIXEL_7_LAYOUT : ''),
        readdir: async (dir: string) =>
          dir.includes('staging')
            ? ['layout', 'back.webp', 'mask.webp', 'huge.bin']
            : ['back.webp', 'mask.webp', 'huge.bin'],
        stat: async (path: string) =>
          path.endsWith('layout')
            ? { isDirectory: () => true }
            : { isDirectory: () => false, size: 300 * 1024 * 1024 },
        extractZip: () => {}
      })
    ).rejects.toThrow('体积超限')
  })

  it('资源限额：文件数超限（> 200）中文拒绝', async () => {
    const many = [
      'back.webp',
      'mask.webp',
      ...Array.from({ length: 200 }, (_unused, index) => `f${index}.webp`)
    ]
    await expect(
      importSkinArchive('/archive.zip', '/userdata', {
        mkdir: async () => {},
        rm: async () => {},
        cp: async () => {},
        readFile: async (path: string) => (path.endsWith('layout') ? PIXEL_7_LAYOUT : ''),
        readdir: async (dir: string) => (dir.includes('staging') ? ['layout', ...many] : many),
        stat: async (path: string) =>
          path.endsWith('layout')
            ? { isDirectory: () => true }
            : { isDirectory: () => false, size: 1024 },
        extractZip: () => {}
      })
    ).rejects.toThrow('资源数超限')
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

  it('PROVENANCE 溯源：带来源记录的条目恢复 downloaded:<id> 身份与皮肤名（P2-4）', async () => {
    const skins = await scanImportedSkins('/userdata', {
      readdir: async () => ['d1'],
      readFile: async (path: string) =>
        path.endsWith('layout')
          ? PIXEL_7_LAYOUT
          : 'source: test-source\nname: pixel_7\nlicense: Apache-2.0\n',
      stat: async () => ({ isDirectory: () => true })
    })
    expect(skins[0]?.skinRef).toBe('downloaded:d1')
    expect(skins[0]?.source).toBe('downloaded')
    expect(skins[0]?.name).toBe('pixel_7')
  })

  it('PROVENANCE 损坏（无 source 行）按 imported 处理，不误判身份', async () => {
    const skins = await scanImportedSkins('/userdata', {
      readdir: async () => ['d2'],
      readFile: async (path: string) => (path.endsWith('layout') ? PIXEL_7_LAYOUT : ''),
      stat: async () => ({ isDirectory: () => true })
    })
    expect(skins[0]?.skinRef).toBe('imported:d2')
  })

  it('零可渲染素材条目跳过（与投屏可渲染口径一致，不进可选清单）', async () => {
    const skins = await scanImportedSkins('/userdata', {
      readdir: async () => ['d3'],
      readFile: async (path: string) => (path.endsWith('layout') ? LAYOUT_NO_ART : ''),
      stat: async () => ({ isDirectory: () => true })
    })
    expect(skins).toEqual([])
  })
})

describe('官方横屏首布局', () => {
  it('Pixel Tablet 只有 landscape 仍可解析', () => {
    const text = readFileSync(join(__dirname, 'fixtures/skins/pixel_tablet-layout'), 'utf8')
    const layout = parseSkinLayout(text)
    expect(layout?.portrait).toBeNull()
    expect(layout?.landscape).toMatchObject({
      screenX: 119,
      screenY: 117,
      screenWidth: 2560,
      screenHeight: 1600,
      frameWidth: 2798,
      frameHeight: 1837
    })
  })
})

describe('真实 Nexus 5 四分之一圈', () => {
  it('rotation 3 的屏幕原点绕 part 锚点旋转，仍位于整框内', () => {
    const text = readFileSync(join(__dirname, 'fixtures/skins/nexus_5-layout'), 'utf8')
    expect(parseSkinLayout(text)?.landscape).toMatchObject({
      frameWidth: 2497,
      frameHeight: 1235,
      screenX: 261,
      screenY: 65,
      screenWidth: 1920,
      screenHeight: 1080,
      rotation: 3
    })
  })
})
