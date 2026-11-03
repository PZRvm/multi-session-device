import type { SettingsLocale } from './locale'

/** 截图编辑器域文案（迁自 multi-session-browser 三语 browser.ts 字典的
 *  captureEditor 段，plan book/plans/2026-11-02-screenshot-editor.md §5：
 *  迁移既有三语文字，键结构随组件取词需要组织） */
const zhCN = {
  /** 取图期间空态文案 */
  loading: '正在载入截图…',
  /** 工具 aria-label 与 title（同一词） */
  tools: {
    rectangle: '矩形',
    ellipse: '椭圆',
    arrow: '箭头',
    brush: '画笔',
    mosaic: '马赛克',
    text: '文字',
    crop: '裁剪'
  },
  /** 马赛克双模式切换钮 aria-label（画笔涂抹/选区框选） */
  mosaicBrush: '画笔模式',
  mosaicRect: '选区模式',
  /** 粗细三档名（马赛克激活时语义为块径档，aria 用） */
  strokeThin: '细',
  strokeMedium: '中',
  strokeThick: '粗',
  /** 文本字号档选择器 aria-label */
  fontSize: '字号',
  fontLarge: '大',
  fontMedium: '中',
  fontSmall: '小',
  /** 撤销/重做 */
  undo: '撤销',
  redo: '重做',
  /** 窗内产出钮 aria-label 与 title（同一词） */
  copy: '复制到剪贴板',
  download: '下载',
  /** 复制成功窗内 inline 反馈 */
  copied: '已复制',
  /** 下载成功窗内 inline 反馈（{file} 为落盘文件名） */
  saved: '已保存：{file}',
  /** 兜底失败文案（主进程已本地化的具体错误优先） */
  failed: '编辑失败，请重试',
  /** 产出续编弱校验命中提示：续编取到同设备并发新截图而非本窗成品时告知，不静默跳变 */
  slotSwitched: '已切换到最新截图',
  /** 裁剪选区确认/取消钮 */
  cropConfirm: '确认',
  cropCancel: '取消',
  /** 工具条容器（role=toolbar）aria-label */
  toolbarAria: '截图工具',
  /** 档位选择组（role=group）aria-label：粗细/块径语义随工具切换 */
  weightAria: '粗细',
  /** 色板组（role=group）aria-label */
  paletteAria: '颜色',
  /** 色板六色 aria-label（微信系六色，与 editorConstants COLOR_PALETTE 同序） */
  colors: {
    red: '红色',
    orange: '橙黄色',
    green: '绿色',
    blue: '蓝色',
    white: '白色',
    black: '黑色'
  }
}

export type ScreenshotEditorCopy = typeof zhCN

const zhTW: ScreenshotEditorCopy = {
  loading: '正在載入截圖…',
  tools: {
    rectangle: '矩形',
    ellipse: '橢圓',
    arrow: '箭頭',
    brush: '畫筆',
    mosaic: '馬賽克',
    text: '文字',
    crop: '裁剪'
  },
  mosaicBrush: '畫筆模式',
  mosaicRect: '選區模式',
  strokeThin: '細',
  strokeMedium: '中',
  strokeThick: '粗',
  fontSize: '字號',
  fontLarge: '大',
  fontMedium: '中',
  fontSmall: '小',
  undo: '撤銷',
  redo: '重做',
  copy: '複製到剪貼簿',
  download: '下載',
  copied: '已複製',
  saved: '已儲存：{file}',
  failed: '編輯失敗，請重試',
  slotSwitched: '已切換至最新截圖',
  cropConfirm: '確認',
  cropCancel: '取消',
  toolbarAria: '截圖工具',
  weightAria: '粗細',
  paletteAria: '顏色',
  colors: {
    red: '紅色',
    orange: '橙黃色',
    green: '綠色',
    blue: '藍色',
    white: '白色',
    black: '黑色'
  }
}

const enUS: ScreenshotEditorCopy = {
  loading: 'Loading screenshot…',
  tools: {
    rectangle: 'Rectangle',
    ellipse: 'Ellipse',
    arrow: 'Arrow',
    brush: 'Brush',
    mosaic: 'Mosaic',
    text: 'Text',
    crop: 'Crop'
  },
  mosaicBrush: 'Brush mode',
  mosaicRect: 'Region mode',
  strokeThin: 'Thin',
  strokeMedium: 'Medium',
  strokeThick: 'Thick',
  fontSize: 'Font size',
  fontLarge: 'Large',
  fontMedium: 'Medium',
  fontSmall: 'Small',
  undo: 'Undo',
  redo: 'Redo',
  copy: 'Copy to clipboard',
  download: 'Download',
  copied: 'Copied',
  saved: 'Saved: {file}',
  failed: 'Editing failed, please retry',
  slotSwitched: 'Switched to the latest screenshot',
  cropConfirm: 'Confirm',
  cropCancel: 'Cancel',
  toolbarAria: 'Screenshot tools',
  weightAria: 'Size',
  paletteAria: 'Color',
  colors: {
    red: 'Red',
    orange: 'Orange',
    green: 'Green',
    blue: 'Blue',
    white: 'White',
    black: 'Black'
  }
}

export const SCREENSHOT_EDITOR_COPY: Record<SettingsLocale, ScreenshotEditorCopy> = {
  'zh-CN': zhCN,
  'zh-TW': zhTW,
  'en-US': enUS
}
