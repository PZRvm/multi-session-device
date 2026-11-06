// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  buildCapabilities,
  defaultGraphicsFor,
  buildEnrichedCapabilities,
  effectiveRamMin,
  readEmulatorVersion,
  normalizeAdvancedSettings,
  settingsToConfigPatch,
  settingsToRunnerArgs
} from '../settings'
import type { DeviceAdvancedSettings, WizardCapabilities } from '@shared/types'
import type { SkinRecord } from '../skins'

// 本文件以 8 核宿主验证既定的 4 核设置，不依赖 runner 实际核数。
vi.mock('node:os', async (importOriginal) => {
  const os = await importOriginal<typeof import('node:os')>()
  return { ...os, cpus: () => Array.from({ length: 8 }, () => os.cpus()[0]) }
})

const fixtureDir = join(__dirname, 'fixtures')

const capabilitiesOf = (overrides: Partial<WizardCapabilities> = {}): WizardCapabilities => ({
  capabilityContextId: 'pixel_8|pkg|36.1.9',
  emulatorVersion: '36.1.9',
  defaults: {
    skinRef: null,
    frontCamera: { mode: 'emulated', deviceId: null },
    rearCamera: { mode: 'emulated', deviceId: null },
    networkSpeed: null,
    networkLatency: null,
    orientation: null,
    bootMode: 'cold',
    internalStorageMiB: 6144,
    cpuCores: 4,
    graphics: 'auto',
    ramMiB: 8192,
    vmHeapMiB: 256,
    preferredAbi: 'optimal'
  },
  fields: {
    internalStorageMiB: { disabledReason: null, min: 2048, max: 65536, step: 1 },
    cpuCores: { disabledReason: null, min: 1, max: 12, step: 1 },
    ramMiB: { disabledReason: null, min: 2048, max: 32768, step: 1 },
    vmHeapMiB: { disabledReason: null, min: 64, max: 1024, step: 1 },
    graphics: { disabledReason: null, min: null, max: null, step: null },
    orientation: { disabledReason: null, min: null, max: null, step: null },
    networkSpeed: { disabledReason: null, min: null, max: null, step: null },
    networkLatency: { disabledReason: null, min: null, max: null, step: null },
    bootMode: { disabledReason: 'Quick 未开放', min: null, max: null, step: null },
    skinRef: { disabledReason: '皮肤未开放', min: null, max: null, step: null },
    frontCamera: { disabledReason: null, min: null, max: null, step: null },
    rearCamera: { disabledReason: null, min: null, max: null, step: null },
    preferredAbi: { disabledReason: null, min: null, max: null, step: null }
  },
  quickBootAvailable: false,
  quickBootDisabledReason: '门槛未过',
  webcamDeviceIds: [],
  skinIds: [],
  ...overrides
})

describe('buildCapabilities', () => {
  it('默认值：Cold、存储 6GB、RAM 跟随画像（不足 2GB 抬到下限）、Quick 关闭带原因', () => {
    const caps = buildCapabilities({
      profile: { id: 'pixel_8', ramMiB: 8192, formFactor: 'phone' },
      imagePackageName: 'system-images;android-36;google_apis_playstore;arm64-v8a',
      emulatorVersion: '36.1.9'
    })
    expect(caps.defaults.bootMode).toBe('cold')
    expect(caps.defaults.internalStorageMiB).toBe(6144)
    expect(caps.defaults.ramMiB).toBe(8192)
    expect(caps.quickBootAvailable).toBe(false)
    expect(caps.quickBootDisabledReason).toContain('门槛')
    expect(caps.capabilityContextId).toBe(
      'pixel_8|system-images;android-36;google_apis_playstore;arm64-v8a|36.1.9'
    )
  })

  it('RAM 地板只约束手机/平板；wear 尊重画像 RAM（缺失回 2048）；wear/tv 朝向禁用', () => {
    const weak = buildCapabilities({
      profile: { id: 'old', ramMiB: 1024, formFactor: 'phone' },
      imagePackageName: 'pkg',
      emulatorVersion: null
    })
    expect(weak.defaults.ramMiB).toBe(2048)
    const wear = buildCapabilities({
      profile: { id: 'wear', ramMiB: 768, formFactor: 'wear' },
      imagePackageName: 'pkg',
      emulatorVersion: null
    })
    expect(wear.fields.orientation.disabledReason).not.toBeNull()
    expect(wear.defaults.ramMiB).toBe(768)
    const wearNoRam = buildCapabilities({
      profile: { id: 'wear2', ramMiB: null, formFactor: 'wear' },
      imagePackageName: 'pkg',
      emulatorVersion: null
    })
    expect(wearNoRam.defaults.ramMiB).toBe(2048)
  })
})

