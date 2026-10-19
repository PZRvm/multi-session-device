/** i18n 单源出口：语言闭集、各域三语字典、插值助手。三进程唯一引用点——
 *  运行期不得在其他位置另建字典（plan 2026-10-10-i18n-and-appearance 批 1） */
export { DEFAULT_LOCALE, isSettingsLocale, SETTINGS_LOCALES, type SettingsLocale } from './locale'
export { format } from './format'
export { LANGUAGE_OPTIONS, SETTINGS_COPY, type SettingsCopy } from './settings'
export { MAIN_COPY, type MainWindowCopy } from './mainWindow'
export { WIZARD_COPY, type WizardCopy } from './wizard'
export { ERRORS_COPY, type ErrorsCopy } from './errors'

export { RECORDING_COPY, type RecordingCopy } from './recording'
