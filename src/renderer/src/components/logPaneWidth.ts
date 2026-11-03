/** 右栏日志 dock 宽度边界与收敛——从 App 拆出（镜像 listWidth；react-refresh：组件文件只导出组件） */
export const LOG_PANE_MIN_WIDTH = 240
export const LOG_PANE_MAX_WIDTH = 560

export const clampLogPaneWidth = (width: number): number =>
  Math.min(LOG_PANE_MAX_WIDTH, Math.max(LOG_PANE_MIN_WIDTH, width))
