import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { DeviceProfile, ImageCatalogResult, ImageEntry, SdkImageProgress } from '@shared/types'
import DeviceWizard from '../DeviceWizard'

// vitest 未开 globals，RTL 的自动 cleanup 不注册——显式清理防多次 render 堆叠
afterEach(cleanup)
// 非注入用例挂的 window.api 桩同理：测后拆掉，不渗进注入用例
afterEach(() => {
  delete (window as { api?: unknown }).api
})

const profile = (
  overrides: Partial<DeviceProfile> & { id: string; name: string }
): DeviceProfile => ({
  manufacturer: 'Google',
  tagIds: [],
  formFactor: 'phone',
  screen: { widthPx: 1080, heightPx: 2400, diagonalInches: 6.3, logicalDpi: 420, round: null },
  foldable: false,
  apiMin: null,
  apiMax: null,
  playSupported: null,
  deprecated: false,
  hasFrontCamera: null,
  hasBackCamera: null,
  ramMiB: null,
  creatable: true,
  ...overrides
})

const PROFILES: DeviceProfile[] = [
  profile({ id: 'pixel_8', name: 'Pixel 8' }),
  profile({
    id: 'pixel_tablet',
    name: 'Pixel Tablet',
    formFactor: 'tablet',
    screen: { widthPx: 2560, heightPx: 1600, diagonalInches: 10.95, logicalDpi: 320, round: null }
  })
]

const image = (overrides: Partial<ImageEntry> & { apiMajor?: number }): ImageEntry => {
  const apiMajor = overrides.apiMajor ?? 36
  const rest = { ...overrides }
  delete rest.apiMajor
  return {
    packageName: `system-images;android-${apiMajor};google_apis_playstore;arm64-v8a`,
    displayName: `Google Play ARM 64 v8a System Image ${apiMajor}`,
    api: {
      platformSegment: `android-${apiMajor}`,
      major: apiMajor,
      minor: null,
      codename: null,
      extensionLevel: null,
      baseExtension: null
    },
    services: ['google_play'],
    featureTags: [],
    abi: 'arm64-v8a',
    channel: 0,
    revision: null,
    sizeBytes: 1_500_000_000,
    installed: true,
    source: 'remote+local',
    ...rest
  }
}

const IMAGES: ImageEntry[] = [
  image({ apiMajor: 36, installed: true }),
  image({
    apiMajor: 35,
    packageName: 'system-images;android-35;google_apis;arm64-v8a',
    displayName: 'Google APIs ARM 64 v8a System Image 35',
    api: {
      platformSegment: 'android-35',
      major: 35,
      minor: null,
      codename: null,
      extensionLevel: null,
      baseExtension: null
    },
    services: ['google_apis'],
    installed: false,
    sizeBytes: 1_300_000_000
  }),
  image({ apiMajor: 34, installed: true })
]

/** sdk.images() 返回 ImageCatalogResult——mock 统一包一层 */
const catalogOf = (images: ImageEntry[]): ImageCatalogResult => ({
  images,
  sourceWarnings: [],
  offline: false,
  fetchedAt: 0
})

const setup = (handlers?: {
  onCreate?: Mock<(input: unknown) => Promise<void>>
  onCancel?: Mock<() => void>
  onDownloadImage?: Mock<(packageName: string) => Promise<void>>
}): { onCreate: Mock<(input: unknown) => Promise<void>>; onCancel: Mock<() => void> } => {
  const result = {
    onCreate: handlers?.onCreate ?? vi.fn<(input: unknown) => Promise<void>>(async () => {}),
    onCancel: handlers?.onCancel ?? vi.fn()
  }
  render(
    <DeviceWizard
      onCreate={result.onCreate}
      onCancel={result.onCancel}
      data={{ profiles: PROFILES, images: IMAGES }}
      onDownloadImage={handlers?.onDownloadImage}
    />
  )
  return result
}

/** 按 packageName 定位镜像行（API 文本在摘要面板也会出现，避免歧义） */
const imageRow = (packageName: string): HTMLElement => {
  const row = document.querySelector(`[data-image-package="${packageName}"]`)
  if (row === null) throw new Error(`镜像行未找到：${packageName}`)
  return row as HTMLElement
}
const PKG36 = 'system-images;android-36;google_apis_playstore;arm64-v8a'

