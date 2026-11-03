// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  classifyFormFactor,
  loadFrameKindIndex,
  logicalDpiFromDensity,
  mergeProfiles,
  parseApiRange,
  parseDeviceXml,
  parseSizeToMiB,
  withImpliedFormTag,
  type AvdDeviceEntry
} from '../profileMetadata'
import { parseAvdDeviceEntries } from '../profiles'

/**
 * 真实 fixture 驱动（批次 1 提取自本机 cmdline-tools sdklib.core.jar，
 * namespace 版本 devices/1–10 各不相同），不用手写假样本。
 */
const fixtureDir = join(__dirname, 'fixtures', 'devices-xml')
const readXml = (name: string): string => readFileSync(join(fixtureDir, name), 'utf8')
const XML_FILES = ['automotive', 'desktop', 'devices', 'nexus', 'tv', 'wear', 'xr']

const allMetas = XML_FILES.flatMap((name) => parseDeviceXml(readXml(`${name}.xml`)))
/** 生产 readJarProfileMetas 同构的镜像 fixture：裸解析 + 源文件隐含形态 tag */
const jarMetas = XML_FILES.flatMap((name) =>
  withImpliedFormTag(name, parseDeviceXml(readXml(`${name}.xml`)))
)

describe('parseDeviceXml（真实 XML，namespace 1–10 全容忍）', () => {
  it('七份文件全部可解析且 id 唯一（≥91 个，与 avdmanager 输出对齐）', () => {
    expect(allMetas.length).toBeGreaterThanOrEqual(91)
    const ids = new Set(allMetas.map((meta) => meta.id))
    expect(ids.size).toBe(allMetas.length)
  })

  it('pixel_7 富字段：屏幕/密度/Play/前后摄像头/RAM', () => {
    const pixel7 = allMetas.find((meta) => meta.id === 'pixel_7')
    expect(pixel7).toBeDefined()
    expect(pixel7?.name).toBe('Pixel 7')
    expect(pixel7?.manufacturer).toBe('Google')
    expect(pixel7?.screen.widthPx).toBe(1080)
    expect(pixel7?.screen.heightPx).toBe(2400)
    expect(pixel7?.screen.diagonalInches).toBe(6.31)
    expect(pixel7?.screen.logicalDpi).toBe(420)
    expect(pixel7?.playSupported).toBe(true)
    expect(pixel7?.hasFrontCamera).toBe(true)
    expect(pixel7?.hasBackCamera).toBe(true)
    expect(pixel7?.ramMiB).toBeGreaterThan(0)
    expect(pixel7?.tagIds).toEqual([])
    expect(pixel7?.foldable).toBe(false)
  })

  it('可折叠画像带 foldable 标记（devices.xml 的 Foldable 系列）', () => {
    const foldable = allMetas.filter((meta) => meta.foldable)
    expect(foldable.length).toBeGreaterThan(0)
    expect(
      foldable.every(
        (meta) => meta.screen.diagonalInches === null || meta.screen.diagonalInches > 0
      )
    ).toBe(true)
  })

  it('缺失字段为 null，不伪造（xr/desktop 设备多数无 playstore-enabled）', () => {
    const xr = parseDeviceXml(readXml('xr.xml'))
    expect(xr.length).toBeGreaterThan(0)
    expect(xr.some((meta) => meta.playSupported === null)).toBe(true)
  })

  it('坏 XML 返回空数组不抛错', () => {
    expect(parseDeviceXml('<not-a-devices-file/>')).toEqual([])
    expect(parseDeviceXml('')).toEqual([])
  })
})

describe('parseApiRange（api-level 的「14-」范围语义）', () => {
  it('min-only / 区间 / 单值 / 未知', () => {
    expect(parseApiRange('14-')).toEqual({ min: 14, max: null })
    expect(parseApiRange('29-33')).toEqual({ min: 29, max: 33 })
    expect(parseApiRange('36')).toEqual({ min: 36, max: null })
    expect(parseApiRange('-1')).toEqual({ min: null, max: null })
    expect(parseApiRange(undefined)).toEqual({ min: null, max: null })
  })

  it('真实 nexus.xml 里能取到非空 apiMin', () => {
    const withApi = allMetas.filter((meta) => meta.apiMin !== null)
    expect(withApi.length).toBeGreaterThan(0)
    expect(withApi.every((meta) => (meta.apiMin as number) > 0)).toBe(true)
  })
})

