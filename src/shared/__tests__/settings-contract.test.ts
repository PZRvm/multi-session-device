import { describe, expect, it } from 'vitest'
import {
  EDITABLE_SETTING_KEYS,
  GPU_MODES,
  NETWORK_DELAY_PRESETS,
  NETWORK_SPEED_PRESETS,
  normalizeEditedSettings,
  sanitizeUpdateSettings
} from '../settings-contract'
import { buildCapabilities } from '../../main/emulator/settings'

/** 编辑差异闭集守卫（plan 2026-10-08 设计 1）：三进程单源的纯函数层 */

describe('编辑只校验真实差异', () => {
  const caps = buildCapabilities({
    profile: { id: 'pixel_8', formFactor: 'phone', ramMiB: 2048 },
    imagePackageName: 'system-images;android-34;default;arm64-v8a',
    emulatorVersion: null
  })
  it('仅改网络保留旧 RAM、超范围存储、旧 CPU、失效皮肤/摄像头以及 Quick 转 Cold', () => {
    const original = {
      ...caps.defaults,
      ramMiB: 512,
      internalStorageMiB: 999999,
      cpuCores: 999,
      skinRef: 'imported:removed',
      frontCamera: { mode: 'webcam' as const, deviceId: 'webcam9' },
      bootMode: 'quick' as const
    }
    const result = normalizeEditedSettings(original, { networkSpeed: 'lte' }, caps)
    expect(result.errors).toEqual({})
    expect(result.settings).toEqual({ ...original, networkSpeed: 'lte', bootMode: 'cold' })
  })
  it('无实际差异不归一化 Quick，也不补摄像头身份', () => {
    const original = { ...caps.defaults, bootMode: 'quick' as const }
    expect(normalizeEditedSettings(original, { graphics: original.graphics }, caps).settings).toBe(
      original
    )
  })
  it('RAM/heap 变化仍检查关联字段；变化 RAM 本身越界拒绝', () => {
    expect(
      normalizeEditedSettings({ ...caps.defaults, vmHeapMiB: 2048 }, { ramMiB: 2048 }, caps).errors
    ).toEqual({})
    expect(
      normalizeEditedSettings({ ...caps.defaults, vmHeapMiB: 2048 }, { ramMiB: 4096 }, caps).errors
        .vmHeapMiB
    ).toBeTruthy()
    expect(
      normalizeEditedSettings(caps.defaults, { ramMiB: 1024 }, caps).errors.ramMiB
    ).toBeTruthy()
    expect(
      normalizeEditedSettings(caps.defaults, { vmHeapMiB: 2000 }, caps).errors.vmHeapMiB
    ).toBeTruthy()
  })
  it('新选失效皮肤或摄像头拒绝，禁用字段不能伪造修改，但可清除皮肤', () => {
    expect(
      normalizeEditedSettings(caps.defaults, { skinRef: 'sdk:missing' }, caps).errors.skinRef
    ).toBeTruthy()
    expect(
      normalizeEditedSettings(
        caps.defaults,
        { frontCamera: { mode: 'webcam', deviceId: 'webcam9' } },
        caps
      ).errors.frontCamera
    ).toBeTruthy()
    expect(
      normalizeEditedSettings({ ...caps.defaults, skinRef: 'sdk:missing' }, { skinRef: null }, caps)
        .errors
    ).toEqual({})
  })
})

describe('sanitizeUpdateSettings（差异闭集）', () => {
  it('空对象合法（无差异）', () => {
    expect(sanitizeUpdateSettings({})).toEqual({})
  })

  it('白名单键按形状校验后原样定型', () => {
    const diff = sanitizeUpdateSettings({
      skinRef: null,
      networkSpeed: 'lte',
      networkLatency: 'none',
      orientation: 'portrait',
      bootMode: 'cold',
      cpuCores: 6,
      graphics: 'host',
      ramMiB: 4096,
      vmHeapMiB: 512,
      frontCamera: { mode: 'webcam', deviceId: 'webcam0', hostDeviceId: 'FaceTime' },
      rearCamera: { mode: 'none', deviceId: null }
    })
    expect(diff).toEqual({
      skinRef: null,
      networkSpeed: 'lte',
      networkLatency: 'none',
      orientation: 'portrait',
      bootMode: 'cold',
      cpuCores: 6,
      graphics: 'host',
      ramMiB: 4096,
      vmHeapMiB: 512,
      frontCamera: { mode: 'webcam', deviceId: 'webcam0', hostDeviceId: 'FaceTime' },
      rearCamera: { mode: 'none', deviceId: null }
    })
  })

  it('内部存储与应用 ABI 键出现即拒绝（即使值看似合法）', () => {
    expect(() => sanitizeUpdateSettings({ internalStorageMiB: 6144 })).toThrow('内部存储不允许修改')
    expect(() => sanitizeUpdateSettings({ preferredAbi: 'optimal' })).toThrow('应用 ABI 不允许修改')
  })

  it('画像/镜像/任意未知键拒绝', () => {
    expect(() => sanitizeUpdateSettings({ profileId: 'pixel_9' })).toThrow('非法字段（profileId）')
    expect(() => sanitizeUpdateSettings({ imagePackageName: 'system-images;x' })).toThrow(
      '非法字段（imagePackageName）'
    )
    expect(() => sanitizeUpdateSettings({ 'hw.ramSize': '4096' })).toThrow('非法字段（hw.ramSize）')
  })

  it('字段取值形状逐键校验：枚举/整数/摄像头', () => {
    expect(() => sanitizeUpdateSettings({ networkSpeed: 'none' })).toThrow('networkSpeed') // -netspeed 无 none
    expect(() => sanitizeUpdateSettings({ networkLatency: 'full' })).toThrow('networkLatency')
    expect(() => sanitizeUpdateSettings({ graphics: 'vulkan' })).toThrow('graphics')
    expect(() => sanitizeUpdateSettings({ bootMode: 'warm' })).toThrow('bootMode')
    expect(() => sanitizeUpdateSettings({ orientation: 'square' })).toThrow('orientation')
    expect(() => sanitizeUpdateSettings({ cpuCores: 2.5 })).toThrow('cpuCores')
    expect(() => sanitizeUpdateSettings({ ramMiB: 0 })).toThrow('ramMiB')
    expect(() => sanitizeUpdateSettings({ skinRef: 42 })).toThrow('skinRef')
    expect(() =>
      sanitizeUpdateSettings({ frontCamera: { mode: 'webcam', deviceId: null } })
    ).toThrow('frontCamera')
    expect(() =>
      sanitizeUpdateSettings({ rearCamera: { mode: 'hologram', deviceId: null } })
    ).toThrow('rearCamera')
  })

  it('非对象载荷拒绝', () => {
    expect(() => sanitizeUpdateSettings(null)).toThrow('附加设置载荷不合法')
    expect(() => sanitizeUpdateSettings('ramMiB=4096')).toThrow('附加设置载荷不合法')
  })

  it('白名单与网络/GPU 枚举闭集一致（防止漂移）', () => {
    expect(EDITABLE_SETTING_KEYS).not.toContain('internalStorageMiB')
    expect(EDITABLE_SETTING_KEYS).not.toContain('preferredAbi')
    expect(NETWORK_SPEED_PRESETS).not.toContain('none')
    expect(NETWORK_DELAY_PRESETS).not.toContain('full')
    expect(GPU_MODES).toContain('host')
  })
})
