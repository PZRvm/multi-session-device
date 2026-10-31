import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { WIZARD_COPY, format } from '@shared/i18n'
import type {
  DeviceProfile,
  ImageCatalogResult,
  SdkSnapshot,
  SdkUninstallState,
  ImageEntry,
  SdkImageProgress,
  WizardCapabilities
} from '@shared/types'
import DeviceWizard from '../DeviceWizard'
import { formFactorLabel } from '../wizard/shared'

// UI 文案断言经字典取词（zh-CN 基准）；夹具输入（注入错误、用户输入）保持字面量
const copy = WIZARD_COPY['zh-CN']
/** 行内 aria 为「<动词> API <n> <服务>」——测试只锚定动词 + API 段 */
const downloadAria = (api: string): RegExp =>
  new RegExp(format(copy.downloadAria, { api, service: '' }).trimEnd())
const uninstallAria = (api: string): RegExp =>
  new RegExp(format(copy.uninstallInstalledAria, { api, service: '' }).trimEnd())
const cancelDownloadAria = (api: string): RegExp =>
  new RegExp(format(copy.cancelDownloadAria, { api, service: '' }).trimEnd())

// vitest 未开 globals，RTL 的自动 cleanup 不注册——显式清理防多次 render 堆叠
afterEach(cleanup)
// 组件现读 window.api.platform（宿主 ABI 单源注入，plan 2026-10-22-windows-emulator-env）——
// 注入用例没有完整 api 桩，统一默认平台桩（darwin = mac 现状）；自挂完整桩的用例覆盖之
beforeEach(() => {
  ;(window as { api?: unknown }).api = { platform: 'darwin' }
})
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
    tagIds: ['google_apis_playstore'],
    abi: 'arm64-v8a',
    channel: 0,
    revision: null,
    sizeBytes: 1_500_000_000,
    zipUrl: null,
    zipSha1: null,
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

/** sdk.images() 返回 ImageCatalogResult——mock 统一包一层（默认无进行中下载） */
const catalogOf = (
  images: ImageEntry[],
  activeDownload: ImageCatalogResult['activeDownload'] = null,
  activeUninstall: ImageCatalogResult['activeUninstall'] = null,
  sdkSource: ImageCatalogResult['sdkSource'] = undefined
): ImageCatalogResult => ({
  images,
  sourceWarnings: [],
  offline: false,
  fetchedAt: 0,
  activeDownload,
  activeUninstall,
  sdkSource
})

/** 固定能力样本（与 main buildCapabilities 的默认形态对齐；Quick 关闭） */
const CAPABILITIES: WizardCapabilities = {
  capabilityContextId: 'pixel_8|pkg|36.1.9',
  emulatorVersion: '36.1.9',
  defaults: {
    skinRef: null,
    frontCamera: { mode: 'emulated', deviceId: null },
    rearCamera: { mode: 'emulated', deviceId: null },
    networkSpeed: null,
    networkLatency: null,
    orientation: null,
    bootMode: 'cold',
    internalStorageMiB: 6144,
    cpuCores: 4,
    graphics: 'auto',
    ramMiB: 2048,
    vmHeapMiB: 256,
    preferredAbi: 'optimal'
  },
  fields: {
    skinRef: { disabledReason: '机型皮肤即将支持', min: null, max: null, step: null },
    frontCamera: { disabledReason: null, min: null, max: null, step: null },
    rearCamera: { disabledReason: null, min: null, max: null, step: null },
    networkSpeed: { disabledReason: null, min: null, max: null, step: null },
    networkLatency: { disabledReason: null, min: null, max: null, step: null },
    orientation: { disabledReason: null, min: null, max: null, step: null },
    bootMode: { disabledReason: 'Quick 未开放', min: null, max: null, step: null },
    internalStorageMiB: { disabledReason: null, min: 2048, max: 65536, step: 1 },
    cpuCores: { disabledReason: null, min: 1, max: 10, step: 1 },
    graphics: { disabledReason: null, min: null, max: null, step: null },
    ramMiB: { disabledReason: null, min: 2048, max: 32768, step: 1 },
    vmHeapMiB: { disabledReason: null, min: 64, max: 1024, step: 1 },
    preferredAbi: { disabledReason: '跨架构二期', min: null, max: null, step: null }
  },
  quickBootAvailable: false,
  quickBootDisabledReason: 'Quick Boot 尚未通过稳定性门槛',
  webcamDeviceIds: [],
  skinIds: []
}

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
      onWizardCapabilities={async () => CAPABILITIES}
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
  fireEvent.click(screen.getByRole('button', { name: copy.next }))
}

