// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { parseAvdDeviceEntries, listDeviceProfiles } from '../profiles'
import { type RawProfileMeta, parseDeviceXml } from '../profileMetadata'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** 节选自 avdmanager list device 真实输出（cmdline-tools 23，本机） */
const FIXTURE = `Available devices definitions:
id: 0 or "ai_glasses_device"
    Name: AI Glasses
    OEM : Google
    Tag : ai-glasses
---------
id: 3 or "automotive_1024p_landscape"
    Name: Automotive (1024p landscape)
    OEM : Google
    Tag : android-automotive-playstore
---------
id: 43 or "pixel_8"
    Name: Pixel 8
    OEM : Google
---------
id: 44 or "pixel_8_pro"
    Name: Pixel 8 Pro
    OEM : Google
---------
id: 90 or "pixel_tablet"
    Name: Pixel Tablet
    OEM : Google
---------
id: 36 or "medium_phone"
    Name: Medium Phone
    OEM : Google
---------`

describe('parseAvdDeviceEntries', () => {
  it('提取 id/Name/OEM/Tag——带 Tag 的 wear/tv/automotive 不再被剔除', () => {
    const entries = parseAvdDeviceEntries(FIXTURE)
    expect(entries.map((entry) => entry.id)).toEqual([
      'ai_glasses_device',
      'automotive_1024p_landscape',
      'pixel_8',
      'pixel_8_pro',
      'pixel_tablet',
      'medium_phone'
    ])
    expect(entries[0]).toEqual({
      id: 'ai_glasses_device',
      name: 'AI Glasses',
      oem: 'Google',
      tagId: 'ai-glasses'
    })
    expect(entries[2]).toEqual({ id: 'pixel_8', name: 'Pixel 8', oem: 'Google', tagId: null })
  })

  it('坏块（缺 id 或 Name）跳过；空输出返回空数组', () => {
    expect(parseAvdDeviceEntries('Available devices definitions:\n---------')).toEqual([])
    expect(parseAvdDeviceEntries('id: 1 or "x"\n    Name: X\n')).toEqual([
      { id: 'x', name: 'X', oem: null, tagId: null }
    ])
  })
})

const fixtureDir = join(__dirname, 'fixtures')
const readDeviceXml = (name: string): string =>
  readFileSync(join(fixtureDir, 'devices-xml', name), 'utf8')

/** 用 nexus.xml 的 pixel_8 元数据当作注入源，验证组合逻辑 */
const PIXEL_8_META: RawProfileMeta[] = parseDeviceXml(readDeviceXml('nexus.xml')).filter(
  (meta) => meta.id === 'pixel_8'
)

describe('listDeviceProfiles（avdmanager 输出 + jar 元数据关联）', () => {
  it('双方都有 → 富元数据 + creatable；仅 avdmanager → 贫元数据 creatable；仅 XML → 不可创建', async () => {
    const profiles = await listDeviceProfiles({
      avdmanagerPath: '/unused',
      runner: async () => FIXTURE,
      metaSource: () => [
        ...PIXEL_8_META,
        // XML 独有：不在 avdmanager 输出中 → 展示但不可创建
        { ...PIXEL_8_META[0], id: 'xml_only_device', name: 'Xml Only' }
      ]
    })
    const byId = new Map(profiles.map((profile) => [profile.id, profile]))

    const pixel8 = byId.get('pixel_8')
    expect(pixel8?.creatable).toBe(true)
    expect(pixel8?.manufacturer).toBe('Google')
    expect(pixel8?.screen.widthPx).toBe(1080)
    expect(pixel8?.formFactor).toBe('phone')

    // avdmanager 独有：元数据缺失但不猜
    const automotive = byId.get('automotive_1024p_landscape')
    expect(automotive?.creatable).toBe(true)
    expect(automotive?.formFactor).toBe('automotive')
    expect(automotive?.screen.diagonalInches).toBeNull()

    // ai-glasses：未知标签 → unknown，不塞进手机
    expect(byId.get('ai_glasses_device')?.formFactor).toBe('unknown')

    // XML 独有：可展示、不可创建
    const xmlOnly = byId.get('xml_only_device')
    expect(xmlOnly?.creatable).toBe(false)
    expect(xmlOnly?.screen.widthPx).toBe(1080)
  })

  it('metaSource 缺省时走 adm-zip 读 jar（缺 jar 降级为 avd-only）', async () => {
    const profiles = await listDeviceProfiles({
      avdmanagerPath: '/unused/avdmanager',
      jarPath: join(fixtureDir, 'no-such.jar'),
      runner: async () => FIXTURE
    })
    expect(profiles).toHaveLength(6)
    expect(profiles.every((profile) => profile.screen.widthPx === null)).toBe(true)
    expect(profiles.every((profile) => profile.creatable)).toBe(true)
  })
})
