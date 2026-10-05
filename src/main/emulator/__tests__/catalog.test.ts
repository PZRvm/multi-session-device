// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  classifyTags,
  compareApiVersions,
  fetchImageCatalog,
  MANIFEST_SOURCES,
  mergeCatalog,
  parseApiVersion,
  parseSysImgManifest,
  scanLocalImages,
  splitPackageName,
  type LocalImageRecord
} from '../catalog'

/** 真实 manifest（批次 1/3 提取自 dl.google.com，2026-10） */
const fixtureDir = join(__dirname, 'fixtures')
const readManifest = (name: string): string =>
  readFileSync(join(fixtureDir, 'manifests', `${name}.xml`), 'utf8')

const playstoreEntries = parseSysImgManifest(readManifest('google_apis_playstore'))
const wearEntries = parseSysImgManifest(readManifest('android-wear'))
const automotiveEntries = parseSysImgManifest(readManifest('android-automotive'))

describe('parseSysImgManifest（真实 manifest，结构化解析）', () => {
  it('六源清单都能解析出条目', () => {
    for (const source of MANIFEST_SOURCES) {
      const entries = parseSysImgManifest(readManifest(source))
      expect(entries.length).toBeGreaterThan(0)
    }
  })

  it('android-36.1 小版本：major/minor/extension 分开存，不转浮点', () => {
    const entry = playstoreEntries.find(
      (pkg) => pkg.packageName === 'system-images;android-36.1;google_apis_playstore;arm64-v8a'
    )
    expect(entry).toBeDefined()
    expect(entry?.apiLevelText).toBe('36.1')
    expect(entry?.extensionLevel).toBe(20)
    expect(entry?.tagIds).toEqual(['google_apis_playstore'])
  })

  it('同 API 的 ps16k 变体是独立包：服务相同、特征标签不同、包名不合并', () => {
    const plain = playstoreEntries.find(
      (pkg) => pkg.packageName === 'system-images;android-36;google_apis_playstore;arm64-v8a'
    )
    const ps16k = playstoreEntries.find(
      (pkg) => pkg.packageName === 'system-images;android-36;google_apis_playstore_ps16k;arm64-v8a'
    )
    expect(plain).toBeDefined()
    expect(ps16k).toBeDefined()
    expect(ps16k?.tagIds).toContain('page_size_16kb')
    expect(ps16k?.tagIds).toContain('google_apis_playstore')
    expect(classifyTags(ps16k?.tagIds ?? []).services).toEqual(['google_play'])
    expect(classifyTags(ps16k?.tagIds ?? []).featureTags).toEqual(['page_size_16kb'])
  })

  it('canary 条目带 codename（Preview 信号）', () => {
    const canary = playstoreEntries.find((pkg) => /canary/.test(pkg.packageName))
    if (canary !== undefined) {
      expect(canary.codename).not.toBeNull()
    }
  })

  it('wear 源：目录段带 -signed 后缀，服务标签是 android-wear', () => {
    const wear = wearEntries.find((pkg) =>
      pkg.packageName.includes('android-wear-signed;arm64-v8a')
    )
    expect(wear).toBeDefined()
    expect(wear?.tagIds).toContain('android-wear')
    expect(classifyTags(wear?.tagIds ?? []).services).toEqual(['wear'])
  })

  it('automotive 源：扩展平台 35x + 双服务标签', () => {
    const auto = automotiveEntries.find((pkg) =>
      pkg.packageName.startsWith('system-images;android-35-ext15;android-automotive;arm64-v8a')
    )
    expect(auto).toBeDefined()
    expect(auto?.apiLevelText).toBe('35x')
    const { services } = classifyTags(auto?.tagIds ?? [])
    expect(services).toContain('automotive')
    expect(services).toContain('google_apis')
  })

  it('x86_64 / x86 ABI 条目保留（进入不支持视图，不丢弃）', () => {
    expect(playstoreEntries.some((pkg) => pkg.abi === 'x86_64')).toBe(true)
    expect(parseSysImgManifest(readManifest('android-tv')).some((pkg) => pkg.abi === 'x86')).toBe(
      true
    )
  })
})

describe('parseApiVersion / splitPackageName / compareApiVersions', () => {
  it('整数、小版本、扩展平台（35x）、未知', () => {
    expect(parseApiVersion('36')).toEqual({ major: 36, minor: null })
    expect(parseApiVersion('36.1')).toEqual({ major: 36, minor: 1 })
    expect(parseApiVersion('35x')).toEqual({ major: 35, minor: null })
    expect(parseApiVersion(null)).toEqual({ major: null, minor: null })
  })

  it('包名四段拆解；非法包名 null', () => {
    expect(splitPackageName('system-images;android-36.1;google_apis_playstore;arm64-v8a')).toEqual({
      platformSegment: 'android-36.1',
      tagSegment: 'google_apis_playstore',
      abi: 'arm64-v8a'
    })
    expect(splitPackageName('platform-tools')).toBeNull()
    expect(splitPackageName('system-images;android-36')).toBeNull()
  })

  it('API 结构化降序：36.1 > 36 > 35x(ext15) > 34', () => {
    const at = (
      platformSegment: string,
      major: number | null,
      minor: number | null,
      ext: number | null = null
    ) => ({
      platformSegment,
      major,
      minor,
      codename: null,
      extensionLevel: ext,
      baseExtension: null
    })
    const versions = [
      at('android-34', 34, null),
      at('android-35-ext15', 35, null, 15),
      at('android-36', 36, null),
      at('android-36.1', 36, 1)
    ]
    const sorted = [...versions].sort(compareApiVersions)
    expect(sorted.map((v) => v.platformSegment)).toEqual([
      'android-36.1',
      'android-36',
      'android-35-ext15',
      'android-34'
    ])
  })
})