/** 进配置页：选第一个画像 → 下一步 */
const gotoConfigure = (profileName = 'Pixel 8'): void => {
  fireEvent.click(screen.getByText(profileName))
  fireEvent.click(screen.getByRole('button', { name: '下一步' }))
}

describe('DeviceWizard', () => {
  it('第一页未选画像时「下一步」禁用；选中后可进第二页', () => {
    const { onCreate } = setup()
    expect((screen.getByRole('button', { name: '下一步' }) as HTMLButtonElement).disabled).toBe(
      true
    )
    gotoConfigure()
    expect(screen.getByText('第 2 / 2 页 · 配置设备')).toBeTruthy()
    expect(onCreate).not.toHaveBeenCalled()
  })

  it('类别导航切换：平板类展示 Pixel Tablet，切类清除不属于该类的选择', () => {
    setup()
    expect(screen.getByText('Pixel 8')).toBeTruthy()
    expect(screen.queryByText('Pixel Tablet')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /平板/ }))
    expect(screen.getByText('Pixel Tablet')).toBeTruthy()
    expect(screen.queryByText('Pixel 8')).toBeNull()
    fireEvent.click(screen.getByText('Pixel Tablet'))
    fireEvent.click(screen.getByRole('button', { name: /手机/ }))
    expect(screen.queryByText('Pixel Tablet')).toBeNull()
    expect((screen.getByRole('button', { name: '下一步' }) as HTMLButtonElement).disabled).toBe(
      true
    )
  })

  it('搜索只过滤不选中：过滤命中也不自动创建选中', () => {
    setup()
    fireEvent.change(screen.getByLabelText('搜索画像名称'), { target: { value: 'Fold' } })
    expect(screen.queryByText('Pixel 8')).toBeNull()
    fireEvent.change(screen.getByLabelText('搜索画像名称'), { target: { value: 'Pixel 8' } })
    expect(screen.getByText('Pixel 8')).toBeTruthy()
    expect((screen.getByRole('button', { name: '下一步' }) as HTMLButtonElement).disabled).toBe(
      true
    )
  })

  it('第二页：未装镜像显示下载按钮且不可选；已装可选；默认名 = 画像名 + API', () => {
    setup()
    gotoConfigure()
    expect((screen.getByLabelText('设备名称') as HTMLInputElement).value).toBe('')
    const row35 = screen.getByText('API 35').closest('[role="button"]') as HTMLElement
    expect(row35.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: /下载 API 35/ }))
    fireEvent.click(screen.getByText('API 36'))
    expect((screen.getByLabelText('设备名称') as HTMLInputElement).value).toBe('Pixel 8 API 36')
  })

  it('摘要面板：选画像与镜像后显示画像与镜像要点', () => {
    setup()
    gotoConfigure()
    fireEvent.click(screen.getByText('API 36'))
    const aside = screen.getByLabelText('设备摘要')
    expect(aside.textContent).toContain('Pixel 8')
    expect(aside.textContent).toContain('Google Play')
    expect(aside.textContent).toContain('arm64-v8a')
    expect(aside.textContent).toContain('已安装')
  })

  it('不兼容镜像（x86_64）默认不可见，打开开关后可见但不可选', () => {
    const x86 = image({
      apiMajor: 36,
      packageName: 'system-images;android-36;google_apis_playstore;x86_64',
      abi: 'x86_64',
      installed: true
    })
    render(
      <DeviceWizard
        onCreate={vi.fn()}
        onCancel={vi.fn()}
        data={{ profiles: PROFILES, images: [image({ apiMajor: 36 }), x86] }}
      />
    )
    gotoConfigure()
    expect(screen.queryByText('x86_64')).toBeNull()
    fireEvent.click(screen.getByLabelText('不支持项'))
    const row = screen.getByText('x86_64').closest('[role="button"]') as HTMLElement
    expect(row.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(screen.getByText('x86_64'))
    expect((screen.getByRole('button', { name: '创建' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('创建：回调完整 CreateDeviceInput（自定义名生效）', () => {
    const { onCreate } = setup()
    gotoConfigure()
    fireEvent.click(screen.getByText('API 36'))
    fireEvent.change(screen.getByLabelText('设备名称'), { target: { value: '  我的测试机  ' } })
    fireEvent.click(screen.getByRole('button', { name: '创建' }))
    expect(onCreate).toHaveBeenCalledWith({
      profileId: 'pixel_8',
      profileLabel: 'Pixel 8',
      imagePackageName: 'system-images;android-36;google_apis_playstore;arm64-v8a',
      name: '我的测试机'
    })
  })

  // issue 2026-10-04-wizard-create-no-double-click-guard：异步创建窗口期连点只发一次
  it('创建中防连击：连点只回调一次，promise 结束后按钮恢复', async () => {
    let resolveCreate: () => void = () => {}
    const onCreate = vi.fn<() => Promise<void>>(
      () => new Promise<void>((resolve) => (resolveCreate = resolve))
    )
    render(
      <DeviceWizard
        onCreate={onCreate}
        onCancel={vi.fn()}
        data={{ profiles: PROFILES, images: IMAGES }}
      />
    )
    gotoConfigure()
    fireEvent.click(screen.getByText('API 36'))
    fireEvent.click(screen.getByRole('button', { name: '创建' }))
    await waitFor(() =>
      expect((screen.getByRole('button', { name: '创建中…' }) as HTMLButtonElement).disabled).toBe(
        true
      )
    )
    fireEvent.click(screen.getByRole('button', { name: '创建中…' }))
    fireEvent.click(screen.getByRole('button', { name: '创建中…' }))
    expect(onCreate).toHaveBeenCalledTimes(1)
    await act(async () => {
      resolveCreate()
    })
    await waitFor(() =>
      expect((screen.getByRole('button', { name: '创建' }) as HTMLButtonElement).disabled).toBe(
        false
      )
    )
  })

  it('上一步：第二页回第一页画像仍选中，再前进镜像与名称保留', () => {
    setup()
    gotoConfigure()
    fireEvent.click(screen.getByText('API 36'))
    fireEvent.change(screen.getByLabelText('设备名称'), { target: { value: '自定义名' } })
    fireEvent.click(screen.getByRole('button', { name: '上一步' }))
    const row = screen.getByText('Pixel 8').closest('[aria-pressed]') as HTMLElement
    expect(row.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: '下一步' }))
    expect((screen.getByLabelText('设备名称') as HTMLInputElement).value).toBe('自定义名')
    expect(imageRow(PKG36).getAttribute('aria-pressed')).toBe('true')
  })

  it('名称清空后「创建」禁用；改过名称后切镜像不覆盖输入', () => {
    setup()
    gotoConfigure()
    fireEvent.click(screen.getByText('API 36'))
    fireEvent.change(screen.getByLabelText('设备名称'), { target: { value: '自定义名' } })
    fireEvent.click(screen.getByText('API 34'))
    expect((screen.getByLabelText('设备名称') as HTMLInputElement).value).toBe('自定义名')
    fireEvent.change(screen.getByLabelText('设备名称'), { target: { value: '   ' } })
    expect((screen.getByRole('button', { name: '创建' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('Esc 取消（独立窗体语义）', () => {
    const { onCancel } = setup()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('「取消」按钮触发 onCancel', () => {
    const { onCancel } = setup()
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('附加设置标签：批次 6 前为占位说明，不含可交互控件', () => {
    setup()
    gotoConfigure()
    fireEvent.click(screen.getByRole('tab', { name: '附加设置' }))
    expect(screen.getByText('模拟性能')).toBeTruthy()
    expect(screen.queryByLabelText('设备名称')).toBeNull()
  })
})

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: Error) => void
}

const deferred = <T,>(): Deferred<T> => {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** 安装完整 window.api 桩；进度回调用 handle.emitProgress 转发 */
const installSdkStub = (parts: {
  profiles?: Mock<() => Promise<DeviceProfile[]>>
  images?: Mock<() => Promise<ImageCatalogResult>>
  downloadImage?: Mock<(packageName: string) => Promise<void>>
}): { emitProgress: (progress: SdkImageProgress) => void } => {
  const handle: { emitProgress: (progress: SdkImageProgress) => void } = { emitProgress: () => {} }
  ;(window as { api?: unknown }).api = {
    sdk: {
      profiles: parts.profiles ?? vi.fn(async () => PROFILES),
      images: parts.images ?? vi.fn(async () => catalogOf(IMAGES)),
      downloadImage: parts.downloadImage ?? vi.fn(async () => {}),
      onImageProgress: (cb: (progress: SdkImageProgress) => void): (() => void) => {
        handle.emitProgress = cb
        return () => {}
      }
    }
  }
  return handle
}

describe('DeviceWizard 清单加载反馈（代次守卫回归）', () => {
  it('画像先到、镜像悬着：画像可选可进第二页，第二页显示镜像加载中且创建禁用', async () => {
    const dProfiles = deferred<DeviceProfile[]>()
    const dImages = deferred<ImageCatalogResult>()
    installSdkStub({
      profiles: vi.fn(() => dProfiles.promise),
      images: vi.fn(() => dImages.promise)
    })
    render(<DeviceWizard onCreate={vi.fn()} onCancel={vi.fn()} />)
    await screen.findByText('正在加载设备画像…')
    dProfiles.resolve(PROFILES)
    await screen.findByText('Pixel 8')
    fireEvent.click(screen.getByText('Pixel 8'))
    fireEvent.click(screen.getByRole('button', { name: '下一步' }))
    expect(await screen.findByText('正在加载系统镜像…')).toBeTruthy()
    expect((screen.getByRole('button', { name: '创建' }) as HTMLButtonElement).disabled).toBe(true)
    dImages.resolve(catalogOf(IMAGES))
    await screen.findByText('API 36')
    fireEvent.click(screen.getByText('API 36'))
    expect((screen.getByLabelText('设备名称') as HTMLInputElement).value).toBe('Pixel 8 API 36')
  })

  it('仅镜像失败：第二页显示错误与镜像重试，画像数据保留可回退', async () => {
    const dProfiles = deferred<DeviceProfile[]>()
    const dImages = deferred<ImageCatalogResult>()
    dImages.reject(new Error('镜像清单拉取失败'))
    installSdkStub({
      profiles: vi.fn(() => dProfiles.promise),
      images: vi.fn(() => dImages.promise)
    })
    render(<DeviceWizard onCreate={vi.fn()} onCancel={vi.fn()} />)
    dProfiles.resolve(PROFILES)
    await screen.findByText('Pixel 8')
    fireEvent.click(screen.getByText('Pixel 8'))
    fireEvent.click(screen.getByRole('button', { name: '下一步' }))
    expect(await screen.findByText('镜像清单拉取失败')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '上一步' }))
    expect(screen.getByText('Pixel 8')).toBeTruthy()
  })

  it('代次守卫：旧请求迟到的结果不覆盖新请求已展示的数据', async () => {
    const dProfiles = deferred<DeviceProfile[]>()
    const dImages1 = deferred<ImageCatalogResult>()
    const dImages2 = deferred<ImageCatalogResult>()
    const imagesMock = vi
      .fn<() => Promise<ImageCatalogResult>>()
      .mockReturnValueOnce(dImages1.promise)
      .mockReturnValueOnce(dImages2.promise)
    const handle = installSdkStub({
      profiles: vi.fn(() => dProfiles.promise),
      images: imagesMock
    })
    render(<DeviceWizard onCreate={vi.fn()} onCancel={vi.fn()} />)
    dProfiles.resolve(PROFILES)
    await screen.findByText('Pixel 8')
    fireEvent.click(screen.getByText('Pixel 8'))
    fireEvent.click(screen.getByRole('button', { name: '下一步' }))
    expect(screen.getByText('正在加载系统镜像…')).toBeTruthy()
    // 下载完成事件触发重拉（第 2 代请求），旧请求仍挂起
    act(() =>
      handle.emitProgress({
        packageName: 'system-images;android-35;google_apis;arm64-v8a',
        percent: 100,
        message: '下载中'
      })
    )
    await waitFor(() => expect(imagesMock).toHaveBeenCalledTimes(2))
    dImages2.resolve(catalogOf(IMAGES))
    await screen.findByText('API 36')
    // 旧请求此刻才返回不同的清单：不得覆盖
    await act(async () => {
      dImages1.resolve(
        catalogOf([
          image({
            apiMajor: 30,
            packageName: 'system-images;android-30;aosp;arm64-v8a',
            displayName: 'AOSP ARM 64 v8a System Image 30',
            api: {
              platformSegment: 'android-30',
              major: 30,
              minor: null,
              codename: null,
              extensionLevel: null,
              baseExtension: null
            },
            services: ['aosp']
          })
        ])
      )
    })
    expect(screen.getByText('API 36')).toBeTruthy()
    expect(screen.queryByText(/API 30/)).toBeNull()
  })
})

describe('DeviceWizard 下载流（互斥与错误反馈回归）', () => {
  const PKG_MISSING = 'system-images;android-35;google_apis;arm64-v8a'

  it('下载：百分比与行互斥保留，完成后重拉显示刷新反馈，期间创建禁用，完成后已装更新', async () => {
    let calls = 0
    const imagesMock = vi.fn(async () => {
      calls += 1
      return catalogOf(
        calls >= 2
          ? IMAGES.map((entry) =>
              entry.packageName === PKG_MISSING ? { ...entry, installed: true } : entry
            )
          : IMAGES
      )
    })
    const handle = installSdkStub({ images: imagesMock })
    render(<DeviceWizard onCreate={vi.fn()} onCancel={vi.fn()} />)
    await screen.findByText('Pixel 8')
    gotoConfigure()
    fireEvent.click(screen.getByText('API 36'))
    fireEvent.click(screen.getByRole('button', { name: /下载 API 35/ }))
    expect((screen.getByRole('button', { name: '创建' }) as HTMLButtonElement).disabled).toBe(true)
    act(() => handle.emitProgress({ packageName: PKG_MISSING, percent: 60, message: '下载中' }))
    expect(screen.getByText('60%')).toBeTruthy()
    act(() => handle.emitProgress({ packageName: PKG_MISSING, percent: 100, message: '下载中' }))
    await waitFor(() => expect(imagesMock.mock.calls.length).toBeGreaterThanOrEqual(2))
    await waitFor(() =>
      expect((screen.getByRole('button', { name: '创建' }) as HTMLButtonElement).disabled).toBe(
        false
      )
    )
  })

  it('下载失败：显示中文错误与重试下载，重试再次调用 downloadImage', async () => {
    const downloadImage = vi.fn(async () => {
      throw new Error('网络中断')
    })
    installSdkStub({ downloadImage })
    render(<DeviceWizard onCreate={vi.fn()} onCancel={vi.fn()} />)
    await screen.findByText('Pixel 8')
    gotoConfigure()
    fireEvent.click(screen.getByRole('button', { name: /下载 API 35/ }))
    expect(await screen.findByText('网络中断')).toBeTruthy()
    expect(screen.getByRole('button', { name: '重试下载' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '重试下载' }))
    await waitFor(() => expect(downloadImage).toHaveBeenCalledTimes(2))
  })

  it('下载后重拉失败：旧清单保留，错误可见且可重试', async () => {
    let calls = 0
    const imagesMock = vi.fn(async () => {
      calls += 1
      if (calls >= 2) throw new Error('重拉失败')
      return catalogOf(IMAGES)
    })
    const handle = installSdkStub({ images: imagesMock })
    render(<DeviceWizard onCreate={vi.fn()} onCancel={vi.fn()} />)
    await screen.findByText('Pixel 8')
    gotoConfigure()
    fireEvent.click(screen.getByRole('button', { name: /下载 API 35/ }))
    act(() => handle.emitProgress({ packageName: PKG_MISSING, percent: 100, message: '下载中' }))
    expect(await screen.findByText('重拉失败')).toBeTruthy()
    expect(screen.getByText('API 36')).toBeTruthy()
    expect(screen.getByRole('button', { name: '重试' })).toBeTruthy()
  })

  it('下载同 tick 原生连点只触发一次下载（ref 守卫）', async () => {
    const downloadImage = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    installSdkStub({ downloadImage })
    render(<DeviceWizard onCreate={vi.fn()} onCancel={vi.fn()} />)
    await screen.findByText('Pixel 8')
    gotoConfigure()
    const button = screen.getByRole('button', { name: /下载 API 35/ })
    fireEvent.click(button)
    fireEvent.click(button) // 同 tick 连点：downloadingRef 拦住第二次
    await waitFor(() => expect(downloadImage).toHaveBeenCalledTimes(1))
  })
})
