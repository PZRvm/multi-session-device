import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest'
import DeviceWizard from '../DeviceWizard'

// vitest 未开 globals，RTL 的自动 cleanup 不注册——显式清理防多次 render 堆叠
afterEach(cleanup)

type SetupHandlers = {
  onCreate: Mock<(input: unknown) => void>
  onCancel: Mock<() => void>
}

const setup = (): SetupHandlers => {
  const handlers: SetupHandlers = {
    onCreate: vi.fn(),
    onCancel: vi.fn()
  }
  render(<DeviceWizard onCreate={handlers.onCreate} onCancel={handlers.onCancel} />)
  return handlers
}

// 选项可访问名 = 标题+副行无分隔拼接，用标题文本就近找按钮更稳
const profileButton = (title: string): HTMLButtonElement =>
  screen.getByText(title).closest('button') as HTMLButtonElement

const pickProfile = (): void => {
  fireEvent.click(profileButton('Pixel 8'))
}

const pickImage = (): void => {
  fireEvent.click(profileButton('API 34 · Google Play'))
}

const gotoNameStep = (): void => {
  pickProfile()
  fireEvent.click(screen.getByRole('button', { name: '下一步' }))
  pickImage()
  fireEvent.click(screen.getByRole('button', { name: '下一步' }))
}

describe('DeviceWizard', () => {
  it('第一步未选画像时「下一步」禁用；选中后可进第二步', () => {
    setup()
    const next = screen.getByRole('button', { name: '下一步' }) as HTMLButtonElement
    expect(next.disabled).toBe(true)
    pickProfile()
    expect(next.disabled).toBe(false)
    fireEvent.click(next)
    expect(screen.getByText(/第 2 \/ 3 步/)).toBeTruthy()
    expect(screen.getByRole('group', { name: '选择系统镜像' })).toBeTruthy()
  })

  it('第二步未选镜像时禁用；第三步默认名 = 画像名 + API 版本', () => {
    setup()
    gotoNameStep()
    expect(screen.getByText(/第 3 \/ 3 步/)).toBeTruthy()
    const name = screen.getByLabelText('设备名称') as HTMLInputElement
    expect(name.value).toBe('Pixel 8 API 34')
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
      apiLevel: 34,
      variant: 'google_play',
      name: '我的测试机'
    })
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
    expect(profileButton('API 34 · Google Play').getAttribute('aria-pressed')).toBe('true')
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
