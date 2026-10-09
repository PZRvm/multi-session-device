import type { CSSProperties } from 'react'
import { Check, Monitor, Moon, Sun } from 'lucide-react'
import { THEME_SYSTEM_IDS, THEME_SYSTEMS } from '@shared/themeSystems'
import { LANGUAGE_OPTIONS } from './copy'
import SettingsParts, { type SettingsPaneProps } from './SettingsParts'

const MODES = [
  { mode: 'system', Icon: Monitor },
  { mode: 'light', Icon: Sun },
  { mode: 'dark', Icon: Moon }
] as const
const PaneGeneral = ({ model, copy }: SettingsPaneProps): React.JSX.Element => (
  <SettingsParts title={copy.general} lead={copy.generalLead}>
    <div className="row">
      <div className="row-label">
        <span className="label">{copy.appearance}</span>
        <p className="description">{copy.appearanceHint}</p>
      </div>
      <div className="segments controls" role="group" aria-label={copy.appearance}>
        {MODES.map(({ mode, Icon }) => (
          <button
            key={mode}
            type="button"
            disabled
            aria-label={copy[mode]}
            title={copy[mode]}
            aria-pressed={mode === model.appearance.mode}
          >
            <Icon size={16} aria-hidden="true" />
          </button>
        ))}
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
            disabled
            aria-label={copy[id]}
            title={copy[id]}
            aria-pressed={id === model.appearance.systemId}
            style={{ '--swatch': THEME_SYSTEMS[id].swatch } as CSSProperties}
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
        </label>
        <p className="description">{copy.languageHint}</p>
      </div>
      <div className="controls">
        <select id="settings-language" disabled value={model.locale}>
          {LANGUAGE_OPTIONS.map(({ value, label }) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
    </div>
  </SettingsParts>
)
export default PaneGeneral
