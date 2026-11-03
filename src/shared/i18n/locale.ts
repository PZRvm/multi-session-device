/** 界面语言闭集：一期支持简体中文、繁体中文、英文（PRD §1 第 8 条） */
export type SettingsLocale = 'zh-CN' | 'zh-TW' | 'en-US'

export const SETTINGS_LOCALES: SettingsLocale[] = ['zh-CN', 'zh-TW', 'en-US']

export const isSettingsLocale = (value: unknown): value is SettingsLocale =>
  typeof value === 'string' && (SETTINGS_LOCALES as string[]).includes(value)

/** 全应用缺省语言：locale.json 缺失、损坏或字段非法时的起步值 */
export const DEFAULT_LOCALE: SettingsLocale = 'zh-CN'