describe('DeviceWizard', () => {
  it('第一页未选画像时「下一步」禁用；选中后可进第二页', () => {
    const { onCreate } = setup()
    expect((screen.getByRole('button', { name: copy.next }) as HTMLButtonElement).disabled).toBe(
      true
    )
    gotoConfigure()
    expect(screen.getByText(`第 2 / 2 页 · ${copy.pageConfigure}`)).toBeTruthy()
    expect(onCreate).not.toHaveBeenCalled()
  })

  it('类别导航切换：平板类展示 Pixel Tablet，切类清除不属于该类的选择', () => {
    setup()
    expect(screen.getByText('Pixel 8')).toBeTruthy()
    expect(screen.queryByText('Pixel Tablet')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: new RegExp(copy.ffTablet) }))
    expect(screen.getByText('Pixel Tablet')).toBeTruthy()
    expect(screen.queryByText('Pixel 8')).toBeNull()
    fireEvent.click(screen.getByText('Pixel Tablet'))
    fireEvent.click(screen.getByRole('button', { name: new RegExp(copy.ffPhone) }))
    expect(screen.queryByText('Pixel Tablet')).toBeNull()
    expect((screen.getByRole('button', { name: copy.next }) as HTMLButtonElement).disabled).toBe(
      true
    )
  })

  it('搜索只过滤不选中：过滤命中也不自动创建选中', () => {
    setup()
    fireEvent.change(screen.getByLabelText(copy.searchAria), { target: { value: 'Fold' } })
    expect(screen.queryByText('Pixel 8')).toBeNull()
    fireEvent.change(screen.getByLabelText(copy.searchAria), { target: { value: 'Pixel 8' } })
    expect(screen.getByText('Pixel 8')).toBeTruthy()
    expect((screen.getByRole('button', { name: copy.next }) as HTMLButtonElement).disabled).toBe(
      true
    )
  })

  it('第二页：未装镜像显示下载按钮且不可选；已装可选；默认名 = 画像名 + API', () => {
    setup()
    gotoConfigure()
    expect((screen.getByLabelText(copy.nameLabel) as HTMLInputElement).value).toBe('')
    const row35 = screen.getByText('API 35').closest('[role="button"]') as HTMLElement
    expect(row35.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: downloadAria('35') }))
    fireEvent.click(screen.getByText('API 36'))
    expect((screen.getByLabelText(copy.nameLabel) as HTMLInputElement).value).toBe('Pixel 8 API 36')
  })

  it('摘要面板：选画像与镜像后显示画像与镜像要点', () => {
    setup()
    gotoConfigure()
    fireEvent.click(screen.getByText('API 36'))
    const aside = screen.getByLabelText(copy.summaryAria)
    expect(aside.textContent).toContain('Pixel 8')
    expect(aside.textContent).toContain('Google Play')
    expect(aside.textContent).toContain('arm64-v8a')
    expect(aside.textContent).toContain(copy.installed)
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
    fireEvent.click(screen.getByLabelText(copy.unsupportedToggle))
    const row = screen.getByText('x86_64').closest('[role="button"]') as HTMLElement
    expect(row.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(screen.getByText('x86_64'))
    expect((screen.getByRole('button', { name: copy.create }) as HTMLButtonElement).disabled).toBe(
      true
    )
  })

  it('创建：回调完整 CreateDeviceInput（自定义名生效）', async () => {
    const { onCreate } = setup()
    gotoConfigure()
    fireEvent.click(screen.getByText('API 36'))
    // 能力装载是异步的——等创建钮随 capabilities 就绪解锁
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: copy.create }) as HTMLButtonElement).disabled
      ).toBe(false)
    )
    fireEvent.change(screen.getByLabelText(copy.nameLabel), { target: { value: '  我的测试机  ' } })
    fireEvent.click(screen.getByRole('button', { name: copy.create }))
    expect(onCreate).toHaveBeenCalledWith({
      profileId: 'pixel_8',
      profileLabel: 'Pixel 8',
      imagePackageName: 'system-images;android-36;google_apis_playstore;arm64-v8a',
      name: '我的测试机',
      advancedSettings: {
        skinRef: null,
        frontCamera: { mode: 'emulated', deviceId: null },
        rearCamera: { mode: 'emulated', deviceId: null },
        networkSpeed: null,
        networkLatency: null,
        orientation: null,
        bootMode: 'cold',
        internalStorageMiB: 6144,
        cpuCores: 4,
        graphics: 'auto',
        ramMiB: 2048,
        vmHeapMiB: 256,
        preferredAbi: 'optimal'
      }
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
        onWizardCapabilities={async () => CAPABILITIES}
      />
    )
    gotoConfigure()
    fireEvent.click(screen.getByText('API 36'))
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: copy.create }) as HTMLButtonElement).disabled
      ).toBe(false)
    )
    fireEvent.click(screen.getByRole('button', { name: copy.create }))
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: copy.creating }) as HTMLButtonElement).disabled
      ).toBe(true)
    )
    fireEvent.click(screen.getByRole('button', { name: copy.creating }))
    fireEvent.click(screen.getByRole('button', { name: copy.creating }))
    expect(onCreate).toHaveBeenCalledTimes(1)
    await act(async () => {
      resolveCreate()
    })
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: copy.create }) as HTMLButtonElement).disabled
      ).toBe(false)
    )
  })

  it('上一步：第二页回第一页画像仍选中，再前进镜像与名称保留', () => {
    setup()
    gotoConfigure()
    fireEvent.click(screen.getByText('API 36'))
    fireEvent.change(screen.getByLabelText(copy.nameLabel), { target: { value: '自定义名' } })
    fireEvent.click(screen.getByRole('button', { name: copy.back }))
    const row = screen.getByText('Pixel 8').closest('[aria-pressed]') as HTMLElement
    expect(row.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: copy.next }))
    expect((screen.getByLabelText(copy.nameLabel) as HTMLInputElement).value).toBe('自定义名')
    expect(imageRow(PKG36).getAttribute('aria-pressed')).toBe('true')
  })

  it('名称清空后「创建」禁用；改过名称后切镜像不覆盖输入', () => {
    setup()
    gotoConfigure()
    fireEvent.click(screen.getByText('API 36'))
    fireEvent.change(screen.getByLabelText(copy.nameLabel), { target: { value: '自定义名' } })
    fireEvent.click(screen.getByText('API 34'))
    expect((screen.getByLabelText(copy.nameLabel) as HTMLInputElement).value).toBe('自定义名')
    fireEvent.change(screen.getByLabelText(copy.nameLabel), { target: { value: '   ' } })
    expect((screen.getByRole('button', { name: copy.create }) as HTMLButtonElement).disabled).toBe(
      true
    )
  })

  it('Esc 取消（独立窗体语义）', () => {
    const { onCancel } = setup()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('「取消」按钮触发 onCancel', () => {
    const { onCancel } = setup()
    fireEvent.click(screen.getByRole('button', { name: copy.cancel }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('附加设置标签：分组表单渲染，Quick 禁用，改值后创建回传设置', async () => {
    const { onCreate } = setup()
    gotoConfigure()
    fireEvent.click(screen.getByText('API 36'))
    fireEvent.click(screen.getByRole('tab', { name: copy.tabSettings }))
    await screen.findByText(copy.fieldCpuCores)
    // Quick 未开放：radio 禁用
    const quickRadio = screen
      .getAllByRole('radio')
      .find((radio) => (radio as HTMLInputElement).value === 'quick')
    expect(quickRadio).toBeUndefined() // 未开放时不渲染 quick 选项的激活路径——改断言 Cold 存在
    expect(screen.getByRole('radio', { name: /Cold Boot/ })).toBeTruthy()
    // 改 CPU 核数后创建回传
    fireEvent.change(screen.getByLabelText(copy.fieldCpuCores, { exact: false }), {
      target: { value: '6' }
    })
    fireEvent.click(screen.getByRole('tab', { name: copy.tabDevice }))
    fireEvent.click(screen.getByRole('button', { name: copy.create }))
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1))
    const payload = onCreate.mock.calls[0][0] as { advancedSettings: { cpuCores: number } }
    expect(payload.advancedSettings.cpuCores).toBe(6)
  })

  it('导入皮肤后能力本地并入：字段解锁、无「皮肤不在可用清单」错误、创建不被卡死（P2-1）', async () => {
    const added = {
      id: 'u1',
      name: 'imported-u1',
      skinRef: 'imported:u1',
      source: 'imported',
      portrait: { frameWidth: 100, frameHeight: 200, screenWidth: 80, screenHeight: 160 }
    }
    ;(window as { api?: unknown }).api = {
      sdk: {
        chooseDeviceSkin: vi.fn(async () => added),
        deviceSkins: vi.fn(async () => [])
      }
    }
    try {
      setup()
      gotoConfigure()
      fireEvent.click(screen.getByText('API 36'))
      fireEvent.click(screen.getByRole('tab', { name: copy.tabSettings }))
      const skinSelect = (await screen.findByLabelText(copy.fieldSkinRef)) as HTMLSelectElement
      // 注入能力样本 skinIds 为空 → 导入前字段禁用
      expect(skinSelect.disabled).toBe(true)
      fireEvent.click(screen.getByRole('button', { name: copy.importArchive }))
      // absorb：skinIds 并入新皮肤、字段解锁——不重拉能力（画像×镜像未变）
      await waitFor(() => expect(skinSelect.disabled).toBe(false))
      expect(screen.queryByText(/皮肤不在可用清单中/)).toBeNull()
      fireEvent.click(screen.getByRole('tab', { name: copy.tabDevice }))
      await waitFor(() =>
        expect(
          (screen.getByRole('button', { name: copy.create }) as HTMLButtonElement).disabled
        ).toBe(false)
      )
    } finally {
      delete (window as { api?: unknown }).api
    }
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

/** 安装完整 window.api 桩；进度/卸载终态经 handle.emit* 转发 */
const installSdkStub = (parts: {
  profiles?: Mock<() => Promise<DeviceProfile[]>>
  images?: Mock<() => Promise<ImageCatalogResult>>
  downloadImage?: Mock<(packageName: string) => Promise<void>>
  cancelDownloadImage?: Mock<(packageName: string) => Promise<void>>
  status?: Mock<() => Promise<SdkSnapshot>>
  bootstrap?: Mock<() => Promise<SdkSnapshot>>
}): {
  emitProgress: (progress: SdkImageProgress) => void
  emitUninstallState: (state: SdkUninstallState) => void
  emitSdkProgress: (percent: number) => void
} => {
  const handle: {
    emitProgress: (progress: SdkImageProgress) => void
    emitUninstallState: (state: SdkUninstallState) => void
    emitSdkProgress: (percent: number) => void
  } = {
    emitProgress: () => {},
    emitUninstallState: () => {},
    emitSdkProgress: () => {}
  }
  ;(window as { api?: unknown }).api = {
    sdk: {
      profiles: parts.profiles ?? vi.fn(async () => PROFILES),
      images: parts.images ?? vi.fn(async () => catalogOf(IMAGES, null, null, 'managed')),
      downloadImage: parts.downloadImage ?? vi.fn(async () => {}),
      cancelDownloadImage: parts.cancelDownloadImage ?? vi.fn(async () => {}),
      wizardCapabilities: vi.fn(async () => CAPABILITIES),
      // 引导入口默认「组件齐全」——既有用例不触发引导按钮
      status:
        parts.status ??
        vi.fn(async () => ({
          root: '/sdk',
          jre: { present: true },
          cmdlineTools: { present: true },
          platformTools: { present: true },
          emulator: { present: true },
          licensed: true
        })),
      bootstrap: parts.bootstrap ?? vi.fn(async () => undefined as never),
      onImageProgress: (cb: (progress: SdkImageProgress) => void): (() => void) => {
        handle.emitProgress = cb
        return () => {}
      },
      onUninstallState: (cb: (state: SdkUninstallState) => void): (() => void) => {
        handle.emitUninstallState = cb
        return () => {}
      },
      onSdkProgress: (cb: (progress: { percent?: number }) => void): (() => void) => {
        handle.emitSdkProgress = (percent: number): void => cb({ percent })
        return () => {}
      }
    },
    platform: 'darwin'
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
    await screen.findByText(copy.loadingProfiles)
    dProfiles.resolve(PROFILES)
    await screen.findByText('Pixel 8')
    fireEvent.click(screen.getByText('Pixel 8'))
    fireEvent.click(screen.getByRole('button', { name: copy.next }))
    expect(await screen.findByText(copy.loadingImages)).toBeTruthy()
    expect((screen.getByRole('button', { name: copy.create }) as HTMLButtonElement).disabled).toBe(
      true
    )
    dImages.resolve(catalogOf(IMAGES))
    await screen.findByText('API 36')
    fireEvent.click(screen.getByText('API 36'))
    expect((screen.getByLabelText(copy.nameLabel) as HTMLInputElement).value).toBe('Pixel 8 API 36')
  })

  it('共享态缺件：不出「完成 SDK 引导」按钮（入口被只读守卫必拒），指引文案在场', async () => {
    const profiles = vi.fn(async (): Promise<DeviceProfile[]> => {
      throw new Error(
        '共享 SDK 缺少可用组件（cmdline-tools 或 Android Studio 的 Java）：请在 Android Studio 的 SDK Manager 补装命令行工具'
      )
    })
    installSdkStub({
      profiles,
      images: vi.fn(async () =>
        catalogOf([image({ apiMajor: 36, installed: true })], null, null, 'shared-studio')
      ),
      status: vi.fn(async (): Promise<SdkSnapshot> => ({
        root: '/studio-sdk',
        jre: { present: true },
        cmdlineTools: { present: false },
        platformTools: { present: true },
        emulator: { present: true },
        licensed: true
      }))
    })
    render(<DeviceWizard onCreate={vi.fn()} onCancel={vi.fn()} />)
    expect(await screen.findByText(/共享 SDK 缺少可用组件/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: copy.sdkBootstrapAction })).toBeNull()
    // 分步图文指引在场：标题 + 五步全量（issue 2026-10-31 修复批二）；默认桩是
    // darwin——第一步按平台出 mac 键（Preferences/Cmd+,，review P3-8），win 键不出现
    expect(screen.getByText(copy.sdkSharedGuideTitle)).toBeTruthy()
    expect(screen.getByText(copy.sdkSharedGuideStep1Mac)).toBeTruthy()
    expect(screen.queryByText(copy.sdkSharedGuideStep1)).toBeNull()
    for (const step of [
      copy.sdkSharedGuideStep2,
      copy.sdkSharedGuideStep3,
      copy.sdkSharedGuideStep4,
      copy.sdkSharedGuideStep5
    ]) {
      expect(screen.getByText(step)).toBeTruthy()
    }
  })

  it('共享指引第一步随平台：win32 桩出 win 入口文案（File > Settings / Ctrl+Alt+S）', async () => {
    installSdkStub({
      profiles: vi.fn(async (): Promise<DeviceProfile[]> => {
        throw new Error('共享 SDK 缺少可用组件')
      }),
      images: vi.fn(async () =>
        catalogOf([image({ apiMajor: 36, installed: true })], null, null, 'shared-studio')
      )
    })
    const api = (window as { api: { platform: string } }).api
    const original = api.platform
    api.platform = 'win32'
    try {
      render(<DeviceWizard onCreate={vi.fn()} onCancel={vi.fn()} />)
      expect(await screen.findByText(copy.sdkSharedGuideStep1)).toBeTruthy()
      expect(screen.queryByText(copy.sdkSharedGuideStep1Mac)).toBeNull()
    } finally {
      api.platform = original
    }
  })

  it('SDK 未就绪（清除保留根后的空根场景）：错误块出现「完成 SDK 引导」，忙碌由进度驱动，成功后自动重拉画像', async () => {
    let calls = 0
    const profiles = vi.fn(async (): Promise<DeviceProfile[]> => {
      calls += 1
      if (calls === 1) throw new Error('SDK 尚未就绪（缺 cmdline-tools 或 JRE），先完成 SDK 引导')
      return PROFILES
    })
    const dBootstrap = deferred<SdkSnapshot>()
    const bootstrap = vi.fn(() => dBootstrap.promise)
    const handle = installSdkStub({
      profiles,
      status: vi.fn(async (): Promise<SdkSnapshot> => ({
        root: '/sdk',
        jre: { present: false },
        cmdlineTools: { present: false },
        platformTools: { present: false },
        emulator: { present: false },
        licensed: false
      })),
      bootstrap
    })
    render(<DeviceWizard onCreate={vi.fn()} onCancel={vi.fn()} />)
    expect(await screen.findByText(/SDK 尚未就绪/)).toBeTruthy()
    const bootstrapButton = await screen.findByRole('button', { name: copy.sdkBootstrapAction })
    fireEvent.click(bootstrapButton)
    // 两段式（用户反馈）：点击后 pending 禁用但无忙碌动画；进度事件才转「引导中」
    await waitFor(() => expect(bootstrap).toHaveBeenCalledTimes(1))
    expect(screen.queryByText(copy.sdkBootstrapBusy)).toBeNull()
    handle.emitSdkProgress(10)
    expect(await screen.findByText(copy.sdkBootstrapBusy)).toBeTruthy()
    // 引导成功 → 按钮消失、画像自动重拉成功
    dBootstrap.resolve({
      root: '/sdk',
      jre: { present: true },
      cmdlineTools: { present: true },
      platformTools: { present: true },
      emulator: { present: true },
      licensed: true
    })
    expect(await screen.findByText('Pixel 8')).toBeTruthy()
    expect(profiles).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('button', { name: copy.sdkBootstrapAction })).toBeNull()
  })

  it('引导探测负路径（review P3-5）：报错但组件齐全——只出重试不出引导钮', async () => {
    const profiles = vi.fn(async (): Promise<DeviceProfile[]> => {
      throw new Error('画像清单服务暂不可用')
    })
    installSdkStub({ profiles }) // status 默认组件齐全
    render(<DeviceWizard onCreate={vi.fn()} onCancel={vi.fn()} />)
    expect(await screen.findByText('画像清单服务暂不可用')).toBeTruthy()
    expect(screen.queryByRole('button', { name: copy.sdkBootstrapAction })).toBeNull()
    expect(screen.getByRole('button', { name: copy.retry })).toBeTruthy()
  })

  it('许可拒绝 = 用户取消（用户反馈）：无报错，按钮原地恢复可再次发起', async () => {
    // 现实语义：取消后 SDK 仍未就绪，重拉继续报同一错误——按钮保持在场可再发起
    const profiles = vi.fn(async (): Promise<DeviceProfile[]> => {
      throw new Error('SDK 尚未就绪（缺 cmdline-tools 或 JRE），先完成 SDK 引导')
    })
    const bootstrap = vi.fn(async (): Promise<SdkSnapshot> => ({
      root: '/sdk',
      jre: { present: false },
      cmdlineTools: { present: false },
      platformTools: { present: false },
      emulator: { present: false },
      licensed: false
    }))
    installSdkStub({
      profiles,
      status: vi.fn(async (): Promise<SdkSnapshot> => ({
        root: '/sdk',
        jre: { present: false },
        cmdlineTools: { present: false },
        platformTools: { present: false },
        emulator: { present: false },
        licensed: false
      })),
      bootstrap
    })
    render(<DeviceWizard onCreate={vi.fn()} onCancel={vi.fn()} />)
    expect(await screen.findByText(/SDK 尚未就绪/)).toBeTruthy()
    fireEvent.click(await screen.findByRole('button', { name: copy.sdkBootstrapAction }))
    // main 静默返回当前态 → 渲染层无错误、按钮恢复（画像重拉仍报未就绪，错误块保持原文）
    await waitFor(() => expect(bootstrap).toHaveBeenCalledTimes(1))
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: copy.sdkBootstrapAction }) as HTMLButtonElement)
          .disabled
      ).toBe(false)
    )
    expect(screen.queryByText(/SDK 引导失败/)).toBeNull()
    expect(screen.getByText(/SDK 尚未就绪/)).toBeTruthy()
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
    fireEvent.click(screen.getByRole('button', { name: copy.next }))
    expect(await screen.findByText('镜像清单拉取失败')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: copy.back }))
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
    fireEvent.click(screen.getByRole('button', { name: copy.next }))
    expect(screen.getByText(copy.loadingImages)).toBeTruthy()
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
    fireEvent.click(screen.getByRole('button', { name: downloadAria('35') }))
    expect((screen.getByRole('button', { name: copy.create }) as HTMLButtonElement).disabled).toBe(
      true
    )
    act(() => handle.emitProgress({ packageName: PKG_MISSING, percent: 60, message: '下载中' }))
    expect(screen.getByText('60%')).toBeTruthy()
    act(() => handle.emitProgress({ packageName: PKG_MISSING, percent: 100, message: '下载中' }))
    await waitFor(() => expect(imagesMock.mock.calls.length).toBeGreaterThanOrEqual(2))
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: copy.create }) as HTMLButtonElement).disabled
      ).toBe(false)
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
    fireEvent.click(screen.getByRole('button', { name: downloadAria('35') }))
    expect(await screen.findByText('网络中断')).toBeTruthy()
    expect(screen.getByRole('button', { name: copy.retryDownload })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: copy.retryDownload }))
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
    fireEvent.click(screen.getByRole('button', { name: downloadAria('35') }))
    act(() => handle.emitProgress({ packageName: PKG_MISSING, percent: 100, message: '下载中' }))
    expect(await screen.findByText('重拉失败')).toBeTruthy()
    expect(screen.getByText('API 36')).toBeTruthy()
    expect(screen.getByRole('button', { name: copy.retry })).toBeTruthy()
  })

  it('重开向导：清单带回进行中的下载 → 行显示进度、下载钮互斥、后续事件继续更新', async () => {
    // 场景：上个窗口发起下载后关闭——main 的任务仍在，重开拉清单带 activeDownload；
    // 任务完成后的重拉则不再携带（真实 main 的 activeDownload 已清空）
    let calls = 0
    const imagesMock = vi.fn(async () => {
      calls += 1
      return calls === 1
        ? catalogOf(IMAGES, { packageName: PKG_MISSING, percent: 42 })
        : catalogOf(
            IMAGES.map((entry) =>
              entry.packageName === PKG_MISSING ? { ...entry, installed: true } : entry
            )
          )
    })
    const handle = installSdkStub({ images: imagesMock })
    render(<DeviceWizard onCreate={vi.fn()} onCancel={vi.fn()} />)
    await screen.findByText('Pixel 8')
    gotoConfigure()
    fireEvent.click(screen.getByText('API 36'))
    // 恢复的进度立即可见（35 行的下载钮显示 42%）——后台任务续接，无需重发下载
    await waitFor(() => expect(screen.getByText('42%')).toBeTruthy())
    // 后续进度事件继续驱动同一任务
    act(() => handle.emitProgress({ packageName: PKG_MISSING, percent: 80, message: '下载中' }))
    expect(screen.getByText('80%')).toBeTruthy()
    // 完成事件重拉清单：任务清空、按钮恢复
    act(() => handle.emitProgress({ packageName: PKG_MISSING, percent: 100, message: '下载中' }))
    await waitFor(() => expect(imagesMock.mock.calls.length).toBeGreaterThanOrEqual(2))
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: copy.create }) as HTMLButtonElement).disabled
      ).toBe(false)
    )
  })

  it('后台下载失败广播：重开的向导显示错误与重试，下载状态解锁', async () => {
    const handle = installSdkStub({
      images: vi.fn(async () => catalogOf(IMAGES, { packageName: PKG_MISSING, percent: 60 }))
    })
    render(<DeviceWizard onCreate={vi.fn()} onCancel={vi.fn()} />)
    await screen.findByText('Pixel 8')
    gotoConfigure()
    await waitFor(() => expect(screen.getByText('60%')).toBeTruthy())
    // main 广播失败（发起窗口已关，错误经进度通道送达）
    act(() =>
      handle.emitProgress({
        packageName: PKG_MISSING,
        percent: 0,
        message: '下载失败',
        error: '网络中断'
      })
    )
    expect(await screen.findByText('网络中断')).toBeTruthy()
    expect(screen.getByRole('button', { name: copy.retryDownload })).toBeTruthy()
    expect(screen.queryByText('60%')).toBeNull()
  })

  it('取消下载：下载中显示取消钮，点击后状态清空、行回下载态、无错误横幅', async () => {
    const handle: { emitProgress: (progress: SdkImageProgress) => void } = {
      emitProgress: () => {}
    }
    const cancel = vi.fn(async () => {})
    ;(window as { api?: unknown }).api = {
      sdk: {
        profiles: vi.fn(async () => PROFILES),
        images: vi.fn(async () => catalogOf(IMAGES)),
        downloadImage: vi.fn(async () => {}),
        cancelDownloadImage: cancel,
        onImageProgress: (cb: (progress: SdkImageProgress) => void): (() => void) => {
          handle.emitProgress = cb
          return () => {}
        }
      }
    }
    render(<DeviceWizard onCreate={vi.fn()} onCancel={vi.fn()} />)
    await screen.findByText('Pixel 8')
    gotoConfigure()
    fireEvent.click(screen.getByRole('button', { name: downloadAria('35') }))
    act(() => handle.emitProgress({ packageName: PKG_MISSING, percent: 40, message: '下载中' }))
    fireEvent.click(screen.getByRole('button', { name: cancelDownloadAria('35') }))
    await waitFor(() => expect(cancel).toHaveBeenCalledWith(PKG_MISSING))
    await waitFor(() => expect(screen.queryByText('40%')).toBeNull())
    expect(screen.getByRole('button', { name: downloadAria('35') })).toBeTruthy()
    expect(screen.queryByRole('button', { name: copy.retryDownload })).toBeNull()
  })

  it('取消广播（重开窗场景）：清下载态且不显示错误横幅', async () => {
    const handle = installSdkStub({
      images: vi.fn(async () => catalogOf(IMAGES, { packageName: PKG_MISSING, percent: 55 }))
    })
    render(<DeviceWizard onCreate={vi.fn()} onCancel={vi.fn()} />)
    await screen.findByText('Pixel 8')
    gotoConfigure()
    await waitFor(() => expect(screen.getByText('55%')).toBeTruthy())
    // main 广播取消（发起端可能是已关闭的旧窗）
    act(() =>
      handle.emitProgress({
        packageName: PKG_MISSING,
        percent: 0,
        message: '已取消',
        canceled: true
      })
    )
    await waitFor(() => expect(screen.queryByText('55%')).toBeNull())
    expect(screen.queryByRole('button', { name: copy.retryDownload })).toBeNull()
    expect(screen.getByRole('button', { name: downloadAria('35') })).toBeTruthy()
  })

  it('已装行删除镜像：确认（注入场景直通）→ 调用卸载 → 成功后重拉清单', async () => {
    let calls = 0
    const imagesMock = vi.fn(async () => {
      calls += 1
      // 卸载后重拉：36 变未装（显示下载钮）
      return catalogOf(
        calls === 1
          ? IMAGES
          : IMAGES.map((entry) =>
              entry.packageName === PKG36 ? { ...entry, installed: false } : entry
            )
      )
    })
    const handle = installSdkStub({ images: imagesMock })
    render(
      <DeviceWizard
        onCreate={vi.fn()}
        onCancel={vi.fn()}
        // 模拟 main 时序：invoke 成功后发完成终态广播（清状态与重拉由订阅驱动）
        onUninstallImage={async () => {
          handle.emitUninstallState({ packageName: PKG36 })
        }}
      />
    )
    await screen.findByText('Pixel 8')
    gotoConfigure()
    fireEvent.click(screen.getByRole('button', { name: uninstallAria('36') }))
    await waitFor(() => expect(imagesMock.mock.calls.length).toBeGreaterThanOrEqual(2))
    // 重拉后 36 行回到下载态
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: downloadAria('36') }) as HTMLElement).getAttribute(
          'aria-disabled'
        )
      ).toBe('false')
    )
  })

  it('roving tabindex：↑↓ 行间移动焦点，非焦点行钮不在 Tab 序（review 遗留精修）', async () => {
    installSdkStub({})
    render(<DeviceWizard onCreate={vi.fn()} onCancel={vi.fn()} />)
    await screen.findByText('Pixel 8')
    gotoConfigure()
    const rowOf = (pkg: string): HTMLElement =>
      document.querySelector(`[data-image-package="${pkg}"]`) as HTMLElement
    const PKG35 = 'system-images;android-35;google_apis;arm64-v8a'
    // 初始：首行（36）可 Tab，第二行（35，未装行同样可聚焦）-1
    expect(rowOf(PKG36).getAttribute('tabindex')).toBe('0')
    expect(rowOf(PKG35).getAttribute('tabindex')).toBe('-1')
    // ↓ 移动焦点到 35 行：tabindex 随焦点行翻转
    fireEvent.keyDown(rowOf(PKG36), { key: 'ArrowDown' })
    expect(document.activeElement).toBe(rowOf(PKG35))
    expect(rowOf(PKG35).getAttribute('tabindex')).toBe('0')
    expect(rowOf(PKG36).getAttribute('tabindex')).toBe('-1')
    // 焦点行（35，未装）的下载钮可 Tab；36 行的删除钮 -1
    expect(
      (screen.getByRole('button', { name: downloadAria('35') }) as HTMLElement).getAttribute(
        'tabindex'
      )
    ).toBe('0')
    expect(
      (screen.getByRole('button', { name: uninstallAria('36') }) as HTMLElement).getAttribute(
        'tabindex'
      )
    ).toBe('-1')
  })

  it('删除 icon 键盘可达：Enter 触发卸载（review P3）', async () => {
    installSdkStub({})
    render(<DeviceWizard onCreate={vi.fn()} onCancel={vi.fn()} onUninstallImage={async () => {}} />)
    await screen.findByText('Pixel 8')
    gotoConfigure()
    const button = screen.getByRole('button', { name: uninstallAria('36') })
    fireEvent.keyDown(button, { key: 'Enter' })
    await waitFor(() => expect(button.getAttribute('aria-busy')).toBe('true'))
  })

  it('重开向导：清单带回进行中的卸载 → 该行 spinner、其余删除钮禁用、下载钮互斥', async () => {
    const imagesMock = vi.fn(async () => catalogOf(IMAGES, null, { packageName: PKG36 }))
    const handle = installSdkStub({ images: imagesMock })
    render(<DeviceWizard onCreate={vi.fn()} onCancel={vi.fn()} />)
    await screen.findByText('Pixel 8')
    gotoConfigure()
    // 恢复：36 行 aria-busy，34 行删除钮禁用且不 busy
    const busyRow = screen.getByRole('button', { name: uninstallAria('36') })
    await waitFor(() => expect(busyRow.getAttribute('aria-busy')).toBe('true'))
    const other = screen.getByRole('button', { name: uninstallAria('34') })
    expect(other.getAttribute('aria-disabled')).toBe('true')
    expect(other.getAttribute('aria-busy')).toBe('false')
    // 下载钮也感知卸载互斥
    expect(
      (screen.getByRole('button', { name: downloadAria('35') }) as HTMLElement).getAttribute(
        'aria-disabled'
      )
    ).toBe('true')
    // 卸载完成广播（后台 main 发出，重开窗口收到）→ 清状态 + 重拉
    act(() => handle.emitUninstallState({ packageName: PKG36 }))
    await waitFor(() => expect(busyRow.getAttribute('aria-busy')).toBe('false'))
    await waitFor(() => expect(imagesMock.mock.calls.length).toBeGreaterThanOrEqual(2))
  })

  it('后台卸载失败广播：重开的向导展示中文错误并解除 busy', async () => {
    const handle = installSdkStub({
      images: vi.fn(async () => catalogOf(IMAGES, null, { packageName: PKG36 }))
    })
    render(<DeviceWizard onCreate={vi.fn()} onCancel={vi.fn()} />)
    await screen.findByText('Pixel 8')
    gotoConfigure()
    const busyRow = screen.getByRole('button', { name: uninstallAria('36') })
    await waitFor(() => expect(busyRow.getAttribute('aria-busy')).toBe('true'))
    act(() =>
      handle.emitUninstallState({
        packageName: PKG36,
        error: 'sdkmanager --uninstall 超时（180 秒）'
      })
    )
    expect(await screen.findByText(/超时/)).toBeTruthy()
    expect(busyRow.getAttribute('aria-busy')).toBe('false')
  })

  it('卸载被拒（设备引用）：main 守卫文案直接展示，「知道了」可关闭', async () => {
    installSdkStub({})
    render(
      <DeviceWizard
        onCreate={vi.fn()}
        onCancel={vi.fn()}
        onUninstallImage={async () => {
          throw new Error('镜像正被设备引用（测试机 A），删除这些设备后才可卸载')
        }}
      />
    )
    await screen.findByText('Pixel 8')
    gotoConfigure()
    fireEvent.click(screen.getByRole('button', { name: uninstallAria('36') }))
    expect(await screen.findByText(/正被设备引用/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: copy.ok }))
    expect(screen.queryByText(/正被设备引用/)).toBeNull()
  })

  it('卸载进行中：删除钮显示「删除中…」且互斥', async () => {
    let resolveUninstall: () => void = () => {}
    installSdkStub({})
    render(
      <DeviceWizard
        onCreate={vi.fn()}
        onCancel={vi.fn()}
        onUninstallImage={() =>
          new Promise<void>((resolve) => {
            resolveUninstall = resolve
          })
        }
      />
    )
    await screen.findByText('Pixel 8')
    gotoConfigure()
    fireEvent.click(screen.getByRole('button', { name: uninstallAria('36') }))
    // 正在删的行：icon 变加载态（aria-busy）且禁用
    const busy = screen.getByRole('button', { name: uninstallAria('36') }) as HTMLElement
    await waitFor(() => expect(busy.getAttribute('aria-busy')).toBe('true'))
    expect(busy.getAttribute('aria-disabled')).toBe('true')
    // 其余已装行的删除 icon 同步互斥禁用
    const other = screen.getByRole('button', { name: uninstallAria('34') }) as HTMLElement
    expect(other.getAttribute('aria-disabled')).toBe('true')
    expect(other.getAttribute('aria-busy')).toBe('false')
    await act(async () => {
      resolveUninstall()
    })
  })

  it('下载同 tick 原生连点只触发一次下载（ref 守卫）', async () => {
    const downloadImage = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    installSdkStub({ downloadImage })
    render(<DeviceWizard onCreate={vi.fn()} onCancel={vi.fn()} />)
    await screen.findByText('Pixel 8')
    gotoConfigure()
    const button = screen.getByRole('button', { name: downloadAria('35') })
    fireEvent.click(button)
    fireEvent.click(button) // 同 tick 连点：downloadingRef 拦住第二次
    await waitFor(() => expect(downloadImage).toHaveBeenCalledTimes(1))
  })
})

