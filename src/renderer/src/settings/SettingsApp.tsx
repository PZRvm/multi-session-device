import SettingsWindow from '../components/SettingsWindow'
import { SETTINGS_PREVIEW } from '../components/settings/model'
import { useLocaleStore } from '../stores/localeStore'
import { useThemeStore } from '../stores/themeStore'

const SettingsApp = (): React.JSX.Element => {
  const mode = useThemeStore((state) => state.mode)
  const systemId = useThemeStore((state) => state.systemId)
  const setMode = useThemeStore((state) => state.setMode)
  const setSystemId = useThemeStore((state) => state.setSystemId)
  const locale = useLocaleStore((state) => state.locale)
  const setLocale = useLocaleStore((state) => state.setLocale)
  return (
    <SettingsWindow
      model={{
        ...SETTINGS_PREVIEW,
        appearance: { mode, systemId, onModeChange: setMode, onSystemIdChange: setSystemId },
        locale,
        onLocaleChange: setLocale
      }}
      platform={window.api.platform}
    />
  )
}

export default SettingsApp
