import type { CSSProperties } from 'react'
import { Check } from 'lucide-react'
import { LANGUAGE_OPTIONS, type SettingsLocale } from '@shared/i18n'
import { THEME_SYSTEM_IDS, THEME_SYSTEMS } from '@shared/themeSystems'
import AppearanceModePicker from '../AppearanceModePicker'
import SettingsParts, { type SettingsPaneProps } from './SettingsParts'
import RecordingPromptReset from './RecordingPromptReset'

const PaneGeneral = ({ model, copy }: SettingsPaneProps): React.JSX.Element => (
  <SettingsParts title={copy.general} lead={copy.generalLead}>
    <div className="row">
      <div className="row-label">
        <span className="label">{copy.appearance}</span>
        <p className="description">{copy.appearanceHint}</p>
      </div>
      <div className="controls">
        <AppearanceModePicker
          mode={model.appearance.mode}
          onChange={model.appearance.onModeChange}
        />
      </div>
    </div>
    <div className="row">
      <div className="row-label">
        <span className="label">{copy.theme}</span>
        <p className="description">{copy.themeHint}</p>
      </div>
      <div className="swatches controls" role="group" aria-label={copy.theme}>
        {THEME_SYSTEM_IDS.map((id) => (
          <button
            key={id}
            type="button"
            aria-label={copy[id]}
            title={copy[id]}
            aria-pressed={id === model.appearance.systemId}
            style={{ '--swatch': THEME_SYSTEMS[id].swatch } as CSSProperties}
            onClick={() => model.appearance.onSystemIdChange(id)}
          >
            {id === model.appearance.systemId ? <Check size={15} aria-hidden="true" /> : null}
          </button>
        ))}
      </div>
    </div>
    <div className="row">
      <div className="row-label">
        <label className="label" htmlFor="settings-language">
          {copy.language}
        </label>{' '}
        <p className="description">{copy.languageHint}</p>
      </div>
      <div className="controls">
        <select
          id="settings-language"
          value={model.locale}
          onChange={(event) => model.onLocaleChange(event.target.value as SettingsLocale)}
        >
          {LANGUAGE_OPTIONS.map(({ value, label }) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
    </div>
    <RecordingPromptReset locale={model.locale} />
  </SettingsParts>
)
export default PaneGeneral