describe('scanLocalImages（注入接缝）与 mergeCatalog', () => {
  const PACKAGE_XML = readFileSync(
    join(fixtureDir, 'system-images', 'android-36.1-playstore-package.xml'),
    'utf8'
  )

  const localDeps = {
    readdir: async (dir: string): Promise<string[]> => {
      if (dir.endsWith('system-images')) return ['android-36.1']
      if (dir.endsWith('android-36.1')) return ['google_apis_playstore']
      return ['arm64-v8a']
    },
    readFile: async (path: string): Promise<string> => {
      if (path.endsWith('package.xml')) return PACKAGE_XML
      throw new Error('not found')
    },
    exists: async (path: string): Promise<boolean> => !path.endsWith('source.properties')
  }

  it('缺 source.properties / system.img 的半安装不算 installed', async () => {
    const local = await scanLocalImages('/sdk', localDeps)
    expect(local.size).toBe(1)
    const record = local.get('system-images;android-36.1;google_apis_playstore;arm64-v8a')
    expect(record?.verified).toBe(false)
  })

  it('完整安装（三件套齐）核验通过', async () => {
    const local = await scanLocalImages('/sdk', {
      ...localDeps,
      exists: async () => true
    })
    expect(local.get('system-images;android-36.1;google_apis_playstore;arm64-v8a')?.verified).toBe(
      true
    )
  })

  it('合并：远端条目取本地核验标记；本地独有条目补进目录（local-only）', () => {
    const remoteEntry = (pkg: (typeof playstoreEntries)[number]) => ({
      packageName: pkg.packageName,
      displayName: pkg.displayName ?? pkg.packageName,
      api: {
        platformSegment: splitPackageName(pkg.packageName)?.platformSegment ?? '',
        major: parseApiVersion(pkg.apiLevelText).major,
        minor: parseApiVersion(pkg.apiLevelText).minor,
        codename: pkg.codename,
        extensionLevel: pkg.extensionLevel,
        baseExtension: pkg.baseExtension
      },
      services: classifyTags(pkg.tagIds).services,
      featureTags: classifyTags(pkg.tagIds).featureTags,
      abi: pkg.abi,
      channel: pkg.channel,
      revision: pkg.revision,
      sizeBytes: pkg.sizeBytes,
      installed: false,
      source: 'remote+local' as const
    })
    const remote = playstoreEntries.filter((pkg) => pkg.abi === 'arm64-v8a').map(remoteEntry)
    const verified: LocalImageRecord = {
      packageName: 'system-images;android-36.1;google_apis_playstore;arm64-v8a',
      displayName: null,
      apiLevelText: '36.1',
      extensionLevel: 20,
      tagIds: ['google_apis_playstore'],
      abi: 'arm64-v8a',
      revision: null,
      verified: true
    }
    const ghost: LocalImageRecord = {
      ...verified,
      packageName: 'system-images;android-33;default;arm64-v8a'
    }
    const merged = mergeCatalog(
      remote,
      new Map([
        [verified.packageName, verified],
        [ghost.packageName, ghost]
      ])
    )
    expect(merged.find((e) => e.packageName === verified.packageName)?.installed).toBe(true)
    const localOnly = merged.find((e) => e.packageName === ghost.packageName)
    expect(localOnly?.source).toBe('local-only')
    expect(localOnly?.installed).toBe(true)
  })
})

describe('fetchImageCatalog（离线与部分失败）', () => {
  it('全部源失败：offline + 空目录', async () => {
    const result = await fetchImageCatalog('/sdk', {
      fetcher: async () => {
        throw new Error('network down')
      },
      readdir: async () => {
        throw new Error('no dir')
      }
    })
    expect(result.offline).toBe(true)
    expect(result.sourceWarnings).toHaveLength(MANIFEST_SOURCES.length)
    expect(result.images).toEqual([])
  })

  it('部分源失败：其余来源保留 + 警告', async () => {
    const result = await fetchImageCatalog('/sdk', {
      fetcher: async (url: string) => {
        if (url.includes('android-wear')) throw new Error('503')
        return readManifest(
          url.includes('google_apis_playstore') ? 'google_apis_playstore' : 'android'
        )
      },
      readdir: async () => {
        throw new Error('no dir')
      }
    })
    expect(result.offline).toBe(false)
    expect(result.sourceWarnings.some((w) => w.includes('android-wear'))).toBe(true)
    expect(result.images.length).toBeGreaterThan(0)
  })
})
