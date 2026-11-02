import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ERRORS_COPY, LANGUAGE_OPTIONS, SETTINGS_COPY } from '@shared/i18n'
import type { SdkSourceSnapshot } from '@shared/types'
import SettingsWindow from '../SettingsWindow'
import { SETTINGS_PREVIEW, type SettingsViewModel } from '../settings/model'

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
  it.each(LANGUAGE_OPTIONS)('Windows 顶部复用透明图标与 $value 设置标题', ({ value }) => {
    const { container, rerender } = render(
      <SettingsWindow model={previewModel({ locale: value })} platform="win32" />
    )
    const header = screen.getByRole('banner')
    expect(header.textContent).toBe(ERRORS_COPY[value].settingsWindowTitle)
    expect(header.querySelector('img')?.getAttribute('src')).toContain('icon-windows.png')
    expect(header.querySelector('img')?.getAttribute('alt')).toBe('')
    expect(header.querySelector('button')).toBeNull()
    expect(container.querySelector('.drag-region')).toBeNull()
    for (const platform of ['darwin', 'linux']) {
      rerender(<SettingsWindow model={previewModel({ locale: value })} platform={platform} />)
      expect(screen.queryByRole('banner')).toBeNull()
      expect(Boolean(container.querySelector('.drag-region'))).toBe(platform === 'darwin')
    }
  })

  it.each(LANGUAGE_OPTIONS)('$value 字典齐全，浏览各版面不调用业务写 API', ({ value }) => {
    const write = vi.fn()
    const onLocaleChange = vi.fn()
    const off = vi.fn()
    ;(window as unknown as { api: unknown }).api = {
      theme: { setMode: write, setSystemId: write },
      dialog: { show: vi.fn() },
      sdk: {
        bootstrap: write,
        downloadImage: write,
        detectStudio: vi.fn(async () => null),
        sourceGet: vi.fn(async () => null),
        onSourceChanged: vi.fn(() => off),
        onMigrateProgress: vi.fn(() => off)
      },
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
      // 通用与模拟器版面已接通（批 1/4 与 SDK 来源批）；快捷键/关于/危险区仍只读
      if (pane === 'general' || pane === 'emulator') {
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

  it('SDK 版面接通数据面：快照渲染三态与路径，内存阈值仍占位不伪造', async () => {
    // 类型化夹具（merge review P3-4）：让新增必填字段（如 avdHome）漏写时被 TS 拦下
    const snapshot: SdkSourceSnapshot = {
      source: 'custom',
      avdHome: '/userdata/avd-home',
      managedRoot: '/data/AndroidSDK',
      customPath: '/vol/sdk',
      sharedPath: null,
      detection: {
        studioFound: true,
        studioAppPath: '/Applications/Android Studio.app',
        jbrHome: null,
        sdkCandidate: '/Users/t/Library/Android/sdk',
        candidateSource: 'default-dir',
        defaultSdkPath: '/Users/t/Library/Android/sdk'
      },
      migration: null,
      journalCorrupt: false,
      retainedRoots: []
    }
    const off = vi.fn()
    ;(window as unknown as { api: unknown }).api = {
      dialog: { show: vi.fn() },
      sdk: {
        detectStudio: vi.fn(async () => snapshot.detection),
        sourceGet: vi.fn(async () => snapshot),
        sourceSet: vi.fn(),
        sourceMigrate: vi.fn(),
        sourceAdopt: vi.fn(),
        sourceMigrateCancel: vi.fn(),
        sourceClearRetained: vi.fn(),
        chooseCustomRoot: vi.fn(),
        onSourceChanged: vi.fn(() => off),
        onMigrateProgress: vi.fn(() => off)
      }
    }
    render(<SettingsWindow model={previewModel()} platform="darwin" />)
    fireEvent.click(screen.getByRole('button', { name: '模拟器' }))
    await waitFor(() => {
      expect(
        (screen.getByRole('radio', { name: '自选 SDK 路径' }) as HTMLInputElement).checked
      ).toBe(true)
    })
    expect(screen.getByText('/vol/sdk')).toBeTruthy()
    expect(screen.getByRole('button', { name: '更换路径…' }).matches(':disabled')).toBe(false)
    // Studio 在场 → 共享可选；内存阈值仍为占位
    expect(
      screen.getByRole('radio', { name: '共享 Android Studio SDK' }).matches(':disabled')
    ).toBe(false)
    expect((screen.getByLabelText('内存水位阈值') as HTMLInputElement).value).toBe('')
    delete (window as unknown as { api?: unknown }).api
  })

  it('关于页接通数据面：版本三件套渲染真值，打开目录直达受控桥', async () => {
    const openDataDirectory = vi.fn(async () => undefined)
    const directory = '/Users/t/Library/Application Support/multi-session-device'
    ;(window as unknown as { api: unknown }).api = {
      settings: {
        about: {
          get: vi.fn(async () => ({
            appVersion: '1.2.3',
            electronVersion: '37.2.0',
            chromiumVersion: '138.0.7204.96',
            dataDirectory: directory
          })),
          openDataDirectory
        }
      }
    }
    render(<SettingsWindow model={previewModel()} platform="darwin" />)
    fireEvent.click(screen.getByRole('button', { name: '关于' }))
    await waitFor(() => {
      expect(screen.getByText('1.2.3')).toBeTruthy()
    })
    expect(screen.getByText('37.2.0')).toBeTruthy()
    expect(screen.getByText('138.0.7204.96')).toBeTruthy()
    expect(screen.getByText(directory)).toBeTruthy()
    const button = screen.getByRole('button', { name: '打开目录' })
    expect(button.matches(':disabled')).toBe(false)
    fireEvent.click(button)
    expect(openDataDirectory).toHaveBeenCalledTimes(1)
    delete (window as unknown as { api?: unknown }).api
  })

  it('关于页取数失败保留占位：版本/目录回退文案，按钮禁用不弹错误', async () => {
    const get = vi.fn(async () => {
      throw new Error('boom')
    })
    ;(window as unknown as { api: unknown }).api = {
      settings: { about: { get } }
    }
    render(<SettingsWindow model={previewModel()} platform="darwin" />)
    fireEvent.click(screen.getByRole('button', { name: '关于' }))
    await waitFor(() => {
      expect(get).toHaveBeenCalledTimes(1)
    })
    expect(screen.getByText('版本信息暂不可用')).toBeTruthy()
    expect(screen.getAllByText('暂不可用')).toHaveLength(2)
    expect(screen.getByText('目录信息暂不可用')).toBeTruthy()
    expect(screen.getByRole('button', { name: '打开目录' }).matches(':disabled')).toBe(true)
    delete (window as unknown as { api?: unknown }).api
  })

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
