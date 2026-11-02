// 截图编辑器工具条（plan 2026-11-02-screenshot-editor T4，迁自 multi-session-browser
// captureEditor/EditorToolbar.tsx）：六工具位次（微信序：矩形/椭圆/箭头/马赛克/
// 文字/裁剪）+ 档位选择器（粗细三档；**马赛克激活时同一选择器语义切换为块径档**，
// 源 2026-10-14 用户批复假设 8）+ 六色色板 + 文字字号档（仅文字工具激活时显示）
// + 撤销/重做。chrome-* 语系自绘（editorWrapper.ts 的 .chrome-capture-editor-* 段）、
// 图标一律 lucide-react、悬停用原生 title、aria-label 走域字典——禁用弹层。
//
// 图标接缝（与源的唯一段内差异）：源图集 @ant-design/icons 无 Circle 系图标，椭圆
// 钮走 CSS 圆形字形兜底；本项目图标单源 lucide-react 有 Circle——七工具全走图集，
// .chrome-capture-editor-glyph-circle 字形段不迁（editorWrapper 头注同记）。
//
// 窄窗反馈修复（2026-11-02 用户反馈，源同款缺陷）：竖屏截图窗宽可低至 360px，
// 源单行不换行布局溢出堆叠、文字钮（马赛克双模式）压字破版。本仓把七工具钮
// 收进 toolgroup、各设置组（含撤销/重做）连前置分隔线收进 sect——工具条按组
// 原子换行（editorWrapper 的 wrap/sect 段），组内钮与文字不再被压断。

import { ArrowUp, Circle, Grid2x2, Pencil, Redo, Scissors, Square, Type, Undo } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useCopy } from '../../hooks/useCopy'
import { SCREENSHOT_EDITOR_COPY, type ScreenshotEditorCopy } from '@shared/i18n'
import {
  COLOR_PALETTE,
  FONT_SIZE_TIERS,
  type AnnotationColor,
  type EditorToolId
} from './editorConstants'

/** 工具定义（位次拟微信序；labelKey 为域字典 tools 组键名） */
const TOOL_DEFS = [
  { id: 'rectangle', icon: Square, labelKey: 'rectangle' },
  { id: 'ellipse', icon: Circle, labelKey: 'ellipse' },
  { id: 'arrow', icon: ArrowUp, labelKey: 'arrow' },
  { id: 'brush', icon: Pencil, labelKey: 'brush' },
  { id: 'mosaic', icon: Grid2x2, labelKey: 'mosaic' },
  { id: 'text', icon: Type, labelKey: 'text' },
  { id: 'crop', icon: Scissors, labelKey: 'crop' }
] as const satisfies ReadonlyArray<{
  id: EditorToolId
  icon: LucideIcon
  labelKey: keyof ScreenshotEditorCopy['tools']
}>

/** 档位名（细/中/粗）字典键：粗细与块径共用（语义随工具切换，键注释同源） */
const WEIGHT_LABEL_KEYS = [
  'strokeThin',
  'strokeMedium',
  'strokeThick'
] as const satisfies ReadonlyArray<keyof ScreenshotEditorCopy>

/** 色板六色 aria-label 键映射（与 COLOR_PALETTE 同序同源） */
const COLOR_LABEL_KEYS: Record<AnnotationColor, keyof ScreenshotEditorCopy['colors']> = {
  '#fa5151': 'red',
  '#e6a700': 'orange',
  '#07c160': 'green',
  '#10aeff': 'blue',
  '#ffffff': 'white',
  '#3d3d3d': 'black'
}

/** 档位选择器圆点直径（显示像素，随档位递增） */
const WEIGHT_DOT_SIZES = [6, 8, 10] as const

/** 字号档名字典键（与 FONT_SIZE_TIERS 同序：32→小、42→中、54→大——档钮从左到
 *  右由小到大，同粗细档律） */
const FONT_LABEL_KEYS = ['fontSmall', 'fontMedium', 'fontLarge'] as const satisfies ReadonlyArray<
  keyof ScreenshotEditorCopy
>

export interface EditorToolbarProps {
  tool: EditorToolId
  onToolChange: (tool: EditorToolId) => void
  /** 马赛克模式（反馈轮一）：rect 选区框选 / brush 画笔涂抹 */
  mosaicMode: 'rect' | 'brush'
  onMosaicModeChange: (mode: 'rect' | 'brush') => void
  /** 档位索引（0/1/2）：形状/画笔工具消费 STROKE_TIERS、马赛克消费 MOSAIC_PIXEL_TIERS */
  weightIndex: number
  onWeightIndexChange: (index: number) => void
  color: AnnotationColor
  onColorChange: (color: AnnotationColor) => void
  fontSizeIndex: number
  onFontSizeIndexChange: (index: number) => void
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
  /** 裁剪态锁定（反馈轮一）：裁剪激活时其他工具钮禁用（唯三出口确认/取消/Esc；
   *  撤销/重做钮保持可用——裁剪态路由到选区独立栈） */
  cropLocked: boolean
}

