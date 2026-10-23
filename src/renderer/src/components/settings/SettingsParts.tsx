import type { ReactNode } from 'react'
import styled from 'styled-components'
import type { SettingsCopy } from '@shared/i18n'
import type { SettingsViewModel } from './model'

export interface SettingsPaneProps {
  model: SettingsViewModel
  copy: SettingsCopy
}
interface SettingsPartsProps {
  title: string
  lead: string
  children: ReactNode
}

const SettingsParts = ({ title, lead, children }: SettingsPartsProps): React.JSX.Element => (
  <Wrapper>
    <h1 id="settings-pane-title">{title}</h1>
    <p className="lead">{lead}</p>
    {children}
  </Wrapper>
)

const Wrapper = styled.section`
  padding: 38px 28px 28px;
  h1 {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
  }
  h2 {
    margin: 22px 0 8px;
    font-size: 12px;
    font-weight: 600;
    color: var(--board-ink-dim);
  }
  p {
    margin: 0;
  }
  .lead {
    margin: 4px 0 18px;
    color: var(--board-ink-dim);
    font-size: 12px;
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    min-height: 66px;
    padding: 12px 0;
    border-bottom: 1px solid var(--board-hairline);
  }
  .row:last-child {
    border-bottom: none;
  }
  .row-label {
    flex: 1;
    min-width: 0;
  }
  .label {
    display: block;
    font-weight: 500;
  }
  .description {
    margin-top: 3px;
    font-size: 12px;
    color: var(--board-ink-dim);
    overflow-wrap: anywhere;
  }
  .controls {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    flex: none;
  }
  button,
  input,
  select {
    font: inherit;
    color: var(--board-ink);
  }
  button {
    min-height: 32px;
    padding: 4px 12px;
    border: 1px solid var(--board-control-line);
    border-radius: 4px;
    background: transparent;
  }
  button:disabled {
    cursor: default;
  }
  select,
  input:not([type='radio']) {
    height: 28px;
    min-width: 0;
    padding: 2px 8px;
    border: 1px solid var(--board-control-line);
    border-radius: 4px;
    background: var(--board-bg-raised);
  }
  input:disabled,
  select:disabled {
    opacity: 1;
    -webkit-text-fill-color: var(--board-ink);
  }
  input::placeholder {
    color: var(--board-ink-dim);
    -webkit-text-fill-color: var(--board-ink-dim);
  }
  input.number {
    width: 64px;
    font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  }
  select {
    width: 180px;
    max-width: 100%;
  }
  input.threshold {
    width: 144px;
  }
  .swatches {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
  }
  .swatches button {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    min-height: 28px;
    padding: 0;
    background: var(--swatch);
    color: var(--accent-ink);
  }
  .swatches button[aria-pressed='true'] {
    outline: 2px solid var(--board-ink);
    outline-offset: 2px;
  }
  fieldset {
    margin: 0;
    padding: 0;
    border: none;
    min-width: 0;
  }
  legend {
    margin-bottom: 10px;
    padding: 0;
    font-weight: 500;
  }
  .sdk-option {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin-bottom: 12px;
  }
  .sdk-option .description {
    display: block;
  }
  /* 来源板块与下方内容的发丝线隔离（2026-10-12） */
  .block-divider {
    border-top: 1px solid var(--board-hairline);
    padding-top: 12px;
  }

  /* 选中来源的行内路径与入口（原 SDK 目录板块并入，2026-10-12） */
  .path-line {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 4px;
  }
  /* 关于页数据目录行：路径占满剩余宽，「打开目录」贴行右缘 */
  .directory-line {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .directory-line .path {
    flex: 1;
    min-width: 0;
  }
  input[type='radio'] {
    flex: none;
    margin: 4px 0 0;
    accent-color: var(--board-tile-ink);
  }
  .path {
    overflow-wrap: anywhere;
    font-family: ui-monospace, 'SF Mono', Menlo, monospace;
    font-size: 12px;
    color: var(--board-ink-dim);
  }
  .hint {
    margin-top: 10px;
    color: var(--board-ink-dim);
    font-size: 12px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
    text-align: left;
  }
  th {
    font-size: 12px;
    color: var(--board-ink-dim);
    font-weight: 500;
  }
  th,
  td {
    padding: 12px 6px;
    border-bottom: 1px solid var(--board-hairline);
    overflow-wrap: anywhere;
    vertical-align: top;
  }
  th:first-child,
  td:first-child {
    padding-left: 0;
  }
  th:last-child,
  td:last-child {
    padding-right: 0;
  }
  .key-column {
    width: 116px;
  }
  .key-group {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 4px;
  }
  kbd {
    min-width: 24px;
    padding: 1px 5px;
    border: 1px solid var(--board-tile-line);
    border-bottom-width: 2px;
    border-radius: 3px;
    background: var(--board-tile);
    color: var(--board-ink);
    font-family: ui-monospace, 'SF Mono', Menlo, monospace;
    font-size: 12px;
    text-align: center;
  }
  .key-or {
    font-size: 12px;
    color: var(--board-ink-dim);
  }
  .identity {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    text-align: center;
    padding: 10px 0 24px;
    border-bottom: 1px solid var(--board-hairline);
  }
  .identity img {
    flex: none;
    width: 64px;
    height: 64px;
  }
  .identity h2 {
    margin: 0;
    font-size: 15px;
    color: var(--board-ink);
  }
  .runtime {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    padding: 8px 0;
  }
  .runtime dd {
    margin: 0;
    color: var(--board-ink-dim);
    font-size: 12px;
  }
  dl {
    margin: 0;
  }
  .danger-heading {
    margin: 8px 0 6px;
    color: var(--danger);
    font-size: 13px;
    font-weight: 600;
  }
  .danger-copy {
    margin: 16px 0 12px;
    font-size: 12px;
    color: var(--board-ink-dim);
  }
  .danger-button {
    margin-top: 18px;
    border-color: var(--danger);
    color: var(--danger);
  }
  /* SDK 来源交互块（plan 2026-10-11）：确认卡 / 二选一卡 / 进度 / 崩溃恢复横幅 / 保留根 */
  .action-card {
    margin: 14px 0;
    padding: 12px 14px;
    border: 1px solid var(--board-control-line);
    border-radius: 6px;
  }
  .action-card.warn {
    border-color: var(--danger);
  }
  .card-title {
    margin: 0 0 8px;
    font-weight: 600;
  }
  .card-line {
    margin: 4px 0;
    font-size: 12px;
    color: var(--board-ink-dim);
    overflow-wrap: anywhere;
  }
  .card-actions {
    display: flex;
    justify-content: flex-end;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 10px;
  }
  .inline-action {
    min-height: 26px;
    margin-left: 8px;
    padding: 2px 10px;
    font-size: 12px;
  }
  .progress-track {
    height: 6px;
    margin: 8px 0;
    border: 1px solid var(--board-control-line);
    border-radius: 3px;
    background: var(--board-bg-raised);
    overflow: hidden;
  }
  .progress-fill {
    height: 100%;
    /* --swatch 是通用页色样按钮的行内局部变量（PaneGeneral 逐个注入），此处
       作用域外不可达会解析为空——填充用全局主题强调色（fix 2026-10-12） */
    background: var(--accent);
  }
  .error-line {
    margin: 10px 0 0;
    color: var(--danger);
    font-size: 12px;
    overflow-wrap: anywhere;
  }
  @media (max-width: 700px) {
    .row {
      align-items: flex-start;
      flex-direction: column;
      gap: 10px;
    }
    .controls {
      max-width: 100%;
    }
  }
`

export default SettingsParts
