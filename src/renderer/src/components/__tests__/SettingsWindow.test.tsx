import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LANGUAGE_OPTIONS, SETTINGS_COPY } from '@shared/i18n'
import SettingsWindow from '../SettingsWindow'
import { SETTINGS_PREVIEW, type SdkMode, type SettingsViewModel } from '../settings/model'

afterEach(cleanup)

/** 组装完整视图模型：预览静态字段 + 调用方注入的外观/语言与回调 */
const previewModel = (overrides: Partial<SettingsViewModel> = {}): SettingsViewModel => ({
  ...SETTINGS_PREVIEW,
  appearance: {
    mode: 'system',
    systemId: 'amber',
    onModeChange: vi.fn(),
    onSystemIdChange: vi.fn()
  },
  locale: 'zh-CN',
  onLocaleChange: vi.fn(),
  ...overrides
})

describe('设置窗静态边界与语言切换', () => {
  it.each(LANGUAGE_OPTIONS)('$value 字典齐全，未接版面仍只读，不调用业务 API', ({ value }) => {
    const write = vi.fn()
    const onLocaleChange = vi.fn()
    ;(window as unknown as { api: unknown }).api = {
      theme: { setMode: write, setSystemId: write },
      sdk: { bootstrap: write, downloadImage: write },
      devices: { delete: write }
    }
    const copy = SETTINGS_COPY[value]
    expect(Object.keys(copy).sort()).toEqual(Object.keys(SETTINGS_COPY['zh-CN']).sort())
    expect(Object.values(copy).every((text) => text.trim().length > 0)).toBe(true)
    const { container } = render(
      <SettingsWindow model={previewModel({ locale: value, onLocaleChange })} platform="darwin" />
    )
    expect(container.firstElementChild?.getAttribute('lang')).toBe(value)
    for (const pane of ['general', 'emulator', 'shortcuts', 'about', 'danger'] as const) {
      fireEvent.click(screen.getByRole('button', { name: copy[pane] }))
      expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(copy[pane])
      expect(screen.getByRole('button', { name: copy[pane] }).getAttribute('aria-current')).toBe(
        'page'
      )
      // 通用版面的外观两行与语言行已接通（批 1/批 4）；其余版面控件仍禁用
      if (pane === 'general') {
        for (const control of container.querySelectorAll('main button, main select')) {
          expect(control.matches(':disabled')).toBe(false)
        }
      } else {
        for (const control of container.querySelectorAll('main button, main input')) {
          expect(control.matches(':disabled')).toBe(true)
          fireEvent.click(control)
        }
      }
    }
    expect(write).not.toHaveBeenCalled()
    delete (window as unknown as { api?: unknown }).api
  })

  it('外观与主题色可交互：点击即调用对应回调，选中态跟随模型（批 4）', () => {
    const onModeChange = vi.fn()
    const onSystemIdChange = vi.fn()
    render(
      <SettingsWindow
        model={previewModel({
          appearance: { mode: 'system', systemId: 'amber', onModeChange, onSystemIdChange }
        })}
        platform="darwin"
      />
    )
    const modes = [
      { key: 'system' as const, label: '跟随系统' },
      { key: 'light' as const, label: '白天' },
      { key: 'dark' as const, label: '黑夜' }
    ]
    for (const { key, label } of modes) {
      const button = screen.getByRole('button', { name: label })
      expect(button.matches(':disabled')).toBe(false)
      expect(button.getAttribute('aria-pressed')).toBe(String(key === 'system'))
      fireEvent.click(button)
      expect(onModeChange).toHaveBeenCalledWith(key)
    }
    expect(onModeChange).toHaveBeenCalledTimes(3)
    for (const id of ['amber', 'mist', 'moss'] as const) {
      const swatch = screen.getByRole('button', {
        name: { amber: '琥珀', mist: '雾蓝', moss: '苔绿' }[id]
      })
      expect(swatch.matches(':disabled')).toBe(false)
      expect(swatch.getAttribute('aria-pressed')).toBe(String(id === 'amber'))
      fireEvent.click(swatch)
      expect(onSystemIdChange).toHaveBeenCalledWith(id)
    }
    expect(onSystemIdChange).toHaveBeenCalledTimes(3)
  })

  it('语言行可交互：切换即调用 onLocaleChange（写入经 store 落盘，不经业务 API）', () => {
    const onLocaleChange = vi.fn()
    render(<SettingsWindow model={previewModel({ onLocaleChange })} platform="darwin" />)
    const language = screen.getByLabelText('界面语言') as HTMLSelectElement
    expect(language.matches(':disabled')).toBe(false)
    expect(language.value).toBe('zh-CN')
    const next = LANGUAGE_OPTIONS.find((option) => option.value !== 'zh-CN')!.value
    fireEvent.change(language, { target: { value: next } })
    expect(onLocaleChange).toHaveBeenCalledTimes(1)
    expect(onLocaleChange).toHaveBeenCalledWith(next)
  })

  it.each(['managed', 'shared-studio', 'custom'] as SdkMode[])(
    '%s 样例不伪造路径或内存阈值',
    (mode) => {
      render(
        <SettingsWindow
          model={previewModel({ sdk: { mode, path: null, detection: 'not-checked' } })}
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
      <SettingsWindow model={previewModel()} platform="darwin" />
    )
    expect(screen.queryByRole('banner')).toBeNull()
    expect(screen.queryByText('静态预览')).toBeNull()
    expect(container.querySelector('.window-controls')).toBeNull()
    expect(container.querySelector('.drag-region')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '关于' }))
    expect(screen.getByText('版本信息暂不可用')).toBeTruthy()
    expect(screen.getByText('目录信息暂不可用')).toBeTruthy()
    unmount()
    const other = render(<SettingsWindow model={previewModel()} platform="linux" />)
    expect(other.container.querySelector('.drag-region')).toBeNull()
  })
})
