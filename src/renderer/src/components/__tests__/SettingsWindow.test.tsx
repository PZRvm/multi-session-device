import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SettingsWindow from '../SettingsWindow'
import { LANGUAGE_OPTIONS, SETTINGS_COPY } from '../settings/copy'
import { SETTINGS_PREVIEW, type SdkMode } from '../settings/model'

afterEach(cleanup)

describe('设置静态边界', () => {
  it.each(LANGUAGE_OPTIONS)('$value 字典齐全，分类切换不调用业务 API', ({ value }) => {
    const write = vi.fn()
    ;(window as unknown as { api: unknown }).api = {
      theme: { setMode: write, setSystemId: write },
      sdk: { bootstrap: write, downloadImage: write },
      devices: { delete: write }
    }
    const copy = SETTINGS_COPY[value]
    expect(Object.keys(copy).sort()).toEqual(Object.keys(SETTINGS_COPY['zh-CN']).sort())
    expect(Object.values(copy).every((text) => text.trim().length > 0)).toBe(true)
    const { container } = render(
      <SettingsWindow model={{ ...SETTINGS_PREVIEW, locale: value }} platform="darwin" />
    )
    expect(container.firstElementChild?.getAttribute('lang')).toBe(value)
    for (const pane of ['general', 'emulator', 'shortcuts', 'about', 'danger'] as const) {
      fireEvent.click(screen.getByRole('button', { name: copy[pane] }))
      expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(copy[pane])
      expect(screen.getByRole('button', { name: copy[pane] }).getAttribute('aria-current')).toBe(
        'page'
      )
      for (const control of container.querySelectorAll('main button, main input, main select')) {
        expect(control.matches(':disabled')).toBe(true)
        fireEvent.click(control)
      }
    }
    expect(write).not.toHaveBeenCalled()
    delete (window as unknown as { api?: unknown }).api
  })

  it.each(['managed', 'shared-studio', 'custom'] as SdkMode[])(
    '%s 样例不伪造路径或内存阈值',
    (mode) => {
      render(
        <SettingsWindow
          model={{ ...SETTINGS_PREVIEW, sdk: { mode, path: null, detection: 'not-checked' } }}
          platform="darwin"
        />
      )
      fireEvent.click(screen.getByRole('button', { name: '模拟器' }))
      expect((screen.getByLabelText('内存水位阈值') as HTMLInputElement).value).toBe('')
      const radios = screen.getAllByRole('radio') as HTMLInputElement[]
      expect(radios.filter((input) => input.checked).map((input) => input.value)).toEqual([mode])
      expect(
        screen.getByText(mode === 'managed' ? '应用数据目录中的 AndroidSDK 文件夹' : '尚未检测')
      ).toBeTruthy()
      if (mode === 'custom') expect(screen.getByText(/默认路径示例/)).toBeTruthy()
    }
  )

  it('窗口控制归系统原生：renderer 不自绘控件，darwin 才有拖拽带；占位保留', () => {
    const { container, unmount } = render(
      <SettingsWindow model={SETTINGS_PREVIEW} platform="darwin" />
    )
    expect(screen.queryByRole('banner')).toBeNull()
    expect(screen.queryByText('静态预览')).toBeNull()
    expect(container.querySelector('.window-controls')).toBeNull()
    expect(container.querySelector('.drag-region')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '关于' }))
    expect(screen.getByText('版本信息暂不可用')).toBeTruthy()
    expect(screen.getByText('目录信息暂不可用')).toBeTruthy()
    unmount()
    const other = render(<SettingsWindow model={SETTINGS_PREVIEW} platform="linux" />)
    expect(other.container.querySelector('.drag-region')).toBeNull()
  })
})
