import type { ThemeMode } from '@shared/types'
import type { SettingsLocale } from '@shared/i18n'
import type { ThemeSystemId } from '@shared/themeSystems'

/** 语言闭集单源在 @shared/i18n；此处 re-export 维持设置组件既有 import 路径 */
export type { SettingsLocale }

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
  readonly sdk: {
    readonly mode: SdkMode
    readonly path: string | null
    readonly detection: 'not-checked'
  }
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
export type SdkMode = 'managed' | 'shared-studio' | 'custom'

// 静态展示模型：外观与语言已接真实数据源，由 SettingsApp 注入；SDK/路径/阈值未接
// 数据源，不伪造运行环境
export const SETTINGS_PREVIEW: Omit<SettingsViewModel, 'appearance' | 'locale' | 'onLocaleChange'> =
  {
    sdk: { mode: 'managed', path: null, detection: 'not-checked' },
    resources: { maxInstances: 2, memoryThresholdLabel: null },
    about: { appName: '多会话设备', appVersion: null, dataDirectory: null }
  }
