import appIcon from '../../../../../resources/icon.png'
import SettingsParts, { type SettingsPaneProps } from './SettingsParts'

const PaneAbout = ({ model, copy }: SettingsPaneProps): React.JSX.Element => (
  <SettingsParts title={copy.about} lead={copy.aboutLead}>
    <div className="identity">
      <img src={appIcon} width={64} height={64} alt="" />
      <div>
        <h2>{model.about.appName}</h2>
        <p className="description">{model.about.appVersion ?? copy.versionUnavailable}</p>
      </div>
    </div>
    <h2>{copy.runtime}</h2>
    <dl>
      <div className="runtime">
        <dt>Electron</dt>
        <dd>{copy.unavailable}</dd>
      </div>
      <div className="runtime">
        <dt>Chromium</dt>
        <dd>{copy.unavailable}</dd>
      </div>
    </dl>
    <h2>{copy.dataDirectory}</h2>
    <div className="directory-line">
      <span className="path">{model.about.dataDirectory ?? copy.directoryUnavailable}</span>
      <button type="button" disabled>
        {copy.openDirectory}
      </button>
    </div>
  </SettingsParts>
)
export default PaneAbout
