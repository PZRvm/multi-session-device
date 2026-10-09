import type { ThemeMode } from '@shared/types'
import type { ThemeSystemId } from '@shared/themeSystems'

export type SettingsPaneId = 'general' | 'emulator' | 'shortcuts' | 'about' | 'danger'
export type SettingsLocale = 'zh-CN' | 'zh-TW' | 'en-US'
export type SdkMode = 'managed' | 'shared-studio' | 'custom'

export interface SettingsViewModel {
  readonly appearance: { readonly mode: ThemeMode; readonly systemId: ThemeSystemId }
  readonly locale: SettingsLocale
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

// 静态展示模型；路径、版本和阈值未接数据源，不伪造运行环境。
export const SETTINGS_PREVIEW: SettingsViewModel = {
  appearance: { mode: 'system', systemId: 'amber' },
  locale: 'zh-CN',
  sdk: { mode: 'managed', path: null, detection: 'not-checked' },
  resources: { maxInstances: 2, memoryThresholdLabel: null },
  about: { appName: '多会话设备', appVersion: null, dataDirectory: null }
}
