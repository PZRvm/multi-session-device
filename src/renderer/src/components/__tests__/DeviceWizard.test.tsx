import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { DeviceProfile, ImageEntry } from '@shared/types'
import DeviceWizard from '../DeviceWizard'

// vitest 未开 globals，RTL 的自动 cleanup 不注册——显式清理防多次 render 堆叠
afterEach(cleanup)

const PROFILES: DeviceProfile[] = [
  { id: 'pixel_8', name: 'Pixel 8' },
  { id: 'pixel_tablet', name: 'Pixel Tablet' }
]

const image = (overrides: Partial<ImageEntry>): ImageEntry => ({
  packageName: `system-images;android-${overrides.apiLevel ?? 36};google_apis_playstore;arm64-v8a`,
  apiLevel: 36,
  variant: 'google_play',
  abi: 'arm64-v8a',
  installed: true,
  sizeBytes: 1_500_000_000,
  ...overrides
})

const IMAGES: ImageEntry[] = [
  image({ apiLevel: 36, variant: 'google_play', installed: true }),
  image({
    apiLevel: 35,
    variant: 'google_apis',
    packageName: 'system-images;android-35;google_apis;arm64-v8a',
    installed: false,
    sizeBytes: 1_300_000_000
  }),
  image({ apiLevel: 34, variant: 'google_play', installed: true })
]

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
      apiLevel: 36,
      variant: 'google_play',
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
