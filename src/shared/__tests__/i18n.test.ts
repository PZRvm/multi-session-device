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
import { RECORDING_COPY } from '@shared/i18n/recording'
import { SCREENSHOT_EDITOR_COPY } from '@shared/i18n/screenshotEditor'
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

  it('recording 域三语键全等且无空文案', () => {
    const base = Object.keys(RECORDING_COPY['zh-CN']).sort()
    expect(base.length).toBeGreaterThan(0)
    for (const locale of SETTINGS_LOCALES) {
      expect(Object.keys(RECORDING_COPY[locale]).sort()).toEqual(base)
      expect(Object.values(RECORDING_COPY[locale]).every((text) => text.trim().length > 0)).toBe(
        true
      )
    }
  })

  it('recording 域占位符三语一致', () => {
    const tokens = (text: string): string =>
      [...text.matchAll(/\{(\w+)\}/g)]
        .map((match) => match[1])
        .sort()
        .join(',')
    const base = RECORDING_COPY['zh-CN']
    for (const locale of SETTINGS_LOCALES)
      for (const key of Object.keys(base))
        expect(tokens(RECORDING_COPY[locale][key as keyof typeof base])).toBe(tokens(base[key]))
  })

  it('screenshotEditor 域三语键全等（含嵌套 tools/colors 组）且无空文案', () => {
    const base = SCREENSHOT_EDITOR_COPY['zh-CN']
    expect(Object.keys(base).sort()).toEqual([
      'colors',
      'copied',
      'copy',
      'cropCancel',
      'cropConfirm',
      'download',
      'failed',
      'fontLarge',
      'fontMedium',
      'fontSize',
      'fontSmall',
      'loading',
      'mosaicBrush',
      'mosaicRect',
      'paletteAria',
      'redo',
      'saved',
      'slotSwitched',
      'strokeMedium',
      'strokeThick',
      'strokeThin',
      'toolbarAria',
      'tools',
      'undo',
      'weightAria'
    ])
    for (const locale of SETTINGS_LOCALES) {
      expect(Object.keys(SCREENSHOT_EDITOR_COPY[locale]).sort()).toEqual(Object.keys(base).sort())
      expect(Object.keys(SCREENSHOT_EDITOR_COPY[locale].tools).sort()).toEqual(
        Object.keys(base.tools).sort()
      )
      expect(Object.keys(SCREENSHOT_EDITOR_COPY[locale].colors).sort()).toEqual(
        Object.keys(base.colors).sort()
      )
      for (const value of Object.values(SCREENSHOT_EDITOR_COPY[locale]))
        if (typeof value === 'string') expect(value.trim().length).toBeGreaterThan(0)
      for (const group of [SCREENSHOT_EDITOR_COPY[locale].tools, SCREENSHOT_EDITOR_COPY[locale].colors])
        for (const value of Object.values(group)) expect(value.trim().length).toBeGreaterThan(0)
    }
  })

  it('screenshotEditor 域占位符三语一致', () => {
    const tokens = (text: string): string =>
      [...text.matchAll(/\{(\w+)\}/g)]
        .map((match) => match[1])
        .sort()
        .join(',')
    const base = SCREENSHOT_EDITOR_COPY['zh-CN']
    for (const locale of SETTINGS_LOCALES)
      for (const key of Object.keys(base)) {
        const value = base[key as keyof typeof base]
        const other = SCREENSHOT_EDITOR_COPY[locale][key as keyof typeof base]
        if (typeof value === 'string' && typeof other === 'string')
          expect(tokens(other)).toBe(tokens(value))
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
