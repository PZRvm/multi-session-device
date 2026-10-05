// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildCapabilities,
  readEmulatorVersion,
  normalizeAdvancedSettings,
  settingsToConfigPatch,
  settingsToRunnerArgs
} from '../settings'
import type { DeviceAdvancedSettings, WizardCapabilities } from '@shared/types'

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

  it('画像 RAM 缺失或低于镜像最低要求时抬到 2048；wear/tv 朝向禁用', () => {
    const weak = buildCapabilities({
      profile: { id: 'old', ramMiB: 1024, formFactor: 'phone' },
      imagePackageName: 'pkg',
      emulatorVersion: null
    })
    expect(weak.defaults.ramMiB).toBe(2048)
    const wear = buildCapabilities({
      profile: { id: 'wear', ramMiB: 1024, formFactor: 'wear' },
      imagePackageName: 'pkg',
      emulatorVersion: null
    })
    expect(wear.fields.orientation.disabledReason).not.toBeNull()
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
})