describe('buildEnrichedCapabilities（唯一入口：review P1 双路径分叉修复）', () => {
  const baseInput = {
    profile: { id: 'pixel_8', ramMiB: 8192, formFactor: 'phone' as const },
    imagePackageName: 'system-images;android-36;google_apis_playstore;arm64-v8a',
    emulatorVersion: '36.1.9' as string | null
  }
  const skinRecord = (skinRef: string): SkinRecord => ({
    id: skinRef,
    name: skinRef,
    skinRef,
    directory: `/skins/${skinRef}`,
    layout: { portrait: null, landscape: null, imageAssets: [] },
    source: 'sdk' as const
  })

  it('补齐皮肤与摄像头枚举并解锁 skinRef；摄像头枚举失败不禁用字段、皮肤无源保持禁用带原因', async () => {
    const caps = await buildEnrichedCapabilities(baseInput, '/sdk', '/user', {
      scanSdkSkins: async () => [skinRecord('sdk:pixel_7')],
      scanImportedSkins: async () => [],
      listWebcams: async () => [
        { id: 'webcam0', deviceLabel: 'FaceTime' },
        { id: 'webcam1', deviceLabel: '外接' }
      ]
    })
    expect(caps.skinIds).toEqual(['sdk:pixel_7'])
    expect(caps.fields.skinRef.disabledReason).toBeNull()
    expect(caps.webcamDeviceIds).toEqual(['webcam0', 'webcam1'])

    const degraded = await buildEnrichedCapabilities(baseInput, '/sdk', '/user', {
      scanSdkSkins: async () => [],
      scanImportedSkins: async () => [],
      listWebcams: async () => {
        throw new Error('emulator 挂死')
      }
    })
    expect(degraded.webcamDeviceIds).toEqual([])
    expect(degraded.fields.skinRef.disabledReason).toContain('未找到可用皮肤')
  })

  it('P1 回归锚：webcam/皮肤设置在富化能力下过归一化，在裸能力下被拒（两侧口径不再分叉）', async () => {
    const settings: DeviceAdvancedSettings = {
      ...capabilitiesOf().defaults,
      skinRef: 'sdk:pixel_7',
      frontCamera: { mode: 'webcam', deviceId: 'webcam0' }
    }
    const enriched = await buildEnrichedCapabilities(baseInput, '/sdk', '/user', {
      scanSdkSkins: async () => [skinRecord('sdk:pixel_7')],
      scanImportedSkins: async () => [],
      listWebcams: async () => [{ id: 'webcam0', deviceLabel: 'FaceTime' }]
    })
    expect(normalizeAdvancedSettings(settings, enriched).errors).toEqual({})
    const bare = normalizeAdvancedSettings(settings, buildCapabilities(baseInput))
    expect(bare.errors.skinRef).toBeDefined()
    expect(bare.errors.frontCamera).toBeDefined()
  })
})

describe('readEmulatorVersion（真实 package.xml fixture）', () => {
  it('读出 36.1.9；文件缺失返回 null', async () => {
    const xml = readFileSync(join(fixtureDir, 'emulator-package.xml'), 'utf8')
    expect(await readEmulatorVersion('/sdk', { readFile: async () => xml })).toBe('36.1.9')
    expect(
      await readEmulatorVersion('/sdk', {
        readFile: async () => {
          throw new Error('missing')
        }
      })
    ).toBeNull()
  })
})

