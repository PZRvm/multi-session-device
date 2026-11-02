import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MAIN_COPY } from '@shared/i18n'
import type { NetworkState } from '@shared/types'
import DeviceToolbar from '../DeviceToolbar'
import type { ScreenshotState } from '../../hooks/useScreenshot'

const copy = MAIN_COPY['zh-CN']
const idle: ScreenshotState = { phase: 'idle' }
const thumbnail = 'data:image/png;base64,QUJD'
/** 网络态样例：飞行关 + wifi/数据开（设备常态） */
const netOnline: NetworkState = { airplane: false, wifi: true, data: true }

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
  onScreenshotEdit: () => undefined,
  screenshotEditing: false,
  onScreenshotDismiss: () => undefined,
  networkState: netOnline,
  networkBusy: null,
  onNetworkToggle: () => undefined
}

describe('DeviceToolbar 截屏钮与气泡', () => {
  it('电源钮可选（plan 2026-10-13-real-device-toolbar-parity）：不传 onPower 不渲染，其余键齐全', () => {
    const onButton = vi.fn()
    const withoutPower: Omit<ToolbarProps, 'onPower' | 'powerDisabled'> = {
      disabled: false,
      onButton,
      onRotate: () => undefined,
      screenshotBusy: false,
      screenshotState: idle,
      onScreenshot: () => undefined,
      onScreenshotSave: () => undefined,
      onScreenshotEdit: () => undefined,
      screenshotEditing: false,
      onScreenshotDismiss: () => undefined,
      networkState: netOnline,
      networkBusy: null,
      onNetworkToggle: () => undefined
    }
    render(<DeviceToolbar {...withoutPower} />)
    expect(screen.queryByRole('button', { name: copy.powerOff })).toBeNull()
    for (const label of [copy.back, copy.home, copy.overview, copy.volumeUp, copy.volumeDown]) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy()
    }
    fireEvent.click(screen.getByRole('button', { name: copy.back }))
    expect(onButton).toHaveBeenCalledWith('back')
  })

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

  it('气泡编辑钮走 onScreenshotEdit；screenshotEditing 禁用（不牵连相机钮）', () => {
    const onScreenshotEdit = vi.fn()
    const { rerender } = render(
      <DeviceToolbar
        {...baseProps}
        screenshotState={{ phase: 'copied', thumbnail }}
        onScreenshotEdit={onScreenshotEdit}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: copy.screenshotEdit }))
    expect(onScreenshotEdit).toHaveBeenCalledTimes(1)
    rerender(
      <DeviceToolbar
        {...baseProps}
        screenshotState={{ phase: 'copied', thumbnail }}
        onScreenshotEdit={onScreenshotEdit}
        screenshotEditing
      />
    )
    expect(
      (screen.getByRole('button', { name: copy.screenshotEdit }) as HTMLButtonElement).disabled
    ).toBe(true)
    // 开窗 busy 只作用于编辑钮：相机钮不受牵连
    expect(
      (screen.getByRole('button', { name: copy.screenshotAction }) as HTMLButtonElement).disabled
    ).toBe(false)
  })
})

describe('DeviceToolbar 网络开关组（plan 2026-10-12-network-switch-group）', () => {
  it('三开关在场：分组可访问名 + aria-pressed 承载设备真实态；点击分发目标', () => {
    const onNetworkToggle = vi.fn()
    render(<DeviceToolbar {...baseProps} onNetworkToggle={onNetworkToggle} />)
    expect(screen.getByRole('group', { name: copy.networkGroupAria })).toBeTruthy()
    const airplane = screen.getByRole('button', { name: copy.networkAirplaneToggle })
    const wifi = screen.getByRole('button', { name: copy.networkWifiToggle })
    const data = screen.getByRole('button', { name: copy.networkDataToggle })
    expect(airplane.getAttribute('aria-pressed')).toBe('false')
    expect(wifi.getAttribute('aria-pressed')).toBe('true')
    expect(data.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(airplane)
    fireEvent.click(wifi)
    fireEvent.click(data)
    expect(onNetworkToggle.mock.calls).toEqual([['airplane'], ['wifi'], ['data']])
  })

  it('网络态未知（设备未运行/初值未达）：三开关禁用且不带 aria-pressed', () => {
    render(<DeviceToolbar {...baseProps} networkState={null} />)
    for (const name of [
      copy.networkAirplaneToggle,
      copy.networkWifiToggle,
      copy.networkDataToggle
    ]) {
      const button = screen.getByRole('button', { name }) as HTMLButtonElement
      expect(button.disabled).toBe(true)
      expect(button.getAttribute('aria-pressed')).toBeNull()
    }
  })

  it('busy（任一目标在途）：三开关全禁用；不受投屏 disabled 牵连', () => {
    render(<DeviceToolbar {...baseProps} disabled networkBusy="wifi" />)
    for (const name of [
      copy.networkAirplaneToggle,
      copy.networkWifiToggle,
      copy.networkDataToggle
    ]) {
      expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true)
    }
  })
})
