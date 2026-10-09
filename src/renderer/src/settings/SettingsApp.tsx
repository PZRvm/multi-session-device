import SettingsWindow from '../components/SettingsWindow'
import { SETTINGS_PREVIEW } from '../components/settings/model'
import { useThemeStore } from '../stores/themeStore'

const SettingsApp = (): React.JSX.Element => {
  const mode = useThemeStore((state) => state.mode)
  const systemId = useThemeStore((state) => state.systemId)
  return (
    <SettingsWindow
      model={{ ...SETTINGS_PREVIEW, appearance: { mode, systemId } }}
      platform={window.api.platform}
    />
  )
}

export default SettingsApp
