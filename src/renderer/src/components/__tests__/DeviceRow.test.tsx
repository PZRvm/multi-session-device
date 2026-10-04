import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { Device } from '@shared/types'
import DeviceRow from '../DeviceRow'

// vitest 未开 globals，RTL 的自动 cleanup 不注册——显式清理防多次 render 堆叠
afterEach(cleanup)

const baseDevice: Device = {
  id: 'd1',
  name: 'Pixel 8 API 34',
  profileId: 'pixel_8',
  profileLabel: 'Pixel 8',
  apiLevel: 34,
  variant: 'google_apis',
  createdAt: 0,
  status: 'stopped'
}

type SetupOptions = {
  device?: Device
  selected?: boolean
}

type SetupHandlers = {
  onSelect: Mock<() => void>
  onStart: Mock<() => void>
  onStop: Mock<() => void>
  onCancelStart: Mock<() => void>
  onCopySerial: Mock<() => void>
  onDelete: Mock<() => void>
  onRename: Mock<(name: string) => void>
}

const setup = ({ device = baseDevice, selected = false }: SetupOptions = {}): SetupHandlers => {
  const handlers: SetupHandlers = {
    onSelect: vi.fn(),
    onStart: vi.fn(),
    onStop: vi.fn(),
    onCancelStart: vi.fn(),
    onCopySerial: vi.fn(),
    onDelete: vi.fn(),
    onRename: vi.fn()
  }
  render(
    <DeviceRow
      device={device}
      selected={selected}
      onSelect={handlers.onSelect}
      onStart={handlers.onStart}
      onStop={handlers.onStop}
      onCancelStart={handlers.onCancelStart}
      onCopySerial={handlers.onCopySerial}
      onDelete={handlers.onDelete}
      onRename={handlers.onRename}
    />
  )
  return handlers
}

