import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EditorToolbar, type EditorToolbarProps } from '../EditorToolbar'
import { SCREENSHOT_EDITOR_COPY } from '@shared/i18n'

const copy = SCREENSHOT_EDITOR_COPY['zh-CN']

afterEach(cleanup)

const props = (over: Partial<EditorToolbarProps> = {}): EditorToolbarProps => ({
  tool: 'rectangle',
  onToolChange: vi.fn(),
  mosaicMode: 'rect',
  onMosaicModeChange: vi.fn(),
  weightIndex: 1,
  onWeightIndexChange: vi.fn(),
  color: '#fa5151',
  onColorChange: vi.fn(),
  fontSizeIndex: 1,
  onFontSizeIndexChange: vi.fn(),
  canUndo: false,
  canRedo: false,
  onUndo: vi.fn(),
  onRedo: vi.fn(),
  cropLocked: false,
  ...over
})

describe('EditorToolbar', () => {
  it('七工具按微信序排列（矩形/椭圆/箭头/画笔/马赛克/文字/裁剪），当前工具按下态', () => {
    const onToolChange = vi.fn()
    const { container } = render(<EditorToolbar {...props({ onToolChange })} />)
    const bar = container.querySelector('.chrome-capture-editor-toolbar') as HTMLElement
    // 工具钮为工具条最前的直接子钮（其后才是档位/色板等条件组与撤销/重做）
    const toolButtons = Array.from(bar.querySelectorAll(':scope > button')).slice(0, 7)
    expect(toolButtons.map((b) => b.getAttribute('aria-label'))).toEqual([
      copy.tools.rectangle,
      copy.tools.ellipse,
      copy.tools.arrow,
      copy.tools.brush,
      copy.tools.mosaic,
      copy.tools.text,
      copy.tools.crop
    ])
    // 默认矩形工具：aria-pressed + 点击回调
    expect(toolButtons[0].getAttribute('aria-pressed')).toBe('true')
    expect(toolButtons[1].getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(toolButtons[1])
    expect(onToolChange).toHaveBeenCalledWith('ellipse')
  })

  it('马赛克工具：双模式切换钮（画笔/选区）回调；档位选择器呈现（块径语义）', () => {
    const onMosaicModeChange = vi.fn()
    const onWeightIndexChange = vi.fn()
    render(
      <EditorToolbar {...props({ tool: 'mosaic', onMosaicModeChange, onWeightIndexChange })} />
    )
    fireEvent.click(screen.getByRole('button', { name: copy.mosaicBrush }))
    expect(onMosaicModeChange).toHaveBeenCalledWith('brush')
    fireEvent.click(screen.getByRole('button', { name: copy.mosaicRect }))
    expect(onMosaicModeChange).toHaveBeenCalledWith('rect')
    // 同一选择器：马赛克激活时档位组在（语义切换为块径，由父层消费 MOSAIC_PIXEL_TIERS）
    const weight = screen.getByRole('group', { name: copy.weightAria })
    const tiers = Array.from(weight.querySelectorAll('button'))
    expect(tiers.map((b) => b.getAttribute('aria-label'))).toEqual([
      copy.strokeThin,
      copy.strokeMedium,
      copy.strokeThick
    ])
    fireEvent.click(tiers[1])
    expect(onWeightIndexChange).toHaveBeenCalledWith(1)
  })

  it('档位选择器显隐：形状/画笔在，文字/裁剪不在', () => {
    render(<EditorToolbar {...props({ tool: 'text' })} />)
    expect(screen.queryByRole('group', { name: copy.weightAria })).toBeNull()
    cleanup()
    render(<EditorToolbar {...props({ tool: 'crop' })} />)
    expect(screen.queryByRole('group', { name: copy.weightAria })).toBeNull()
    cleanup()
    render(<EditorToolbar {...props({ tool: 'brush' })} />)
    expect(screen.getByRole('group', { name: copy.weightAria })).toBeTruthy()
  })

  it('色板显隐与六色回调：着色工具在（含文字），马赛克/裁剪不在', () => {
    const onColorChange = vi.fn()
    render(<EditorToolbar {...props({ tool: 'text', onColorChange })} />)
    const palette = screen.getByRole('group', { name: copy.paletteAria })
    const swatches = Array.from(palette.querySelectorAll('button'))
    expect(swatches.map((b) => b.getAttribute('aria-label'))).toEqual([
      copy.colors.red,
      copy.colors.orange,
      copy.colors.green,
      copy.colors.blue,
      copy.colors.white,
      copy.colors.black
    ])
    fireEvent.click(screen.getByRole('button', { name: copy.colors.blue }))
    expect(onColorChange).toHaveBeenCalledWith('#10aeff')
    cleanup()
    render(<EditorToolbar {...props({ tool: 'mosaic' })} />)
    expect(screen.queryByRole('group', { name: copy.paletteAria })).toBeNull()
    cleanup()
    render(<EditorToolbar {...props({ tool: 'crop' })} />)
    expect(screen.queryByRole('group', { name: copy.paletteAria })).toBeNull()
  })

  it('字号档仅文字工具呈现：小/中/大三档与回调', () => {
    const onFontSizeIndexChange = vi.fn()
    render(<EditorToolbar {...props({ tool: 'text', onFontSizeIndexChange })} />)
    const group = screen.getByRole('group', { name: copy.fontSize })
    const tiers = Array.from(group.querySelectorAll('button'))
    expect(tiers.map((b) => b.textContent)).toEqual([copy.fontSmall, copy.fontMedium, copy.fontLarge])
    expect(tiers.map((b) => b.getAttribute('aria-label'))).toEqual([
      `${copy.fontSize} ${copy.fontSmall}`,
      `${copy.fontSize} ${copy.fontMedium}`,
      `${copy.fontSize} ${copy.fontLarge}`
    ])
    fireEvent.click(tiers[2])
    expect(onFontSizeIndexChange).toHaveBeenCalledWith(2)
    cleanup()
    render(<EditorToolbar {...props({ tool: 'rectangle' })} />)
    expect(screen.queryByRole('group', { name: copy.fontSize })).toBeNull()
  })

  it('裁剪锁定：其余工具钮禁用、裁剪钮可用，撤销/重做不受锁影响', () => {
    const onUndo = vi.fn()
    const onRedo = vi.fn()
    render(
      <EditorToolbar
        {...props({ tool: 'crop', cropLocked: true, canUndo: true, canRedo: true, onUndo, onRedo })}
      />
    )
    for (const label of [
      copy.tools.rectangle,
      copy.tools.ellipse,
      copy.tools.arrow,
      copy.tools.brush,
      copy.tools.mosaic,
      copy.tools.text
    ]) {
      expect((screen.getByRole('button', { name: label }) as HTMLButtonElement).disabled).toBe(true)
    }
    expect(
      (screen.getByRole('button', { name: copy.tools.crop }) as HTMLButtonElement).disabled
    ).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: copy.undo }))
    expect(onUndo).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: copy.redo }))
    expect(onRedo).toHaveBeenCalledTimes(1)
  })

  it('撤销/重做禁用态：空栈禁用不响应，可回时点击透传', () => {
    render(<EditorToolbar {...props({ canUndo: false, canRedo: false })} />)
    expect((screen.getByRole('button', { name: copy.undo }) as HTMLButtonElement).disabled).toBe(
      true
    )
    expect((screen.getByRole('button', { name: copy.redo }) as HTMLButtonElement).disabled).toBe(
      true
    )
    cleanup()
    const onUndo = vi.fn()
    const onRedo = vi.fn()
    render(<EditorToolbar {...props({ canUndo: true, canRedo: true, onUndo, onRedo })} />)
    fireEvent.click(screen.getByRole('button', { name: copy.undo }))
    fireEvent.click(screen.getByRole('button', { name: copy.redo }))
    expect(onUndo).toHaveBeenCalledTimes(1)
    expect(onRedo).toHaveBeenCalledTimes(1)
  })
})
