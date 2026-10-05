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
  const { apiMajor: _dropped, ...rest } = overrides
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

/** 桥接后 sdk.images() 返回 ImageCatalogResult——mock 统一包一层 */
const catalogOf = (images: ImageEntry[]): ImageCatalogResult => ({
  images,
  sourceWarnings: [],
  offline: false,
  fetchedAt: 0
})

const setup = (handlers?: {
  onCreate?: Mock<(input: unknown) => void>
  onCancel?: Mock<() => void>
  onDownloadImage?: Mock<(packageName: string) => Promise<void>>
}): { onCreate: Mock<(input: unknown) => void>; onCancel: Mock<() => void> } => {
  const result = {
    onCreate: handlers?.onCreate ?? vi.fn(),
    onCancel: handlers?.onCancel ?? vi.fn()
  }
  render(
    <DeviceWizard
      onCreate={result.onCreate}
      onCancel={result.onCancel}
      onDownloadImage={handlers?.onDownloadImage}
      data={{ profiles: PROFILES, images: IMAGES }}
    />
  )
  return result
}

// 选项可访问名 = 标题+副行无分隔拼接，用标题文本就近找按钮更稳
const profileButton = (title: string): HTMLButtonElement =>
  screen.getByText(title).closest('button') as HTMLButtonElement

const pickProfile = (): void => {
  fireEvent.click(profileButton('Pixel 8'))
}

const pickImage = (): void => {
  fireEvent.click(profileButton('API 36 · Google Play'))
}

const gotoNameStep = (): void => {
  pickProfile()
  fireEvent.click(screen.getByRole('button', { name: '下一步' }))
  pickImage()
  fireEvent.click(screen.getByRole('button', { name: '下一步' }))
}

