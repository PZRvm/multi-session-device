import { css } from 'styled-components'

/** 工具条图标钮样式的唯一来源（DeviceToolbar 与 RecordingControls 共用；
 * 独立文件避免两个组件互相 import 成环） */
export const toolButtonCss = css`
  .tool-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    padding: 0;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--board-ink);
    cursor: pointer;
    transition: background-color 0.12s;
  }

  .tool-btn:hover:not(:disabled) {
    background: var(--board-hover-veil);
  }

  .tool-btn:disabled {
    opacity: 0.35;
    cursor: default;
  }

  .tool-btn:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
`
