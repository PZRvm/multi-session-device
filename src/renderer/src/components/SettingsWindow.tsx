import { useState } from 'react'
import { AlertTriangle, Command, Info, Monitor, Settings } from 'lucide-react'
import styled from 'styled-components'
import { ERRORS_COPY, SETTINGS_COPY } from '@shared/i18n'
import windowsIcon from '../../../../resources/icon-windows.png'
import type { SettingsPaneId, SettingsViewModel } from './settings/model'
import PaneGeneral from './settings/PaneGeneral'
import PaneEmulator from './settings/PaneEmulator'
import PaneShortcuts from './settings/PaneShortcuts'
import PaneAbout from './settings/PaneAbout'
import PaneDanger from './settings/PaneDanger'

interface SettingsWindowProps {
  model: SettingsViewModel
  platform: string
}
const NAVIGATION = [
  { id: 'general', Icon: Settings },
  { id: 'emulator', Icon: Monitor },
  { id: 'shortcuts', Icon: Command },
  { id: 'about', Icon: Info },
  { id: 'danger', Icon: AlertTriangle }
] as const
const PANES = {
  general: PaneGeneral,
  emulator: PaneEmulator,
  shortcuts: PaneShortcuts,
  about: PaneAbout,
  danger: PaneDanger
}

const SettingsWindow = ({ model, platform }: SettingsWindowProps): React.JSX.Element => {
  const [active, setActive] = useState<SettingsPaneId>('general')
  const copy = SETTINGS_COPY[model.locale]
  const Pane = PANES[active]
  return (
    <Wrapper lang={model.locale} data-windows={platform === 'win32'}>
      {/* macOS 原生三灯和原有拖拽区保留；Linux 使用系统标题栏。 */}
      {platform === 'darwin' || platform === 'win32' ? (
        <div className="drag-region" aria-hidden="true" />
      ) : null}
      <div className="body">
        <nav aria-label={copy.navigation}>
          {platform === 'win32' ? (
            <div className="settings-identity">
              <img src={windowsIcon} width={24} height={24} alt="" />
              <span>{ERRORS_COPY[model.locale].settingsWindowTitle}</span>
            </div>
          ) : null}
          {NAVIGATION.map(({ id, Icon }) => (
            <button
              key={id}
              type="button"
              className={id === 'danger' ? 'danger-nav' : undefined}
              aria-current={active === id ? 'page' : undefined}
              onClick={() => setActive(id)}
            >
              <Icon size={15} aria-hidden="true" />
              <span>{copy[id]}</span>
            </button>
          ))}
        </nav>
        <main key={active} tabIndex={0} aria-labelledby="settings-pane-title">
          <Pane model={model} copy={copy} platform={platform} />
        </main>
      </div>
    </Wrapper>
  )
}

const Wrapper = styled.div`
  height: 100dvh;
  position: relative;
  display: flex;
  flex-direction: column;
  background: var(--board-bg);
  color: var(--board-ink);
  user-select: none;
  ::selection {
    background: var(--accent);
    color: var(--accent-ink);
  }
  .settings-identity {
    flex: none;
    display: flex;
    align-items: center;
    gap: 8px;
    height: 40px;
    margin: 0 -8px 4px;
    padding: 0 14px;
    font-size: 13px;
    font-weight: 600;
  }
  .settings-identity img {
    flex: none;
    object-fit: contain;
  }
  &[data-windows='true'] nav {
    padding-top: 0;
  }
  &[data-windows='true'] .drag-region {
    height: 40px;
    pointer-events: none;
  }
  .drag-region {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 32px;
    -webkit-app-region: drag;
  }
  .body {
    display: flex;
    flex: 1;
    min-height: 0;
  }
  nav {
    flex: 0 0 176px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    /* 顶部让位原生三灯（14×12）：分类首行沉到三灯下方，不与红灯贴脸 */
    padding: 46px 8px 10px;
    border-right: 1px solid var(--board-hairline);
    background: var(--board-bg-raised);
  }
  nav button {
    display: flex;
    align-items: center;
    gap: 9px;
    min-height: 36px;
    padding: 8px 10px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--board-ink);
    text-align: left;
    font: inherit;
    cursor: pointer;
  }
  nav button svg {
    flex: none;
  }
  nav button:hover {
    background: var(--board-hover-veil);
  }
  nav .danger-nav {
    margin-top: auto;
    color: var(--danger);
  }
  nav button[aria-current='page'] {
    background: var(--accent);
    color: var(--accent-ink);
    font-weight: 600;
  }
  button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
  nav button[aria-current='page']:focus-visible {
    outline-color: var(--accent-ink);
    outline-offset: -4px;
  }
  main {
    flex: 1;
    min-width: 0;
    overflow-y: auto;
    scrollbar-color: var(--board-scrollbar-thumb) var(--board-bg);
    scrollbar-width: thin;
  }
  main::-webkit-scrollbar {
    width: 6px;
  }
  main:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
  main::-webkit-scrollbar-track {
    background: var(--board-bg);
  }
  main::-webkit-scrollbar-thumb {
    background: var(--board-scrollbar-thumb);
  }
  main::-webkit-scrollbar-thumb:hover {
    background: var(--board-scrollbar-hover);
  }
`

export default SettingsWindow