describe('官方皮肤与摄像头新入口', () => {
  it('获取失败可重试，同 tick 连点只有一次请求，期间禁止创建', async () => {
    const pending = deferred<never>()
    const download = vi.fn(() => pending.promise)
    ;(window as { api?: unknown }).api = { sdk: { downloadDeviceSkin: download } }
    render(
      <DeviceWizard
        onCreate={vi.fn()}
        onCancel={vi.fn()}
        data={{ profiles: PROFILES, images: IMAGES }}
        onWizardCapabilities={async () => ({
          ...CAPABILITIES,
          recommendedSkin: { name: 'pixel_8', skinRef: null }
        })}
      />
    )
    gotoConfigure()
    fireEvent.click(screen.getByText('API 36'))
    fireEvent.click(screen.getByRole('tab', { name: copy.tabSettings }))
    const button = await screen.findByRole('button', {
      name: new RegExp(format(copy.fetchOfficialSkin, { name: 'pixel_8' }))
    })
    fireEvent.click(button)
    fireEvent.click(button)
    expect(download).toHaveBeenCalledTimes(1)
    expect((screen.getByRole('button', { name: copy.create }) as HTMLButtonElement).disabled).toBe(
      true
    )
    await act(async () => {
      pending.reject(new Error('官方源连接失败'))
      await pending.promise.catch(() => {})
    })
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', '官方源连接失败')
    expect(
      (
        screen.getByRole('button', {
          name: new RegExp(format(copy.fetchOfficialSkin, { name: 'pixel_8' }))
        }) as HTMLButtonElement
      ).disabled
    ).toBe(false)
  })
  it('摄像头刷新保留用户 CPU 设置，选择友好名称回传稳定宿主 id', async () => {
    const onCreate = vi.fn<(input: unknown) => Promise<void>>(async () => {})
    const snapshot = {
      permission: 'granted' as const,
      devices: [{ id: 'webcam0', name: 'MacBook Pro 相机', deviceLabel: 'host-a' }],
      error: null
    }
    ;(window as { api?: unknown }).api = { sdk: { cameraAccess: vi.fn(async () => snapshot) } }
    render(
      <DeviceWizard
        onCreate={onCreate}
        onCancel={vi.fn()}
        data={{ profiles: PROFILES, images: IMAGES }}
        onWizardCapabilities={async () => ({
          ...CAPABILITIES,
          cameraSnapshot: snapshot,
          webcamDeviceIds: ['webcam0']
        })}
      />
    )
    gotoConfigure()
    fireEvent.click(screen.getByText('API 36'))
    fireEvent.click(screen.getByRole('tab', { name: copy.tabSettings }))
    const cpu = await screen.findByLabelText(copy.fieldCpuCores, { exact: false })
    fireEvent.change(cpu, { target: { value: '6' } })
    fireEvent.click(screen.getByRole('button', { name: copy.refreshCamera }))
    await screen.findByRole('button', { name: copy.refreshCamera })
    expect((cpu as HTMLInputElement).value).toBe('6')
    fireEvent.change(screen.getByLabelText(copy.fieldFrontCamera), { target: { value: 'webcam0' } })
    fireEvent.click(screen.getByRole('button', { name: copy.create }))
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1))
    expect(onCreate.mock.calls[0][0]).toMatchObject({
      advancedSettings: {
        cpuCores: 6,
        frontCamera: { deviceId: 'webcam0', hostDeviceId: 'host-a' }
      }
    })
  })
})