describe('DeviceRow', () => {
  it('渲染名称、画像 · API · 状态副行与状态点', () => {
    setup()
    expect(screen.getByText('Pixel 8 API 34')).toBeTruthy()
    expect(screen.getByText('Pixel 8 · API 34 · 停止')).toBeTruthy()
    expect(screen.getByRole('img', { name: '状态：停止' })).toBeTruthy()
  })

  it('停止态：启动钮回调 onStart；删除可用', () => {
    const { onStart } = setup()
    fireEvent.click(screen.getByRole('button', { name: '启动 Pixel 8 API 34' }))
    expect(onStart).toHaveBeenCalledTimes(1)
    expect(
      (screen.getByRole('button', { name: '删除 Pixel 8 API 34' }) as HTMLButtonElement).disabled
    ).toBe(false)
  })

  it('运行态：副行带 serial；停止/复制 serial/删除可用', () => {
    const { onStop, onCopySerial } = setup({
      device: { ...baseDevice, status: 'running', serial: 'emulator-5554' }
    })
    expect(screen.getByText('Pixel 8 · API 34 · emulator-5554')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '停止 Pixel 8 API 34' }))
    expect(onStop).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: '复制 serial（emulator-5554）' }))
    expect(onCopySerial).toHaveBeenCalledTimes(1)
  })

  it('启动中：忙态 + 取消启动钮；删除禁用', () => {
    const { onCancelStart } = setup({
      device: { ...baseDevice, status: 'starting', serial: 'emulator-5554' }
    })
    expect(screen.getByRole('img', { name: '启动中 Pixel 8 API 34' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '取消启动 Pixel 8 API 34' }))
    expect(onCancelStart).toHaveBeenCalledTimes(1)
    expect(
      (screen.getByRole('button', { name: '删除 Pixel 8 API 34' }) as HTMLButtonElement).disabled
    ).toBe(true)
  })

  it('停止中：重试停止入口在；删除禁用；lastError 行内可见', () => {
    const { onStop } = setup({
      device: {
        ...baseDevice,
        status: 'stopping',
        lastError: { code: 'stop-failed', message: '停止失败：停止超时' }
      }
    })
    expect(screen.getByText('停止失败：停止超时')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '重试停止 Pixel 8 API 34' }))
    expect(onStop).toHaveBeenCalledTimes(1)
    expect(
      (screen.getByRole('button', { name: '删除 Pixel 8 API 34' }) as HTMLButtonElement).disabled
    ).toBe(true)
  })

  it('创建中/删除中：无启停钮、删除禁用、双击不进重命名', () => {
    for (const status of ['creating', 'deleting'] as const) {
      setup({ device: { ...baseDevice, status } })
      expect(screen.queryByRole('button', { name: '启动 Pixel 8 API 34' })).toBeNull()
      expect(
        (screen.getByRole('button', { name: '删除 Pixel 8 API 34' }) as HTMLButtonElement).disabled
      ).toBe(true)
      fireEvent.doubleClick(screen.getByText('Pixel 8 API 34'))
      expect(screen.queryByLabelText('重命名设备')).toBeNull()
      cleanup()
    }
  })

  it('点删除钮回调 onDelete；行点击回调 onSelect', () => {
    const { onDelete, onSelect } = setup()
    fireEvent.click(screen.getByRole('button', { name: '删除 Pixel 8 API 34' }))
    expect(onDelete).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByText('Pixel 8 API 34'))
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it('键盘语义：Enter / 空格选中行', () => {
    const { onSelect } = setup()
    const row = screen.getByText('Pixel 8 API 34').parentElement!
    fireEvent.keyDown(row, { key: 'Enter' })
    fireEvent.keyDown(row, { key: ' ' })
    expect(onSelect).toHaveBeenCalledTimes(2)
  })

  it('选中态：aria-current 上行', () => {
    setup({ selected: true })
    expect(screen.getByText('Pixel 8 API 34').closest('div')?.getAttribute('aria-current')).toBe(
      'true'
    )
  })

  describe('行内重命名', () => {
    it('双击行进入重命名：输入框出现、回填现名、自动聚焦', () => {
      setup()
      fireEvent.doubleClick(screen.getByText('Pixel 8 API 34'))
      const input = screen.getByLabelText('重命名设备') as HTMLInputElement
      expect(input.value).toBe('Pixel 8 API 34')
      expect(document.activeElement).toBe(input)
    })

    it('Enter 提交修剪后的新名并退出重命名', () => {
      const { onRename } = setup()
      fireEvent.doubleClick(screen.getByText('Pixel 8 API 34'))
      const input = screen.getByLabelText('重命名设备')
      fireEvent.change(input, { target: { value: '  新名字  ' } })
      fireEvent.keyDown(input, { key: 'Enter' })
      expect(onRename).toHaveBeenCalledWith('新名字')
      expect(screen.queryByLabelText('重命名设备')).toBeNull()
    })

    it('Escape 取消：不回调 onRename', () => {
      const { onRename } = setup()
      fireEvent.doubleClick(screen.getByText('Pixel 8 API 34'))
      const input = screen.getByLabelText('重命名设备')
      fireEvent.change(input, { target: { value: '改名' } })
      fireEvent.keyDown(input, { key: 'Escape' })
      expect(onRename).not.toHaveBeenCalled()
      expect(screen.queryByLabelText('重命名设备')).toBeNull()
    })

    it('空/纯空白名不提交', () => {
      const { onRename } = setup()
      fireEvent.doubleClick(screen.getByText('Pixel 8 API 34'))
      const input = screen.getByLabelText('重命名设备')
      fireEvent.change(input, { target: { value: '   ' } })
      fireEvent.keyDown(input, { key: 'Enter' })
      expect(onRename).not.toHaveBeenCalled()
    })

    it('失焦提交；与原名相同不提交', () => {
      const { onRename } = setup()
      fireEvent.doubleClick(screen.getByText('Pixel 8 API 34'))
      const input = screen.getByLabelText('重命名设备')
      fireEvent.change(input, { target: { value: '失焦改名' } })
      fireEvent.blur(input)
      expect(onRename).toHaveBeenCalledWith('失焦改名')

      // 组件不持有提交结果（改名走回调由父级落库），再次双击回填的仍是现 prop 名；
      // 与原名相同的提交视为无变化
      fireEvent.doubleClick(screen.getByText('Pixel 8 API 34'))
      fireEvent.blur(screen.getByLabelText('重命名设备'))
      expect(onRename).toHaveBeenCalledTimes(1)
    })
  })
})
