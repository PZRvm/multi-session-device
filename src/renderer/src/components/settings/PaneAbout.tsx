import appIcon from '../../../../../resources/icon.png'
import windowsIcon from '../../../../../resources/icon-windows.png'
import SettingsParts, { type SettingsPaneProps } from './SettingsParts'
import { useAboutInfo } from './useAboutInfo'

const PaneAbout = ({
  model,
  copy,
  platform
}: SettingsPaneProps & { platform: string }): React.JSX.Element => {
  const { info, openDataDirectory } = useAboutInfo()
  return (
    <SettingsParts title={copy.about} lead={copy.aboutLead}>
      <div className="identity">
        <img src={platform === 'win32' ? windowsIcon : appIcon} width={64} height={64} alt="" />
        <div>
          <h2>{model.about.appName}</h2>
          <p className="description">{info?.appVersion ?? copy.versionUnavailable}</p>
        </div>
      </div>
      <h2>{copy.runtime}</h2>
      <dl>
        <div className="runtime">
          <dt>Electron</dt>
          <dd>{info?.electronVersion ?? copy.unavailable}</dd>
        </div>
        <div className="runtime">
          <dt>Chromium</dt>
          <dd>{info?.chromiumVersion ?? copy.unavailable}</dd>
        </div>
      </dl>
      <h2>{copy.dataDirectory}</h2>
      <div className="directory-line">
        <span className="path">{info?.dataDirectory ?? copy.directoryUnavailable}</span>
        <button type="button" disabled={info === null} onClick={openDataDirectory}>
          {copy.openDirectory}
        </button>
      </div>
    </SettingsParts>
  )
}
export default PaneAbout