function EditorToolbar(props: EditorToolbarProps): React.JSX.Element {
  const copy = useCopy(SCREENSHOT_EDITOR_COPY)
  const {
    tool,
    onToolChange,
    mosaicMode,
    onMosaicModeChange,
    weightIndex,
    onWeightIndexChange,
    color,
    onColorChange,
    fontSizeIndex,
    onFontSizeIndexChange,
    canUndo,
    canRedo,
    onUndo,
    onRedo,
    cropLocked
  } = props

  // 档位选择器语义：形状工具（矩形/椭圆/箭头）/画笔/马赛克显示；文字/裁剪不参与
  const showWeight =
    tool === 'rectangle' ||
    tool === 'ellipse' ||
    tool === 'arrow' ||
    tool === 'brush' ||
    tool === 'mosaic'
  // 色板：可着色工具（矩形/椭圆/箭头/画笔/文字）显示；马赛克/裁剪无着色语义（微信同款）
  const showPalette =
    tool === 'rectangle' ||
    tool === 'ellipse' ||
    tool === 'arrow' ||
    tool === 'brush' ||
    tool === 'text'

  return (
    <div className="chrome-capture-editor-toolbar" role="toolbar" aria-label={copy.toolbarAria}>
      <div className="chrome-capture-editor-toolgroup">
        {TOOL_DEFS.map((def) => {
          const Icon = def.icon
          const label = copy.tools[def.labelKey]
          return (
            <button
              key={def.id}
              type="button"
              className={`chrome-capture-editor-iconbtn${tool === def.id ? ' is-active' : ''}`}
              aria-pressed={tool === def.id}
              aria-label={label}
              title={label}
              disabled={cropLocked && def.id !== 'crop'}
              onClick={() => onToolChange(def.id)}
            >
              <Icon size={16} />
            </button>
          )
        })}
      </div>
      {tool === 'mosaic' && (
        <div className="chrome-capture-editor-sect">
          <span className="chrome-capture-editor-sep" aria-hidden="true" />
          <div
            className="chrome-capture-editor-mosaicmodes"
            role="group"
            aria-label={copy.tools.mosaic}
          >
            {(
              [
                { id: 'brush', labelKey: 'mosaicBrush' },
                { id: 'rect', labelKey: 'mosaicRect' }
              ] as const
            ).map((def) => {
              const label = copy[def.labelKey]
              return (
                <button
                  key={def.id}
                  type="button"
                  className={`chrome-capture-editor-modebtn${mosaicMode === def.id ? ' is-active' : ''}`}
                  aria-pressed={mosaicMode === def.id}
                  aria-label={label}
                  title={label}
                  onClick={() => onMosaicModeChange(def.id)}
                >
                  {label}
                </button>
              )
            })}
          </div>
        </div>
      )}
      {showWeight && (
        <div className="chrome-capture-editor-sect">
          <span className="chrome-capture-editor-sep" aria-hidden="true" />
          <div className="chrome-capture-editor-weight" role="group" aria-label={copy.weightAria}>
            {WEIGHT_LABEL_KEYS.map((key, index) => {
              const label = copy[key]
              return (
                <button
                  key={key}
                  type="button"
                  className={`chrome-capture-editor-iconbtn chrome-capture-editor-weightbtn${
                    weightIndex === index ? ' is-active' : ''
                  }`}
                  aria-pressed={weightIndex === index}
                  aria-label={label}
                  title={label}
                  onClick={() => onWeightIndexChange(index)}
                >
                  <i
                    className="chrome-capture-editor-weightdot"
                    style={{ width: WEIGHT_DOT_SIZES[index], height: WEIGHT_DOT_SIZES[index] }}
                  />
                </button>
              )
            })}
          </div>
        </div>
      )}
      {showPalette && (
        <div className="chrome-capture-editor-sect">
          <span className="chrome-capture-editor-sep" aria-hidden="true" />
          <div className="chrome-capture-editor-palette" role="group" aria-label={copy.paletteAria}>
            {COLOR_PALETTE.map((value) => {
              const label = copy.colors[COLOR_LABEL_KEYS[value]]
              return (
                <button
                  key={value}
                  type="button"
                  className={`chrome-capture-editor-colorbtn${color === value ? ' is-active' : ''}`}
                  style={{ background: value }}
                  aria-pressed={color === value}
                  aria-label={label}
                  title={label}
                  onClick={() => onColorChange(value)}
                />
              )
            })}
          </div>
        </div>
      )}
      {tool === 'text' && (
        <div className="chrome-capture-editor-sect">
          <span className="chrome-capture-editor-sep" aria-hidden="true" />
          <div className="chrome-capture-editor-fontsizes" role="group" aria-label={copy.fontSize}>
            {FONT_SIZE_TIERS.map((size, index) => {
              // 档钮显示「小/中/大」（数值 32/42/54 仅内部使用不外显）；键位显式元组
              const nameKey = FONT_LABEL_KEYS[index]
              const name = copy[nameKey]
              const label = `${copy.fontSize} ${name}`
              return (
                <button
                  key={size}
                  type="button"
                  className={`chrome-capture-editor-fontbtn${fontSizeIndex === index ? ' is-active' : ''}`}
                  aria-pressed={fontSizeIndex === index}
                  aria-label={label}
                  title={label}
                  onClick={() => onFontSizeIndexChange(index)}
                >
                  {name}
                </button>
              )
            })}
          </div>
        </div>
      )}
      <div className="chrome-capture-editor-sect">
        <span className="chrome-capture-editor-sep" aria-hidden="true" />
        <button
          type="button"
          className="chrome-capture-editor-iconbtn"
          disabled={!canUndo}
          aria-label={copy.undo}
          title={copy.undo}
          onClick={onUndo}
        >
          <Undo size={16} />
        </button>
        <button
          type="button"
          className="chrome-capture-editor-iconbtn"
          disabled={!canRedo}
          aria-label={copy.redo}
          title={copy.redo}
          onClick={onRedo}
        >
          <Redo size={16} />
        </button>
      </div>
    </div>
  )
}

export { EditorToolbar }
