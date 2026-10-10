import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MAIN_COPY } from '@shared/i18n'
import DeviceToolbar from '../DeviceToolbar'
import type { ScreenshotState } from '../../hooks/useScreenshot'

const copy = MAIN_COPY['zh-CN']
const idle: ScreenshotState = { phase: 'idle' }
const thumbnail = 'data:image/png;base64,QUJD'

afterEach(cleanup)

type ToolbarProps = React.ComponentProps<typeof DeviceToolbar>

const baseProps: ToolbarProps = {
  disabled: false,
  powerDisabled: false,
  onButton: () => undefined,
  onPower: () => undefined,
  onRotate: () => undefined,
  screenshotBusy: false,
  screenshotState: idle,
  onScreenshot: () => undefined,
  onScreenshotSave: () => undefined,
  onScreenshotDismiss: () => undefined
}

describe('DeviceToolbar 截屏钮与气泡', () => {
  it('相机按钮在场：本地化可访问名，点击触发 onScreenshot，不受投屏 disabled 牵连', () => {
    const onScreenshot = vi.fn()
    render(<DeviceToolbar {...baseProps} disabled onScreenshot={onScreenshot} />)
    const shot = screen.getByRole('button', { name: copy.screenshotAction }) as HTMLButtonElement
    expect(shot.disabled).toBe(false)
    fireEvent.click(shot)
    expect(onScreenshot).toHaveBeenCalledTimes(1)
  })

  it('screenshotBusy：相机按钮禁用', () => {
    render(<DeviceToolbar {...baseProps} screenshotBusy />)
    expect(
      (screen.getByRole('button', { name: copy.screenshotAction }) as HTMLButtonElement).disabled
    ).toBe(true)
  })

  it('气泡只在 copied/saving/saved/error 渲染；idle/capturing 不出现', () => {
    const { rerender } = render(<DeviceToolbar {...baseProps} />)
    expect(screen.queryByRole('status')).toBeNull()
    rerender(<DeviceToolbar {...baseProps} screenshotState={{ phase: 'capturing' }} />)
    expect(screen.queryByRole('status')).toBeNull()
    rerender(<DeviceToolbar {...baseProps} screenshotState={{ phase: 'copied', thumbnail }} />)
    expect(screen.queryByRole('status')).not.toBeNull()
    expect(screen.queryByText(copy.screenshotCopied)).not.toBeNull()
  })

  it('气泡内保存按钮走 onScreenshotSave', () => {
    const onScreenshotSave = vi.fn()
    render(
      <DeviceToolbar
        {...baseProps}
        screenshotState={{ phase: 'copied', thumbnail }}
        onScreenshotSave={onScreenshotSave}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: copy.screenshotSave }))
    expect(onScreenshotSave).toHaveBeenCalledTimes(1)
  })

  it('气泡左上关闭钮走 onScreenshotDismiss', () => {
    const onScreenshotDismiss = vi.fn()
    render(
      <DeviceToolbar
        {...baseProps}
        screenshotState={{ phase: 'copied', thumbnail }}
        onScreenshotDismiss={onScreenshotDismiss}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: copy.screenshotClose }))
    expect(onScreenshotDismiss).toHaveBeenCalledTimes(1)
  })
})
