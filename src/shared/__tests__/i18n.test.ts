import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LOCALE,
  ERRORS_COPY,
  format,
  isSettingsLocale,
  LANGUAGE_OPTIONS,
  SETTINGS_COPY,
  SETTINGS_LOCALES
} from '@shared/i18n'
import { normalizeAdvancedSettings } from '@shared/settings-contract'
import type { WizardCapabilities } from '@shared/types'

describe('i18n 语言闭集', () => {
  it('三语闭集与缺省值', () => {
    expect(SETTINGS_LOCALES).toEqual(['zh-CN', 'zh-TW', 'en-US'])
    expect(DEFAULT_LOCALE).toBe('zh-CN')
    for (const locale of SETTINGS_LOCALES) expect(isSettingsLocale(locale)).toBe(true)
  })

  it('守卫拒绝闭集外的值', () => {
    for (const bad of [undefined, null, '', 'zh', 'fr-FR', 'ZH-CN', 1, {}, ['zh-CN']]) {
      expect(isSettingsLocale(bad)).toBe(false)
    }
  })

  it('语言选项与闭集一致（同序），标签自名且非空', () => {
    expect(LANGUAGE_OPTIONS.map((option) => option.value)).toEqual(SETTINGS_LOCALES)
    for (const option of LANGUAGE_OPTIONS) {
      expect(option.label.trim().length).toBeGreaterThan(0)
    }
  })
})

describe('i18n 字典键齐性（每域三语同键闭集）', () => {
  it('settings 域三语键全等且无空文案', () => {
    const base = Object.keys(SETTINGS_COPY['zh-CN']).sort()
    expect(base.length).toBeGreaterThan(0)
    for (const locale of SETTINGS_LOCALES) {
      expect(Object.keys(SETTINGS_COPY[locale]).sort()).toEqual(base)
      expect(Object.values(SETTINGS_COPY[locale]).every((text) => text.trim().length > 0)).toBe(
        true
      )
    }
  })

  it('errors 域三语键全等且无空文案', () => {
    const base = Object.keys(ERRORS_COPY['zh-CN']).sort()
    expect(base.length).toBeGreaterThan(0)
    for (const locale of SETTINGS_LOCALES) {
      expect(Object.keys(ERRORS_COPY[locale]).sort()).toEqual(base)
      expect(Object.values(ERRORS_COPY[locale]).every((text) => text.trim().length > 0)).toBe(true)
    }
  })
})

describe('errors 域按 locale 出文案（settings-contract 接线）', () => {
  const capabilities = {
    fields: {
      internalStorageMiB: { min: 0, max: null, step: null, disabledReason: null },
      cpuCores: { min: 1, max: null, step: null, disabledReason: null },
      ramMiB: { min: 1, max: null, step: null, disabledReason: null },
      vmHeapMiB: { min: 1, max: null, step: null, disabledReason: null }
    },
    quickBootAvailable: false,
    quickBootDisabledReason: null,
    webcamDeviceIds: [],
    skinIds: []
  } as unknown as WizardCapabilities

  const badStorageInput = {
    skinRef: null,
    frontCamera: { mode: 'emulated', deviceId: null },
    rearCamera: { mode: 'emulated', deviceId: null },
    networkSpeed: null,
    networkLatency: null,
    orientation: null,
    bootMode: 'cold',
    internalStorageMiB: 1.5,
    cpuCores: 4,
    graphics: 'auto',
    ramMiB: 2048,
    vmHeapMiB: 512,
    preferredAbi: 'optimal'
  } as const

  it('缺省 zh-CN：校验错误为中文', () => {
    const result = normalizeAdvancedSettings(badStorageInput, capabilities)
    expect(result.errors.internalStorageMiB).toBe('内部存储（MiB）需要整数')
  })

  it('传 en-US：同一输入产出英文错误', () => {
    const result = normalizeAdvancedSettings(badStorageInput, capabilities, 'en-US')
    expect(result.errors.internalStorageMiB).toBe('Internal storage (MiB) must be an integer')
  })
})

describe('format 模板插值', () => {
  it('{name} 占位替换为字符串或数字参数', () => {
    expect(format('启动 {name} 失败', { name: 'Pixel_2' })).toBe('启动 Pixel_2 失败')
    expect(format('{count} 台设备', { count: 3 })).toBe('3 台设备')
    expect(format('{a}/{b}', { a: 1, b: 'x' })).toBe('1/x')
  })

  it('缺参原样保留（含花括号），无参模板原样返回', () => {
    expect(format('启动 {name} 失败', {})).toBe('启动 {name} 失败')
    expect(format('启动 {name} 失败', { other: 1 })).toBe('启动 {name} 失败')
    expect(format('启动 {name} 失败')).toBe('启动 {name} 失败')
  })

  it('非占位花括号语法不误伤', () => {
    expect(format('{} {1} {a b} {name', { name: 1 })).toBe('{} {1} {a b} {name')
    expect(format('{name}', { name: 1 })).toBe('1')
  })
})