describe('normalizeAdvancedSettings', () => {
  const caps = capabilitiesOf()
  const valid: DeviceAdvancedSettings = caps.defaults

  it('null 直通；合法值原样归一化通过', () => {
    expect(normalizeAdvancedSettings(null, caps)).toEqual({ settings: null, errors: {} })
    const result = normalizeAdvancedSettings(valid, caps)
    expect(result.errors).toEqual({})
    expect(result.settings?.bootMode).toBe('cold')
  })

  it('数值越界/NaN 逐字段中文报错；heap 超 RAM 一半报错', () => {
    const bad = normalizeAdvancedSettings(
      { ...valid, ramMiB: 1024, vmHeapMiB: 900, cpuCores: 99 },
      caps
    )
    expect(bad.errors.ramMiB).toContain('2048')
    expect(bad.errors.vmHeapMiB).toContain('一半')
    expect(bad.errors.cpuCores).toContain('1–12')
  })

  it('Quick 伪造入参回落 Cold（门槛独立于入参）', () => {
    const forged = normalizeAdvancedSettings({ ...valid, bootMode: 'quick' }, caps)
    expect(forged.settings?.bootMode).toBe('cold')
  })

  it('Quick 开放后按入参放行（批次 9 门槛开关）', () => {
    const open = normalizeAdvancedSettings(
      { ...valid, bootMode: 'quick' },
      capabilitiesOf({ quickBootAvailable: true })
    )
    expect(open.settings?.bootMode).toBe('quick')
  })

  it('非法枚举（GPU/朝向/网络/摄像头）报错且归一化回落安全值', () => {
    const bad = normalizeAdvancedSettings(
      {
        ...valid,
        graphics: 'vulkan' as DeviceAdvancedSettings['graphics'],
        orientation: 'diagonal' as DeviceAdvancedSettings['orientation'],
        frontCamera: { mode: 'webcam', deviceId: 'webcam0' }
      },
      caps
    )
    expect(bad.errors.graphics).toBeDefined()
    expect(bad.errors.orientation).toBeDefined()
    expect(bad.errors.frontCamera).toBeDefined()
    expect(bad.settings?.graphics).toBe('auto')
  })

  it('网络预设逐字段校验：-netspeed none 与 -netdelay full 报错，不再共享并集（review P3）', () => {
    const badSpeed = normalizeAdvancedSettings({ ...valid, networkSpeed: 'none' }, caps)
    expect(badSpeed.errors.networkSpeed).toBeDefined()
    const badDelay = normalizeAdvancedSettings({ ...valid, networkLatency: 'full' }, caps)
    expect(badDelay.errors.networkLatency).toBeDefined()
    expect(
      normalizeAdvancedSettings({ ...valid, networkLatency: 'none' }, caps).errors.networkLatency
    ).toBeUndefined()
    expect(
      normalizeAdvancedSettings({ ...valid, networkSpeed: 'full' }, caps).errors.networkSpeed
    ).toBeUndefined()
  })

  it('字段禁用态 main 侧复核：不支持朝向的形态提交 orientation 被拒（review P3）', () => {
    const tvCaps = capabilitiesOf({
      fields: {
        ...capabilitiesOf().fields,
        orientation: {
          disabledReason: '该形态不支持固定初始朝向',
          min: null,
          max: null,
          step: null
        }
      }
    })
    const result = normalizeAdvancedSettings({ ...valid, orientation: 'landscape' }, tvCaps)
    expect(result.errors.orientation).toContain('不支持')
  })
})

