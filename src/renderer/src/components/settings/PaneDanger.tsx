import SettingsParts, { type SettingsPaneProps } from './SettingsParts'

const PaneDanger = ({ copy }: SettingsPaneProps): React.JSX.Element => (
  <SettingsParts title={copy.danger} lead={copy.dangerLead}>
    <h2 className="danger-heading">{copy.deleteAll}</h2>
    <p>{copy.deleteHint}</p>
    <p className="danger-copy">{copy.consequence}</p>
    <p className="description">{copy.confirmation}</p>
    <button className="danger-button" type="button" disabled>
      {copy.deleteButton}
    </button>
    <p className="hint">{copy.dangerScopeNote}</p>
  </SettingsParts>
)
export default PaneDanger
