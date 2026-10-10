import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MAIN_COPY } from '@shared/i18n'
import ScreenshotPopover from '../ScreenshotPopover'
import type { ScreenshotState } from '../../hooks/useScreenshot'

const copy = MAIN_COPY['zh-CN']
const thumbnail = 'data:image/png;base64,QUJD'

afterEach(cleanup)

describe('ScreenshotPopover', () => {
  it('copied：显示缩略图与「已复制」，保存按钮触发 onSave', () => {
    const onSave = vi.fn()
    const state: Extract<ScreenshotState, { phase: 'copied' }> = { phase: 'copied', thumbnail }
    render(<ScreenshotPopover state={state} onSave={onSave} />)
    expect(screen.queryByRole('status')).not.toBeNull()
    expect(screen.getByAltText('').getAttribute('src')).toBe(thumbnail)
    expect(screen.queryByText(copy.screenshotCopied)).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: copy.screenshotSave }))
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it('saving：显示保存中文案，不出现保存按钮', () => {
    render(<ScreenshotPopover state={{ phase: 'saving', thumbnail }} onSave={() => undefined} />)
    expect(screen.queryByText(copy.screenshotSaving)).not.toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('saved：显示已保存与文件名', () => {
    render(
      <ScreenshotPopover
        state={{ phase: 'saved', thumbnail, fileName: '设备-20261010-130509.png' }}
        onSave={() => undefined}
      />
    )
    expect(screen.queryByText('已保存：设备-20261010-130509.png')).not.toBeNull()
  })

  it('error：显示错误文案；capture 失败无图时不渲染 img', () => {
    const { rerender } = render(
      <ScreenshotPopover
        state={{ phase: 'error', message: '截屏失败：boom', thumbnail }}
        onSave={() => undefined}
      />
    )
    expect(screen.queryByText('截屏失败：boom')).not.toBeNull()
    expect(screen.queryByAltText('')).not.toBeNull()
    rerender(
      <ScreenshotPopover
        state={{ phase: 'error', message: '设备不在运行中', thumbnail: null }}
        onSave={() => undefined}
      />
    )
    expect(screen.queryByAltText('')).toBeNull()
    expect(screen.queryByText('设备不在运行中')).not.toBeNull()
  })
})
