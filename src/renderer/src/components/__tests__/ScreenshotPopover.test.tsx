import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MAIN_COPY } from '@shared/i18n'
import ScreenshotPopover from '../ScreenshotPopover'
import type { ScreenshotState } from '../../hooks/useScreenshot'

const copy = MAIN_COPY['zh-CN']
const thumbnail = 'data:image/png;base64,QUJD'

afterEach(cleanup)

type PopoverProps = React.ComponentProps<typeof ScreenshotPopover>

const props = (state: PopoverProps['state'], over: Partial<PopoverProps> = {}): PopoverProps => ({
  state,
  onSave: () => undefined,
  onEdit: () => undefined,
  editBusy: false,
  onClose: () => undefined,
  ...over
})

describe('ScreenshotPopover', () => {
  it('copied：显示缩略图与「已复制」，保存按钮触发 onSave', () => {
    const onSave = vi.fn()
    const state: Extract<ScreenshotState, { phase: 'copied' }> = { phase: 'copied', thumbnail }
    render(<ScreenshotPopover {...props(state, { onSave })} />)
    expect(screen.queryByRole('status')).not.toBeNull()
    expect(screen.getByAltText('').getAttribute('src')).toBe(thumbnail)
    expect(screen.queryByText(copy.screenshotCopied)).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: copy.screenshotSave }))
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it('左上关闭钮：本地化可访问名，点击触发 onClose', () => {
    const onClose = vi.fn()
    render(<ScreenshotPopover {...props({ phase: 'copied', thumbnail }, { onClose })} />)
    const close = screen.getByRole('button', { name: copy.screenshotClose })
    fireEvent.click(close)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('saving：显示保存中文案与关闭钮，不出现保存按钮', () => {
    render(<ScreenshotPopover {...props({ phase: 'saving', thumbnail })} />)
    expect(screen.queryByText(copy.screenshotSaving)).not.toBeNull()
    expect(screen.queryByRole('button', { name: copy.screenshotSave })).toBeNull()
    expect(screen.getByRole('button', { name: copy.screenshotClose })).toBeTruthy()
  })

  it('saved：显示已保存与文件名', () => {
    render(
      <ScreenshotPopover
        {...props({ phase: 'saved', thumbnail, fileName: '设备-20261010-130509.png' })}
      />
    )
    expect(screen.queryByText('已保存：设备-20261010-130509.png')).not.toBeNull()
  })

  it('error：显示错误文案；capture 失败无图时不渲染 img', () => {
    const { rerender } = render(
      <ScreenshotPopover {...props({ phase: 'error', message: '截屏失败：boom', thumbnail })} />
    )
    expect(screen.queryByText('截屏失败：boom')).not.toBeNull()
    expect(screen.queryByAltText('')).not.toBeNull()
    rerender(
      <ScreenshotPopover
        {...props({ phase: 'error', message: '设备不在运行中', thumbnail: null })}
      />
    )
    expect(screen.queryByAltText('')).toBeNull()
    expect(screen.queryByText('设备不在运行中')).not.toBeNull()
  })
})

describe('ScreenshotPopover 编辑入口（plan 2026-11-02-screenshot-editor T5）', () => {
  it('copied：保存与编辑并排（同 actions 行），点击编辑触发 onEdit', () => {
    const onEdit = vi.fn()
    render(<ScreenshotPopover {...props({ phase: 'copied', thumbnail }, { onEdit })} />)
    const edit = screen.getByRole('button', { name: copy.screenshotEdit })
    const actions = edit.closest('.actions')
    expect(actions).not.toBeNull()
    // 并排：保存钮与编辑钮同容器
    expect(screen.getByRole('button', { name: copy.screenshotSave }).closest('.actions')).toBe(
      actions
    )
    fireEvent.click(edit)
    expect(onEdit).toHaveBeenCalledTimes(1)
  })

  it('saved：保留编辑入口', () => {
    const onEdit = vi.fn()
    render(
      <ScreenshotPopover {...props({ phase: 'saved', thumbnail, fileName: 'f.png' }, { onEdit })} />
    )
    fireEvent.click(screen.getByRole('button', { name: copy.screenshotEdit }))
    expect(onEdit).toHaveBeenCalledTimes(1)
  })

  it('saving/error：无编辑对象，不出现编辑钮', () => {
    const { rerender } = render(<ScreenshotPopover {...props({ phase: 'saving', thumbnail })} />)
    expect(screen.queryByRole('button', { name: copy.screenshotEdit })).toBeNull()
    rerender(<ScreenshotPopover {...props({ phase: 'error', message: 'boom', thumbnail })} />)
    expect(screen.queryByRole('button', { name: copy.screenshotEdit })).toBeNull()
  })

  it('editBusy：编辑钮禁用防重复（copied 与 saved 同律）', () => {
    const { rerender } = render(
      <ScreenshotPopover {...props({ phase: 'copied', thumbnail }, { editBusy: true })} />
    )
    expect(
      (screen.getByRole('button', { name: copy.screenshotEdit }) as HTMLButtonElement).disabled
    ).toBe(true)
    rerender(
      <ScreenshotPopover
        {...props({ phase: 'saved', thumbnail, fileName: 'f.png' }, { editBusy: true })}
      />
    )
    expect(
      (screen.getByRole('button', { name: copy.screenshotEdit }) as HTMLButtonElement).disabled
    ).toBe(true)
  })
})
