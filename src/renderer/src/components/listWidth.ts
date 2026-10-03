/** 左栏宽度边界与收敛——从 ResizeHandle 拆出（react-refresh：组件文件只导出组件） */
export const LIST_MIN_WIDTH = 220
export const LIST_MAX_WIDTH = 420

export const clampListWidth = (width: number): number =>
  Math.min(LIST_MAX_WIDTH, Math.max(LIST_MIN_WIDTH, width))