it('缓存默认皮肤不覆盖同机型换镜像前明确选择的通用外框', async () => {
  const onCreate = vi.fn<(input: unknown) => Promise<void>>(async () => {})
  const capabilities = {
    ...CAPABILITIES,
    defaults: { ...CAPABILITIES.defaults, skinRef: 'downloaded:cache' },
    skinIds: ['downloaded:cache'],
    fields: {
      ...CAPABILITIES.fields,
      skinRef: { disabledReason: null, min: null, max: null, step: null }
    }
  }
  render(
    <DeviceWizard
      onCreate={onCreate}
      onCancel={vi.fn()}
      data={{ profiles: PROFILES, images: IMAGES }}
      onWizardCapabilities={async () => capabilities}
    />
  )
  gotoConfigure()
  fireEvent.click(screen.getByText('API 36'))
  fireEvent.click(screen.getByRole('tab', { name: copy.tabSettings }))
  fireEvent.change(await screen.findByLabelText(copy.fieldSkinRef), { target: { value: '' } })
  fireEvent.click(screen.getByRole('tab', { name: copy.tabDevice }))
  fireEvent.click(screen.getByText('API 34'))
  await waitFor(() =>
    expect((screen.getByRole('button', { name: copy.create }) as HTMLButtonElement).disabled).toBe(
      false
    )
  )
  fireEvent.click(screen.getByRole('button', { name: copy.create }))
  await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1))
  expect(onCreate.mock.calls[0][0]).toMatchObject({ advancedSettings: { skinRef: null } })
})