describe('DeviceWizard', () => {
  it('第一步未选画像时「下一步」禁用；选中后可进第二步；画像副行带硬件参数', () => {
    setup()
    const next = screen.getByRole('button', { name: '下一步' }) as HTMLButtonElement
    expect(next.disabled).toBe(true)
    pickProfile()
    expect(next.disabled).toBe(false)
    fireEvent.click(next)
    expect(screen.getByText(/第 2 \/ 3 步/)).toBeTruthy()
    expect(screen.getByRole('group', { name: '选择系统镜像' })).toBeTruthy()
  })

  it('第二步未装镜像显示下载按钮且不可选；已装可选；第三步默认名 = 画像名 + API 版本', () => {
    setup()
    pickProfile()
    fireEvent.click(screen.getByRole('button', { name: '下一步' }))
    // 未装行：有下载按钮（带 aria-label），行本身不可把镜像置为已选
    const missing = screen.getByRole('button', { name: '下载 API 35 Google APIs' })
    expect(missing).toBeTruthy()
    expect(profileButton('API 35 · Google APIs').getAttribute('aria-pressed')).toBe('false')
    pickImage()
    expect(profileButton('API 36 · Google Play').getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: '下一步' }))
    expect(screen.getByText(/第 3 \/ 3 步/)).toBeTruthy()
    const name = screen.getByLabelText('设备名称') as HTMLInputElement
    expect(name.value).toBe('Pixel 8 API 36')
  })

  it('下载：点下载钮触发 onDownloadImage，不给选中', async () => {
    const onDownloadImage = vi.fn<(packageName: string) => Promise<void>>()
    setup({ onDownloadImage })
    pickProfile()
    fireEvent.click(screen.getByRole('button', { name: '下一步' }))
    fireEvent.click(screen.getByRole('button', { name: '下载 API 35 Google APIs' }))
    await waitFor(() =>
      expect(onDownloadImage).toHaveBeenCalledWith('system-images;android-35;google_apis;arm64-v8a')
    )
    expect(profileButton('API 35 · Google APIs').getAttribute('aria-pressed')).toBe('false')
  })

  // issue 2026-10-05-wizard-download-no-tick-guard：下载钮是 disabled 行内的 span，
  // jsdom 连点可穿透行禁用——同 tick 两次原生 click，ref 守卫只放行一次
  it('下载同 tick 原生连点只触发一次下载（ref 守卫）', async () => {
    const gate = deferred<void>()
    const onDownloadImage = vi.fn<(packageName: string) => Promise<void>>(() => gate.promise)
    setup({ onDownloadImage })
    pickProfile()
    fireEvent.click(screen.getByRole('button', { name: '下一步' }))
    const button = screen.getByRole('button', { name: '下载 API 35 Google APIs' })
    act(() => {
      button.click()
      button.click()
    })
    expect(onDownloadImage).toHaveBeenCalledTimes(1)
    gate.resolve()
  })

  it('镜像选择不是已装镜像时无法进入第三步（下一步禁用）', () => {
    setup()
    pickProfile()
    fireEvent.click(screen.getByRole('button', { name: '下一步' }))
    // 未选任何镜像
    expect((screen.getByRole('button', { name: '下一步' }) as HTMLButtonElement).disabled).toBe(
      true
    )
  })

  it('创建：回调完整 CreateDeviceInput（自定义名生效）', () => {
    const { onCreate } = setup()
    gotoNameStep()
    const name = screen.getByLabelText('设备名称')
    fireEvent.change(name, { target: { value: '  我的测试机  ' } })
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
    gotoNameStep()
    const button = screen.getByRole('button', { name: '创建' }) as HTMLButtonElement
    fireEvent.click(button)
    fireEvent.click(button)
    fireEvent.click(button)
    expect(onCreate).toHaveBeenCalledTimes(1)
    expect(button.disabled).toBe(true)

    resolveCreate()
    await waitFor(() => expect(button.disabled).toBe(false))
  })

  // 同一 tick 内的原生连点（冒烟实测过的穿透场景）：React 批处理不刷新 state，
  // 只有 ref 守卫拦得住——单 act 包两次原生 click，之间不 flush
  it('同一 tick 原生连点也只回调一次（ref 守卫）', async () => {
    const onCreate = vi.fn<() => Promise<void>>()
    render(
      <DeviceWizard
        onCreate={onCreate}
        onCancel={vi.fn()}
        data={{ profiles: PROFILES, images: IMAGES }}
      />
    )
    gotoNameStep()
    const button = screen.getByRole('button', { name: '创建' }) as HTMLButtonElement
    act(() => {
      button.click()
      button.click()
    })
    expect(onCreate).toHaveBeenCalledTimes(1)
  })

  it('第三步名字清空后「创建」禁用', () => {
    setup()
    gotoNameStep()
    const name = screen.getByLabelText('设备名称')
    fireEvent.change(name, { target: { value: '' } })
    expect((screen.getByRole('button', { name: '创建' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('上一步：回退保留已选（第三步回第二步镜像仍选中，回第一步画像仍选中）', () => {
    setup()
    gotoNameStep()
    fireEvent.click(screen.getByRole('button', { name: '上一步' }))
    expect(screen.getByText(/第 2 \/ 3 步/)).toBeTruthy()
    expect(profileButton('API 36 · Google Play').getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: '上一步' }))
    expect(screen.getByText(/第 1 \/ 3 步/)).toBeTruthy()
    expect(profileButton('Pixel 8').getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: '下一步' }))
    // 画像仍选中，可直达第二步
    expect(screen.getByRole('group', { name: '选择系统镜像' })).toBeTruthy()
  })

  it('取消：回调 onCancel，不触发 onCreate', () => {
    const { onCancel, onCreate } = setup()
    fireEvent.click(screen.getByRole('button', { name: '取消新建' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onCreate).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// 清单加载反馈（plan 2026-10-05-wizard-catalog-loading）：非注入场景走 window.api.sdk
// ---------------------------------------------------------------------------

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason?: unknown) => void
}

const deferred = <T,>(): Deferred<T> => {
  let resolve: (value: T) => void = () => {}
  let reject: (reason?: unknown) => void = () => {}
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** 非注入场景的 sdk 桩：挂在 window.api 上，afterEach 统一拆除 */
const installSdkStub = (sdk: {
  profiles?: Mock<() => Promise<DeviceProfile[]>>
  images?: Mock<() => Promise<ImageCatalogResult>>
  downloadImage?: Mock<(packageName: string) => Promise<void>>
}): { emitProgress: (progress: SdkImageProgress) => void } => {
  let listener: ((progress: SdkImageProgress) => void) | undefined
  const onImageProgress = vi.fn((callback: (progress: SdkImageProgress) => void) => {
    listener = callback
    return () => {}
  })
  Object.defineProperty(window, 'api', {
    value: { sdk: { ...sdk, onImageProgress } },
    configurable: true
  })
  return { emitProgress: (progress) => listener?.(progress) }
}

const PKG_MISSING = 'system-images;android-35;google_apis;arm64-v8a'

describe('DeviceWizard 清单加载反馈', () => {
  it('首载未返回：第一页显示加载等待，下一步禁用，取消可用，不出现空态', () => {
    installSdkStub({
      profiles: vi.fn(() => deferred<DeviceProfile[]>().promise),
      images: vi.fn(() => deferred<ImageCatalogResult>().promise)
    })
    render(<DeviceWizard onCreate={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByRole('status').textContent).toContain('正在加载设备画像')
    expect(screen.queryByText('画像清单为空')).toBeNull()
    expect((screen.getByRole('button', { name: '下一步' }) as HTMLButtonElement).disabled).toBe(
      true
    )
    expect(screen.getByRole('button', { name: '取消新建' })).toBeTruthy()
  })

  it('画像先到、镜像悬着：画像可选可进第二步，第二步显示镜像加载中且下一步禁用', async () => {
    const dProfiles = deferred<DeviceProfile[]>()
    const dImages = deferred<ImageCatalogResult>()
    installSdkStub({
      profiles: vi.fn(() => dProfiles.promise),
      images: vi.fn(() => dImages.promise)
    })
    render(<DeviceWizard onCreate={vi.fn()} onCancel={vi.fn()} />)
    dProfiles.resolve(PROFILES)
    await screen.findByText('Pixel 8')
    pickProfile()
    fireEvent.click(screen.getByRole('button', { name: '下一步' }))
    expect(screen.getByRole('status').textContent).toContain('正在加载系统镜像')
    expect(screen.queryByText('清单为空')).toBeNull()
    expect((screen.getByRole('button', { name: '下一步' }) as HTMLButtonElement).disabled).toBe(
      true
    )
    dImages.resolve(catalogOf(IMAGES))
    await screen.findByText('API 36 · Google Play')
    expect(screen.queryByText('正在加载系统镜像…')).toBeNull()
  })

  it('仅画像失败：第一步显示中文错误与重试，重试只打画像接口并回到加载态', async () => {
    const dRetry = deferred<DeviceProfile[]>()
    const dProfiles = deferred<DeviceProfile[]>()
    dProfiles.reject(new Error('avdmanager 不可用'))
    const profilesMock = vi
      .fn<() => Promise<DeviceProfile[]>>()
      .mockReturnValueOnce(dProfiles.promise)
      .mockReturnValueOnce(dRetry.promise)
    const imagesMock = vi.fn(() => deferred<ImageCatalogResult>().promise)
    installSdkStub({ profiles: profilesMock, images: imagesMock })
    render(<DeviceWizard onCreate={vi.fn()} onCancel={vi.fn()} />)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('avdmanager 不可用')
    expect(screen.queryByText('画像清单为空')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(profilesMock).toHaveBeenCalledTimes(2)
    expect(imagesMock).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('status').textContent).toContain('正在加载设备画像')
  })

  it('仅镜像失败：第二步显示错误与镜像重试，画像数据保留可回退', async () => {
    const dProfiles = deferred<DeviceProfile[]>()
    const dImages = deferred<ImageCatalogResult>()
    dImages.reject(new Error('镜像清单拉取失败'))
    const imagesMock = vi
      .fn<() => Promise<ImageCatalogResult>>()
      .mockReturnValueOnce(dImages.promise)
      .mockReturnValueOnce(deferred<ImageCatalogResult>().promise)
    const profilesMock = vi.fn(() => dProfiles.promise)
    installSdkStub({ profiles: profilesMock, images: imagesMock })
    render(<DeviceWizard onCreate={vi.fn()} onCancel={vi.fn()} />)
    dProfiles.resolve(PROFILES)
    await screen.findByText('Pixel 8')
    pickProfile()
    fireEvent.click(screen.getByRole('button', { name: '下一步' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('镜像清单拉取失败')
    expect(screen.queryByText('清单为空')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(imagesMock).toHaveBeenCalledTimes(2)
    expect(profilesMock).toHaveBeenCalledTimes(1)
    // 画像成功数据仍在：回退第一步可见
    fireEvent.click(screen.getByRole('button', { name: '上一步' }))
    expect(screen.getByText('Pixel 8')).toBeTruthy()
  })

  it('成功但空数组：画像空显示画像空态；镜像空显示清单为空，均不残留加载', async () => {
    const dProfiles = deferred<DeviceProfile[]>()
    const dImages = deferred<ImageCatalogResult>()
    installSdkStub({
      profiles: vi.fn(() => dProfiles.promise),
      images: vi.fn(() => dImages.promise)
    })
    render(<DeviceWizard onCreate={vi.fn()} onCancel={vi.fn()} />)
    dProfiles.resolve([])
    dImages.resolve(catalogOf([]))
    await screen.findByText('画像清单为空')
    expect(screen.queryByText('正在加载设备画像…')).toBeNull()
  })

  it('注入空数组：直接进入空态，不显示加载', () => {
    render(
      <DeviceWizard onCreate={vi.fn()} onCancel={vi.fn()} data={{ profiles: [], images: [] }} />
    )
    expect(screen.getByText('画像清单为空')).toBeTruthy()
    expect(screen.queryByText('正在加载设备画像…')).toBeNull()
  })

  it('缓存快速命中：立即 resolve 直接出列表，无加载残留', async () => {
    installSdkStub({
      profiles: vi.fn(() => Promise.resolve(PROFILES)),
      images: vi.fn(() => Promise.resolve(catalogOf(IMAGES)))
    })
    render(<DeviceWizard onCreate={vi.fn()} onCancel={vi.fn()} />)
    await screen.findByText('Pixel 8')
    expect(screen.queryByText('正在加载设备画像…')).toBeNull()
  })

  it('代次守卫：旧请求迟到的结果不覆盖新请求已展示的数据', async () => {
    const dProfiles = deferred<DeviceProfile[]>()
    const dImages1 = deferred<ImageCatalogResult>()
    const dImages2 = deferred<ImageCatalogResult>()
    const imagesMock = vi
      .fn<() => Promise<ImageCatalogResult>>()
      .mockReturnValueOnce(dImages1.promise)
      .mockReturnValueOnce(dImages2.promise)
    const stub = installSdkStub({
      profiles: vi.fn(() => dProfiles.promise),
      images: imagesMock
    })
    render(<DeviceWizard onCreate={vi.fn()} onCancel={vi.fn()} />)
    dProfiles.resolve(PROFILES)
    await screen.findByText('Pixel 8')
    pickProfile()
    fireEvent.click(screen.getByRole('button', { name: '下一步' }))
    expect(screen.getByText('正在加载系统镜像…')).toBeTruthy()
    // 下载完成事件触发重拉（第 2 代请求），旧请求仍挂起
    act(() => stub.emitProgress({ packageName: PKG_MISSING, percent: 100, message: '下载中' }))
    await waitFor(() => expect(imagesMock).toHaveBeenCalledTimes(2))
    dImages2.resolve(catalogOf(IMAGES))
    await screen.findByText('API 36 · Google Play')
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
    expect(screen.getByText('API 36 · Google Play')).toBeTruthy()
    expect(screen.queryByText(/API 30/)).toBeNull()
  })

  it('卸载后迟到 resolve/reject 不抛未处理拒绝', async () => {
    const dProfiles = deferred<DeviceProfile[]>()
    const dImages = deferred<ImageCatalogResult>()
    installSdkStub({
      profiles: vi.fn(() => dProfiles.promise),
      images: vi.fn(() => dImages.promise)
    })
    const { unmount } = render(<DeviceWizard onCreate={vi.fn()} onCancel={vi.fn()} />)
    unmount()
    await act(async () => {
      dProfiles.resolve(PROFILES)
      dImages.reject(new Error('迟到的失败'))
    })
  })

  it('下载：百分比与行互斥保留，完成后重拉显示刷新反馈，期间下一步禁用，完成后已装更新', async () => {
    const dProfiles = deferred<DeviceProfile[]>()
    const dImages1 = deferred<ImageCatalogResult>()
    const dImages2 = deferred<ImageCatalogResult>()
    const dDownload = deferred<void>()
    const downloadMock = vi.fn(() => dDownload.promise)
    const imagesMock = vi
      .fn<() => Promise<ImageCatalogResult>>()
      .mockReturnValueOnce(dImages1.promise)
      .mockReturnValueOnce(dImages2.promise)
    const stub = installSdkStub({
      profiles: vi.fn(() => dProfiles.promise),
      images: imagesMock,
      downloadImage: downloadMock as Mock<(packageName: string) => Promise<void>>
    })
    render(<DeviceWizard onCreate={vi.fn()} onCancel={vi.fn()} />)
    dProfiles.resolve(PROFILES)
    dImages1.resolve(catalogOf(IMAGES))
    await screen.findByText('Pixel 8')
    pickProfile()
    fireEvent.click(screen.getByRole('button', { name: '下一步' }))
    await screen.findByText('API 36 · Google Play')
    pickImage()
    fireEvent.click(screen.getByRole('button', { name: '下载 API 35 Google APIs' }))
    await waitFor(() => expect(downloadMock).toHaveBeenCalledWith(PKG_MISSING))
    // 下载中：行禁用互斥 + 百分比展示
    expect((profileButton('API 36 · Google Play') as HTMLButtonElement).disabled).toBe(true)
    act(() => stub.emitProgress({ packageName: PKG_MISSING, percent: 42, message: '下载中' }))
    expect(screen.getByText('42%')).toBeTruthy()
    // 下载完成触发重拉：列表保留 + 顶部紧凑刷新反馈；刷新未确认前下一步禁用
    dDownload.resolve()
    await screen.findByText('正在刷新系统镜像…')
    expect(screen.getByText('API 36 · Google Play')).toBeTruthy()
    expect((screen.getByRole('button', { name: '下一步' }) as HTMLButtonElement).disabled).toBe(
      true
    )
    dImages2.resolve(catalogOf(IMAGES.map((entry) => ({ ...entry, installed: true }))))
    await waitFor(() => expect(screen.queryByText('正在刷新系统镜像…')).toBeNull())
    expect(screen.getAllByText(/已安装/).length).toBeGreaterThan(0)
    expect((screen.getByRole('button', { name: '下一步' }) as HTMLButtonElement).disabled).toBe(
      false
    )
  })

  it('下载失败：显示中文错误与重试下载，重试再次调用 downloadImage', async () => {
    const dProfiles = deferred<DeviceProfile[]>()
    const dImages = deferred<ImageCatalogResult>()
    const dDownload1 = deferred<void>()
    const dDownload2 = deferred<void>()
    const downloadMock = vi
      .fn<(packageName: string) => Promise<void>>()
      .mockReturnValueOnce(dDownload1.promise)
      .mockReturnValueOnce(dDownload2.promise)
    installSdkStub({
      profiles: vi.fn(() => dProfiles.promise),
      images: vi.fn(() => dImages.promise),
      downloadImage: downloadMock
    })
    render(<DeviceWizard onCreate={vi.fn()} onCancel={vi.fn()} />)
    dProfiles.resolve(PROFILES)
    dImages.resolve(catalogOf(IMAGES))
    await screen.findByText('Pixel 8')
    pickProfile()
    fireEvent.click(screen.getByRole('button', { name: '下一步' }))
    await screen.findByText('API 36 · Google Play')
    fireEvent.click(screen.getByRole('button', { name: '下载 API 35 Google APIs' }))
    await waitFor(() => expect(downloadMock).toHaveBeenCalledTimes(1))
    dDownload1.reject(new Error('网络中断'))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('网络中断')
    fireEvent.click(screen.getByRole('button', { name: '重试下载' }))
    await waitFor(() => expect(downloadMock).toHaveBeenCalledTimes(2))
    expect(downloadMock).toHaveBeenLastCalledWith(PKG_MISSING)
  })

  it('下载后重拉失败：旧清单保留，错误可见且可重试', async () => {
    const dProfiles = deferred<DeviceProfile[]>()
    const dImages1 = deferred<ImageCatalogResult>()
    const dImages2 = deferred<ImageCatalogResult>()
    const dDownload = deferred<void>()
    const imagesMock = vi
      .fn<() => Promise<ImageCatalogResult>>()
      .mockReturnValueOnce(dImages1.promise)
      .mockReturnValueOnce(dImages2.promise)
      .mockReturnValueOnce(deferred<ImageCatalogResult>().promise)
    installSdkStub({
      profiles: vi.fn(() => dProfiles.promise),
      images: imagesMock,
      downloadImage: vi.fn(() => dDownload.promise)
    })
    render(<DeviceWizard onCreate={vi.fn()} onCancel={vi.fn()} />)
    dProfiles.resolve(PROFILES)
    dImages1.resolve(catalogOf(IMAGES))
    await screen.findByText('Pixel 8')
    pickProfile()
    fireEvent.click(screen.getByRole('button', { name: '下一步' }))
    await screen.findByText('API 36 · Google Play')
    fireEvent.click(screen.getByRole('button', { name: '下载 API 35 Google APIs' }))
    // 等重拉请求真正挂上 await 之后再 reject，避免窗口期无人接住
    dDownload.resolve()
    await waitFor(() => expect(imagesMock).toHaveBeenCalledTimes(2))
    dImages2.reject(new Error('清单刷新失败'))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('清单刷新失败')
    // 旧数据保留：列表仍在
    expect(screen.getByText('API 36 · Google Play')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    await waitFor(() => expect(imagesMock).toHaveBeenCalledTimes(3))
  })
})