describe('logicalDpiFromDensity / parseSizeToMiB', () => {
  it('密度符号与 Ndpi 数值都能换算，xdpi 不参与', () => {
    expect(logicalDpiFromDensity('xhdpi')).toBe(320)
    expect(logicalDpiFromDensity('420dpi')).toBe(420)
    expect(logicalDpiFromDensity('nonsense')).toBeNull()
    expect(logicalDpiFromDensity(undefined)).toBeNull()
  })

  it('ram 的 unit 属性归一化到 MiB（KiB/GiB 真实样本形态）', () => {
    expect(parseSizeToMiB({ '@_unit': 'MiB', '#text': '512' })).toBe(512)
    expect(parseSizeToMiB({ '@_unit': 'GiB', '#text': '1' })).toBe(1024)
    const kib = parseSizeToMiB({ '@_unit': 'KiB', '#text': '351428' })
    expect(kib).not.toBeNull()
    expect(Math.round(kib as number)).toBe(343)
    expect(parseSizeToMiB({ '@_unit': 'WeiDu', '#text': '1' })).toBeNull()
    expect(parseSizeToMiB(undefined)).toBeNull()
  })
})

describe('classifyFormFactor（六类规则）', () => {
  it('特殊标签决定 Wear/TV/Desktop/Automotive（含 -playstore / android- 前缀变体）', () => {
    expect(
      classifyFormFactor({ tagIds: ['android-wear'], diagonalInches: 1.4, foldable: false })
    ).toBe('wear')
    expect(
      classifyFormFactor({ tagIds: ['android-tv'], diagonalInches: null, foldable: false })
    ).toBe('tv')
    expect(
      classifyFormFactor({ tagIds: ['android-desktop'], diagonalInches: null, foldable: false })
    ).toBe('desktop')
    expect(
      classifyFormFactor({
        tagIds: ['android-automotive-playstore'],
        diagonalInches: 10,
        foldable: false
      })
    ).toBe('automotive')
    expect(
      classifyFormFactor({
        tagIds: ['android-automotive-distantdisplay'],
        diagonalInches: null,
        foldable: false
      })
    ).toBe('automotive')
  })

  it('无标签：≥7 英寸非折叠 → tablet；其余有屏幕 → phone；折叠手机归 phone', () => {
    expect(classifyFormFactor({ tagIds: [], diagonalInches: 10.1, foldable: false })).toBe('tablet')
    expect(classifyFormFactor({ tagIds: [], diagonalInches: 6.3, foldable: false })).toBe('phone')
    expect(classifyFormFactor({ tagIds: [], diagonalInches: 7.6, foldable: true })).toBe('phone')
    expect(classifyFormFactor({ tagIds: [], diagonalInches: null, foldable: false })).toBe(
      'unknown'
    )
  })

  it('未知标签保留 unknown，不塞进手机；多标签时已知标签可命中', () => {
    expect(
      classifyFormFactor({ tagIds: ['ai-glasses'], diagonalInches: null, foldable: false })
    ).toBe('unknown')
    expect(
      classifyFormFactor({
        tagIds: ['something-new', 'android-tv'],
        diagonalInches: null,
        foldable: false
      })
    ).toBe('tv')
  })

  it('真实数据：wearos_large_round → wear；pixel_tablet → tablet；Pixel Fold → phone（tag 合并后分类）', () => {
    // XML 侧 wear 设备不带 tag，avdmanager 侧才有——按 mergeProfiles 的合并口径验证
    const avdText = readFileSync(join(__dirname, 'fixtures', 'avdmanager-list-device.txt'), 'utf8')
    const profiles = mergeProfiles(parseAvdDeviceEntries(avdText), allMetas)
    const formOf = (id: string): string | undefined =>
      profiles.find((profile) => profile.id === id)?.formFactor
    expect(formOf('wearos_large_round')).toBe('wear')
    expect(formOf('pixel_tablet')).toBe('tablet')
    expect(formOf('pixel_fold')).toBe('phone')
    expect(formOf('automotive_1024p_landscape')).toBe('automotive')
    expect(formOf('pixel_7')).toBe('phone')
  })
})