describe('取消皮肤操作不是失败（review P3：null 哨兵静默早退）', () => {
  const openAdvanced = async (): Promise<HTMLSelectElement> => {
    gotoConfigure()
    fireEvent.click(screen.getByText('API 36'))
    fireEvent.click(screen.getByRole('tab', { name: copy.tabSettings }))
    return (await screen.findByLabelText(copy.fieldSkinRef)) as HTMLSelectElement
  }

  it('获取官方皮肤时同意框取消（resolve null）：无失败警示、字段不解锁、创建不受阻', async () => {
    const download = vi.fn(async () => null)
    ;(window as { api?: unknown }).api = { sdk: { downloadDeviceSkin: download } }
    render(
      <DeviceWizard
        onCreate={vi.fn()}
        onCancel={vi.fn()}
        data={{ profiles: PROFILES, images: IMAGES }}
        onWizardCapabilities={async () => ({
          ...CAPABILITIES,
          recommendedSkin: { name: 'pixel_8', skinRef: null }
        })}
      />
    )
    const skinSelect = await openAdvanced()
    expect(skinSelect.disabled).toBe(true)
    fireEvent.click(
      screen.getByRole('button', {
        name: new RegExp(format(copy.fetchOfficialSkin, { name: 'pixel_8' }))
      })
    )
    await waitFor(() => expect(download).toHaveBeenCalledTimes(1))
    await act(async () => {})
    expect(screen.queryByRole('alert')).toBeNull()
    // 取消不是入库成功：不 absorb、不解锁字段
    expect(skinSelect.disabled).toBe(true)
    expect(
      (
        screen.getByRole('button', {
          name: new RegExp(format(copy.fetchOfficialSkin, { name: 'pixel_8' }))
        }) as HTMLButtonElement
      ).disabled
    ).toBe(false)
    expect((screen.getByRole('button', { name: copy.create }) as HTMLButtonElement).disabled).toBe(
      false
    )
  })

  it('导入压缩包时取消选择器（resolve null）：无失败警示、字段不解锁', async () => {
    const choose = vi.fn(async () => null)
    ;(window as { api?: unknown }).api = { sdk: { chooseDeviceSkin: choose } }
    render(
      <DeviceWizard
        onCreate={vi.fn()}
        onCancel={vi.fn()}
        data={{ profiles: PROFILES, images: IMAGES }}
        onWizardCapabilities={async () => CAPABILITIES}
      />
    )
    const skinSelect = await openAdvanced()
    expect(skinSelect.disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: copy.importArchive }))
    await waitFor(() => expect(choose).toHaveBeenCalledTimes(1))
    await act(async () => {})
    expect(screen.queryByRole('alert')).toBeNull()
    expect(skinSelect.disabled).toBe(true)
    expect(
      (screen.getByRole('button', { name: copy.importArchive }) as HTMLButtonElement).disabled
    ).toBe(false)
  })
})