describe('settingsToConfigPatch / settingsToRunnerArgs（白名单映射）', () => {
  it('config patch 只含白名单键；朝向可选', () => {
    const patch = settingsToConfigPatch(capabilitiesOf().defaults)
    expect(Object.keys(patch).sort()).toEqual(
      [
        'disk.dataPartition.size',
        'hw.camera.back',
        'hw.camera.front',
        'hw.cpu.ncore',
        'hw.gpu.mode',
        'hw.ramSize',
        'vm.heapSize'
      ].sort()
    )
    expect(patch['disk.dataPartition.size']).toBe('6144M')
    const oriented = settingsToConfigPatch({
      ...capabilitiesOf().defaults,
      orientation: 'landscape'
    })
    expect(oriented['hw.initialOrientation']).toBe('landscape')
    // webcam 缺 deviceId 兜底 emulated——不假定 webcam0 永远存在（review P3）
    const webcamless = settingsToConfigPatch({
      ...capabilitiesOf().defaults,
      frontCamera: { mode: 'webcam', deviceId: null }
    })
    expect(webcamless['hw.camera.front']).toBe('emulated')
  })

  it('runner argv：显式 GPU/网络/非模拟摄像头/Cold 逐项入参；auto 与 emulated 不产生参数', () => {
    expect(settingsToRunnerArgs(capabilitiesOf().defaults)).toEqual(['-no-snapshot'])
    const rich = settingsToRunnerArgs({
      ...capabilitiesOf().defaults,
      networkSpeed: 'lte',
      networkLatency: 'edge',
      graphics: 'swiftshader_indirect',
      rearCamera: { mode: 'none', deviceId: null },
      bootMode: 'quick'
    })
    expect(rich).toEqual([
      '-netspeed',
      'lte',
      '-netdelay',
      'edge',
      '-gpu',
      'swiftshader_indirect',
      '-camera-back',
      'none'
    ])
  })

  it('virtualScene：config 写小写 virtualscene；argv 不传 camera 参数（37.2.12 实测口径）', () => {
    const settings = {
      ...capabilitiesOf().defaults,
      frontCamera: { mode: 'virtualScene' as const, deviceId: null },
      rearCamera: { mode: 'virtualScene' as const, deviceId: null }
    }
    const patch = settingsToConfigPatch(settings)
    expect(patch['hw.camera.front']).toBe('virtualscene')
    expect(patch['hw.camera.back']).toBe('virtualscene')
    // argv 的 -camera-* 不接受 virtualscene（exit 1）——不传参，交给 config 承载
    expect(settingsToRunnerArgs(settings)).toEqual(['-no-snapshot'])
  })
})

describe('宿主绑定与精确皮肤预选', () => {
  const input = {
    profile: { id: 'pixel_7', ramMiB: 8192, formFactor: 'phone' as const },
    imagePackageName: 'system-images;android-36;google_apis;arm64-v8a',
    emulatorVersion: '37.2.12'
  }
  it('精确对应缓存预选，用户通用外框仍合法，排序变化拒绝旧宿主绑定', async () => {
    const caps = await buildEnrichedCapabilities(input, '/sdk', '/user', {
      scanSdkSkins: async () => [],
      scanImportedSkins: async () => [
        {
          id: 'u1',
          name: 'pixel_7',
          skinRef: 'downloaded:u1',
          directory: '/skins/u1',
          source: 'downloaded',
          layout: { portrait: null, landscape: null, imageAssets: [] }
        }
      ],
      listWebcams: async () => [{ id: 'webcam0', deviceLabel: 'host-a', name: 'MacBook' }]
    })
    expect(caps.defaults.skinRef).toBe('downloaded:u1')
    expect(caps.recommendedSkin?.name).toBe('pixel_7')
    const chosen = normalizeAdvancedSettings(
      { ...caps.defaults, skinRef: null, frontCamera: { mode: 'webcam', deviceId: 'webcam0' } },
      caps
    )
    expect(chosen.settings?.frontCamera).toEqual({
      mode: 'webcam',
      deviceId: 'webcam0',
      hostDeviceId: 'host-a'
    })
    expect(chosen.settings?.skinRef).toBeNull()
    const reordered = {
      ...caps,
      cameraSnapshot: {
        permission: 'granted' as const,
        devices: [{ id: 'webcam0', deviceLabel: 'host-b' }],
        error: null
      }
    }
    expect(normalizeAdvancedSettings(chosen.settings, reordered).errors.frontCamera).toBeDefined()
  })
})

