import SettingsParts, { type SettingsPaneProps } from './SettingsParts'

const SDK_MODES = ['managed', 'shared-studio', 'custom'] as const
const PaneEmulator = ({ model, copy }: SettingsPaneProps): React.JSX.Element => (
  <SettingsParts title={copy.emulator} lead={copy.emulatorLead}>
    <fieldset disabled>
      <legend>{copy.sdkSource}</legend>
      {SDK_MODES.map((mode) => (
        <label className="sdk-option" key={mode}>
          <input
            type="radio"
            name="sdk-source"
            value={mode}
            checked={model.sdk.mode === mode}
            readOnly
          />
          <span>
            <span className="label">{copy[mode]}</span>
            <span className="description">{copy[`${mode}Hint`]}</span>
          </span>
        </label>
      ))}
    </fieldset>
    <div className="directory">
      <span className="label">{copy.sdkDirectory}</span>
      <div className="directory-line">
        <span className="path">
          {model.sdk.path ??
            (model.sdk.mode === 'managed' ? copy.managedDirectory : copy.notDetected)}
        </span>
        {model.sdk.mode === 'shared-studio' ? (
          <button type="button" disabled>
            {copy.detect}
          </button>
        ) : null}
        {model.sdk.mode === 'custom' ? (
          <button type="button" disabled>
            {copy.chooseDirectory}
          </button>
        ) : null}
      </div>
      {model.sdk.mode === 'custom' && model.sdk.path === null ? (
        <p className="description">{copy.defaultPathHint}</p>
      ) : null}
    </div>
    <p className="hint">{copy.avdHint}</p>
    <h2>{copy.resources}</h2>
    <div className="row">
      <div className="row-label">
        <label className="label" htmlFor="max-instances">
          {copy.maxInstances}
        </label>
        <p className="description">{copy.maxInstancesHint}</p>
      </div>
      <input
        id="max-instances"
        className="number"
        type="number"
        disabled
        value={model.resources.maxInstances}
      />
    </div>
    <div className="row">
      <div className="row-label">
        <label className="label" htmlFor="memory-threshold">
          {copy.memory}
        </label>
        <p className="description">{copy.memoryHint}</p>
      </div>
      <input
        id="memory-threshold"
        className="threshold"
        disabled
        value={model.resources.memoryThresholdLabel ?? ''}
        placeholder={copy.memoryUnset}
      />
    </div>
  </SettingsParts>
)
export default PaneEmulator