describe('DeviceWizard 共享 Studio SDK 收窄（plan 2026-10-12）', () => {
  const OLD_NEXUS = profile({ id: 'old_nexus', name: 'Old Nexus', apiMax: 30 })
  const SHARED_PROFILES = [PROFILES[0], OLD_NEXUS]
  const sharedCatalog = (images: ImageEntry[]): ImageCatalogResult =>
    catalogOf(images, null, null, 'shared-studio')
  const SHARED_IMAGES = [
    image({ apiMajor: 36, installed: false }),
    image({ apiMajor: 34, installed: true })
  ]

  it('win32 注入：宿主 ABI verdict 切 x86_64——仅有 arm64 镜像的画像全隐藏（P5 review P3-3 接线直测）', async () => {
    installSdkStub({
      profiles: vi.fn(async () => SHARED_PROFILES),
      images: vi.fn(async () => sharedCatalog(SHARED_IMAGES))
    })
    const api = (window as { api: { platform: string } }).api
    const original = api.platform
    api.platform = 'win32'
    try {
      render(<DeviceWizard onCreate={vi.fn()} onCancel={vi.fn()} />)
      await screen.findByText(format(copy.sharedModeFilteredProfiles, { count: 2 }))
      // Pixel 8（有 arm64 镜像但不匹配 x86_64 宿主）与 Old Nexus（API 超范围）都不可见
      expect(screen.queryByText('Pixel 8')).toBeNull()
      expect(screen.queryByText('Old Nexus')).toBeNull()
    } finally {
      api.platform = original
    }
  })

  it('画像页：不匹配画像（API 超范围）隐藏 + 提示行含隐藏计数 + 零类别导航隐藏', async () => {
    installSdkStub({
      profiles: vi.fn(async () => SHARED_PROFILES),
      images: vi.fn(async () => sharedCatalog(SHARED_IMAGES))
    })
    render(<DeviceWizard onCreate={vi.fn()} onCancel={vi.fn()} />)
    await screen.findByText('Pixel 8')
    expect(screen.queryByText('Old Nexus')).toBeNull()
    expect(screen.getByText(format(copy.sharedModeFilteredProfiles, { count: 1 }))).toBeTruthy()
    // 两个可用画像均为 phone：共享态隐藏零画像类别（tablet 不出现）
    expect(screen.getByLabelText(copy.profileCategoryAria)).toBeTruthy()
    expect(screen.queryByText(formFactorLabel(copy, 'tablet'))).toBeNull()
  })

  it('镜像页：无服务筛选/三开关/下载/卸载入口，仅列已装行且单行自动选中', async () => {
    installSdkStub({
      profiles: vi.fn(async () => SHARED_PROFILES),
      images: vi.fn(async () => sharedCatalog(SHARED_IMAGES))
    })
    render(<DeviceWizard onCreate={vi.fn()} onCancel={vi.fn()} />)
    await screen.findByText(format(copy.sharedModeFilteredProfiles, { count: 1 }))
    gotoConfigure()
    // 仅 API 34 已装：API 36（未装）不出现（自动选中后摘要区也带出 API 34——多处出现）
    await waitFor(() => {
      expect(screen.getAllByText('API 34').length).toBeGreaterThan(0)
    })
    expect(screen.queryByText('API 36')).toBeNull()
    // 共享提示行替代筛选工具条
    expect(screen.getByText(format(copy.sharedModeImagesHint, { count: 1 }))).toBeTruthy()
    expect(screen.queryByLabelText(copy.serviceFilterAria)).toBeNull()
    expect(screen.queryByLabelText(copy.fullList)).toBeNull()
    expect(screen.queryByLabelText('Preview')).toBeNull()
    expect(screen.queryByLabelText(copy.unsupportedToggle)).toBeNull()
    expect(screen.queryByRole('button', { name: downloadAria('34') })).toBeNull()
    expect(screen.queryByRole('button', { name: uninstallAria('34') })).toBeNull()
    // 单一可用镜像自动选中（设计轴 3）：名称输入框带出「Pixel 8 API 34」
    expect((screen.getByLabelText(copy.nameLabel) as HTMLInputElement).value).toBe('Pixel 8 API 34')
  })

  it('共享根无任何已装镜像：画像页整页空态引导，无类别导航', async () => {
    installSdkStub({
      profiles: vi.fn(async () => SHARED_PROFILES),
      images: vi.fn(async () => sharedCatalog([]))
    })
    render(<DeviceWizard onCreate={vi.fn()} onCancel={vi.fn()} />)
    await screen.findByText(copy.sharedModeNoImages)
    expect(screen.queryByPlaceholderText(copy.searchPlaceholder)).toBeNull()
    expect(screen.queryByText('Pixel 8')).toBeNull()
  })

  it('managed（清单未带来源标记）行为不变：未装镜像可见且带下载入口', async () => {
    installSdkStub({
      profiles: vi.fn(async () => SHARED_PROFILES),
      images: vi.fn(async () => catalogOf(IMAGES))
    })
    render(<DeviceWizard onCreate={vi.fn()} onCancel={vi.fn()} />)
    await screen.findByText('Old Nexus')
    gotoConfigure()
    expect(await screen.findByText('API 36')).toBeTruthy()
    expect(screen.getByLabelText(copy.serviceFilterAria)).toBeTruthy()
  })
})