describe('effectiveRamMin（RAM 有效下限——创建/编辑同一规则）', () => {
  it('默认 2048；仅已实测组合（emulator 37.2.12 × pixel_8 × android-34 default arm64）按 2560', () => {
    const combo = {
      profileId: 'pixel_8',
      imagePackageName: 'system-images;android-34;default;arm64-v8a',
      emulatorBuildId: '16428233',
      imageRevision: 2
    }
    expect(effectiveRamMin({ ...combo, emulatorVersion: '37.2.12.0' })).toBe(2560)
    // emulator 版本、画像、镜像任一不同都回落 2048（不能把一次实测推广）
    expect(effectiveRamMin({ ...combo, emulatorVersion: '36.1.9' })).toBe(2048)
    expect(effectiveRamMin({ ...combo, emulatorVersion: '37.2.13' })).toBe(2048)
    expect(effectiveRamMin({ ...combo, emulatorVersion: null })).toBe(2048)
    expect(effectiveRamMin({ ...combo, emulatorVersion: '37.2.120' })).toBe(2048)
    expect(
      effectiveRamMin({ ...combo, emulatorVersion: '37.2.12', emulatorBuildId: 'other' })
    ).toBe(2048)
    expect(effectiveRamMin({ ...combo, emulatorVersion: '37.2.12', imageRevision: 3 })).toBe(2048)
    expect(
      effectiveRamMin({ ...combo, emulatorVersion: '37.2.12', imageRevision: undefined })
    ).toBe(2048)
    expect(
      effectiveRamMin({
        ...combo,
        imagePackageName: 'system-images;android-34;google_apis;arm64-v8a',
        emulatorVersion: '37.2.12.0'
      })
    ).toBe(2048)
    expect(
      effectiveRamMin({
        profileId: 'pixel_9',
        imagePackageName: combo.imagePackageName,
        emulatorVersion: '37.2.12.0'
      })
    ).toBe(2048)
  })

  it('buildCapabilities 的 ramMiB 下限走同一规则（已实测组合 2560）', () => {
    const verified = buildCapabilities({
      profile: { id: 'pixel_8', ramMiB: null, formFactor: 'phone' },
      imagePackageName: 'system-images;android-34;default;arm64-v8a',
      emulatorBuildId: '16428233',
      imageRevision: 2,
      emulatorVersion: '37.2.12.0'
    })
    expect(verified.fields.ramMiB.min).toBe(2560)
    expect(verified.defaults.ramMiB).toBe(2560)
    expect(normalizeAdvancedSettings(verified.defaults, verified).errors).toEqual({})
    const other = buildCapabilities({
      profile: { id: 'pixel_8', ramMiB: null, formFactor: 'phone' },
      imagePackageName: 'system-images;android-36;google_apis;arm64-v8a',
      emulatorVersion: '36.1.9'
    })
    expect(other.fields.ramMiB.min).toBe(2048)
  })
})

describe('富化能力读取实际 build 和镜像 revision', () => {
  it('实际文件证据匹配才提升 RAM 下限，缺失证据保持基础范围', async () => {
    const input = {
      profile: { id: 'pixel_8', ramMiB: 2048, formFactor: 'phone' as const },
      imagePackageName: 'system-images;android-34;default;arm64-v8a',
      emulatorVersion: '37.2.12'
    }
    const deps = {
      scanSdkSkins: async () => [],
      scanImportedSkins: async () => [],
      listWebcams: async () => [],
      readFile: async (path: string) =>
        path.includes('/emulator/') ? 'Pkg.BuildId=16428233\n' : 'Pkg.Revision=2\n'
    }
    const caps = await buildEnrichedCapabilities(input, '/sdk', '/data', deps)
    expect(caps.fields.ramMiB.min).toBe(2560)
    expect(caps.defaults.ramMiB).toBe(2560)
    const unknown = await buildEnrichedCapabilities(input, '/sdk', '/data', {
      ...deps,
      readFile: async () => ''
    })
    expect(unknown.fields.ramMiB.min).toBe(2048)
  })

  it('defaultGraphicsFor：darwin 默认 host（硬件加速），其余平台维持 auto', () => {
    expect(defaultGraphicsFor('darwin')).toBe('host')
    expect(defaultGraphicsFor('win32')).toBe('auto')
    expect(defaultGraphicsFor('linux')).toBe('auto')
  })
})
