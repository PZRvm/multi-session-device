// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { parseDeviceProfiles } from '../profiles'

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

describe('parseDeviceProfiles', () => {
  it('提取 id/Name 并剔除带 Tag 的非手机类', () => {
    const profiles = parseDeviceProfiles(FIXTURE)
    expect(profiles.map((profile) => profile.id)).toEqual([
      'medium_phone',
      'pixel_8',
      'pixel_8_pro',
      'pixel_tablet'
    ])
    expect(profiles.every((profile) => !profile.id.includes('automotive'))).toBe(true)
    expect(profiles.every((profile) => !profile.id.includes('ai_glasses'))).toBe(true)
  })

  it('按名称排序（zh locale 排序，英文按字母）', () => {
    const profiles = parseDeviceProfiles(FIXTURE)
    const names = profiles.map((profile) => profile.name)
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN')))
  })

  it('坏块（缺 id 或 Name）跳过；空输出返回空数组', () => {
    expect(parseDeviceProfiles('Available devices definitions:\n---------')).toEqual([])
    expect(parseDeviceProfiles('id: 1 or "x"\n    Name: X\n')).toEqual([{ id: 'x', name: 'X' }])
  })
})