describe('mergeProfiles（关联三态）', () => {
  const avdEntries: AvdDeviceEntry[] = [
    { id: 'pixel_7', name: 'Pixel 7', oem: 'Google', tagId: null },
    { id: 'wearos_large_round', name: 'Wear OS Large Round', oem: 'Google', tagId: 'android-wear' },
    { id: 'wearos_square', name: 'Wear OS Square', oem: 'Google', tagId: 'android-wear' },
    { id: 'Nexus 4', name: 'Nexus 4', oem: 'Google', tagId: null }
  ]
  const metas = allMetas.filter((meta) =>
    ['pixel_7', 'wearos_large_round', 'xml_ghost'].includes(meta.id)
  )
  if (metas.length < 2) metas.push(...allMetas.filter((m) => m.id === 'pixel_7'))

  it('wear 圆屏按官方 id 命名约定标记 round；方屏 false；非 wear null', () => {
    const profiles = mergeProfiles(avdEntries, allMetas)
    const round = profiles.find((profile) => profile.id === 'wearos_large_round')
    expect(round?.screen.round).toBe(true)
    const square = profiles.find((profile) => profile.id === 'wearos_square')
    if (square) expect(square.screen.round).toBe(false)
    expect(profiles.find((profile) => profile.id === 'pixel_7')?.screen.round).toBeNull()
  })

  it('avdmanager 独有条目（legacy Nexus）保留、可创建、元数据 null', () => {
    const profiles = mergeProfiles(avdEntries, allMetas)
    const nexus4 = profiles.find((profile) => profile.id === 'Nexus 4')
    expect(nexus4?.creatable).toBe(true)
    expect(nexus4?.screen.widthPx).toBeNull()
    expect(nexus4?.formFactor).toBe('unknown')
  })

  it('deprecated 当前恒 false（官方源无信号，不伪造）', () => {
    const profiles = mergeProfiles(avdEntries, allMetas)
    expect(profiles.every((profile) => profile.deprecated === false)).toBe(true)
  })
})

describe('withImpliedFormTag（源文件隐含形态 tag——avdmanager Tag 按文件归类的镜像）', () => {
  it('形态专属文件补 tag、通用文件原样、不改动入参、重复 tag 不叠加', () => {
    const wearMetas = parseDeviceXml(readXml('wear.xml'))
    const enriched = withImpliedFormTag('wear', wearMetas)
    expect(enriched.every((meta) => meta.tagIds.includes('android-wear'))).toBe(true)
    // 纯函数：入参对象不被改动
    expect(wearMetas.some((meta) => meta.tagIds.includes('android-wear'))).toBe(false)
    // 通用文件（devices/nexus）无隐含 tag
    expect(withImpliedFormTag('devices', parseDeviceXml(readXml('devices.xml')))).toEqual(
      parseDeviceXml(readXml('devices.xml'))
    )
    // 已含隐含 tag 的输入不重复叠加
    expect(
      withImpliedFormTag('wear', enriched).every((meta) => {
        const count = meta.tagIds.filter((tag) => tag === 'android-wear').length
        return count === 1
      })
    ).toBe(true)
  })

  it('补 tag 后无 avdmanager 条目也能正确分类（此前裸元数据把 wear 判成 phone）', () => {
    const profiles = mergeProfiles([], jarMetas)
    expect(profiles.find((profile) => profile.id === 'wearos_large_round')?.formFactor).toBe('wear')
    expect(profiles.find((profile) => profile.id === 'pixel_7')?.formFactor).toBe('phone')
  })
})

describe('loadFrameKindIndex（外框外观索引：classifyFormFactor 单一分类规则的薄包装）', () => {
  it('真实 fixture（含隐含 tag）：pixel_7 → phone、tablet 命中、wear/tv/未命中 → generic', async () => {
    const index = await loadFrameKindIndex('/sdk', { readMetas: () => jarMetas })
    expect(index.lookup('pixel_7')).toBe('phone')
    const tablet = jarMetas.find(
      (meta) =>
        classifyFormFactor({
          tagIds: meta.tagIds,
          diagonalInches: meta.screen.diagonalInches,
          foldable: meta.foldable
        }) === 'tablet'
    )
    if (tablet) expect(index.lookup(tablet.id)).toBe('tablet')
    // 隐含 tag 修复（issue 合并融合补充 P3）：wear/tv 非手机/平板形态 →
    // generic 兜底（外框无对应壳），不再按屏幕尺寸误判 phone
    expect(index.lookup('wearos_large_round')).toBe('generic')
    const tv = jarMetas.find((meta) => meta.tagIds.includes('android-tv'))
    if (tv) expect(index.lookup(tv.id)).toBe('generic')
    expect(index.lookup('no-such-profile')).toBe('generic')
    expect(index.entries).toBe(jarMetas.length)
  })

  it('JAR 缺失/解析失败收敛空索引——不抛、lookup 恒 generic', async () => {
    const index = await loadFrameKindIndex('/sdk', { readMetas: () => [] })
    expect(index.entries).toBe(0)
    expect(index.lookup('pixel_7')).toBe('generic')
  })
})
