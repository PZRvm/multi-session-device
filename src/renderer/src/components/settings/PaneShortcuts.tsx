import SettingsParts, { type SettingsPaneProps } from './SettingsParts'

const PaneShortcuts = ({ copy }: SettingsPaneProps): React.JSX.Element => (
  <SettingsParts title={copy.shortcuts} lead={copy.shortcutsLead}>
    <table>
      <thead>
        <tr>
          <th scope="col">{copy.action}</th>
          <th scope="col" className="key-column">
            {copy.keys}
          </th>
          <th scope="col">{copy.context}</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>{copy.rename}</td>
          <td>
            <span className="key-group">
              <kbd>F2</kbd>
              <span className="key-or">{copy.or}</span>
              <kbd>Enter</kbd>
            </span>
          </td>
          <td className="description">{copy.selectedRow}</td>
        </tr>
        <tr>
          <td>{copy.confirmRename}</td>
          <td>
            <kbd>Enter</kbd>
          </td>
          <td className="description">{copy.nameInput}</td>
        </tr>
        <tr>
          <td>{copy.cancelRename}</td>
          <td>
            <kbd>Esc</kbd>
          </td>
          <td className="description">{copy.nameInput}</td>
        </tr>
        <tr>
          <td>{copy.closeWizard}</td>
          <td>
            <kbd>Esc</kbd>
          </td>
          <td className="description">{copy.wizardContext}</td>
        </tr>
        <tr>
          <td>{copy.paste}</td>
          <td aria-label="Command + V">
            <span className="key-group">
              <kbd>⌘</kbd>
              <kbd>V</kbd>
            </span>
          </td>
          <td className="description">{copy.deviceCanvas}</td>
        </tr>
      </tbody>
    </table>
  </SettingsParts>
)
export default PaneShortcuts
