import type { ThemeMode } from '@shared/types'
import type { SettingsLocale } from '@shared/i18n'
import type { ThemeSystemId } from '@shared/themeSystems'

/** 语言闭集单源在 @shared/i18n；此处 re-export 维持设置组件既有 import 路径 */
export type { SettingsLocale }
/** SDK 来源三态沿共享类型（plan 2026-10-11；SDK 版面数据自 useSdkSource 拉真值） */
export type { SdkSourceMode as SdkMode } from '@shared/types'

export interface AppearanceModel {
  readonly mode: ThemeMode
  readonly systemId: ThemeSystemId
  /** 外观三态写入口（批 4 接通）：PaneGeneral 发出，SettingsApp 接 themeStore */
  readonly onModeChange: (mode: ThemeMode) => void
  readonly onSystemIdChange: (systemId: ThemeSystemId) => void
}

export interface SettingsViewModel {
  readonly appearance: AppearanceModel
  readonly locale: SettingsLocale
  /** 语言切换唯一写入口（批 1 接通）：PaneGeneral 语言行发出，SettingsApp 接 localeStore */
  readonly onLocaleChange: (locale: SettingsLocale) => void
  readonly resources: {
    readonly maxInstances: number
    readonly memoryThresholdLabel: string | null
  }
  readonly about: {
    readonly appName: string
    readonly appVersion: string | null
    readonly dataDirectory: string | null
  }
}

export type SettingsPaneId = 'general' | 'emulator' | 'shortcuts' | 'about' | 'danger'

// 静态展示模型：外观与语言已接真实数据源，由 SettingsApp 注入；SDK 来源版面经
// useSdkSource 直连主进程快照（plan 2026-10-11 交互化）；阈值未接数据源，不伪造
export const SETTINGS_PREVIEW: Omit<SettingsViewModel, 'appearance' | 'locale' | 'onLocaleChange'> =
  {
    resources: { maxInstances: 2, memoryThresholdLabel: null },
    about: { appName: '多会话设备', appVersion: null, dataDirectory: null }
  }
