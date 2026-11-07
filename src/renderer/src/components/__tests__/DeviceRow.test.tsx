import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach } from 'vitest'
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { Device } from '@shared/types'
import DeviceRow from '../DeviceRow'
import { MAIN_COPY, format } from '@shared/i18n'
const copy = MAIN_COPY['zh-CN']

// vitest 未开 globals，RTL 的自动 cleanup 不注册——显式清理防多次 render 堆叠
afterEach(cleanup)

const baseDevice: Device = {
  id: 'd1',
  name: 'Pixel 8 API 34',
  profileId: 'pixel_8',
  profileLabel: 'Pixel 8',
  imagePackageName: 'system-images;android-34;google_apis;arm64-v8a',
  apiDisplay: '34',
  formFactor: 'phone',
  screenSummary: { widthPx: 1080, heightPx: 2400, diagonalInches: 6.2 },
  advancedSettings: null,
  snapshotReadyAt: null,
  createdAt: 0,
  availability: { state: 'valid', issues: [], checkedAt: 1 },
  status: 'stopped'
}

type SetupOptions = {
  device?: Device
  selected?: boolean
  storeTrusted?: boolean
  metaWritable?: boolean
}

type SetupHandlers = {
  onSelect: Mock<() => void>
  onStart: Mock<() => void>
  onStop: Mock<() => void>
  onCancelStart: Mock<() => void>
  onHibernate: Mock<() => void>
  onResume: Mock<() => void>
  onCopySerial: Mock<() => void>
  onDelete: Mock<() => void>
  onRename: Mock<(name: string) => void>
  onEdit: Mock<() => void>
}

const setup = ({
  device = baseDevice,
  selected = false,
  storeTrusted = true,
  metaWritable = true
}: SetupOptions = {}): SetupHandlers => {
  const handlers: SetupHandlers = {
    onSelect: vi.fn(),
    onStart: vi.fn(),
    onStop: vi.fn(),
    onCancelStart: vi.fn(),
    onHibernate: vi.fn(),
    onResume: vi.fn(),
    onCopySerial: vi.fn(),
    onDelete: vi.fn(),
    onRename: vi.fn(),
    onEdit: vi.fn()
  }
  render(
    <DeviceRow
      device={device}
      selected={selected}
      storeTrusted={storeTrusted}
      metaWritable={metaWritable}
      onSelect={handlers.onSelect}
      onStart={handlers.onStart}
      onStop={handlers.onStop}
      onCancelStart={handlers.onCancelStart}
      onHibernate={handlers.onHibernate}
      onResume={handlers.onResume}
      onCopySerial={handlers.onCopySerial}
      onDelete={handlers.onDelete}
      onRename={handlers.onRename}
      onEdit={handlers.onEdit}
    />
  )
  return handlers
}

/** 悬停行内图标后读取气泡全文（PopoverIconButton 的 portal tooltip） */
const popoverTextOf = async (label: string): Promise<string> => {
  const button = screen.getByRole('button', { name: label })
  fireEvent.mouseEnter(button.closest('.popover-icon-wrap')!)
  await vi.waitFor(() => expect(screen.getByRole('tooltip')).toBeTruthy())
  const text = screen.getByRole('tooltip').textContent ?? ''
  fireEvent.mouseLeave(button.closest('.popover-icon-wrap')!)
  return text
}

describe('DeviceRow', () => {
  it('渲染名称、画像 · API · 状态副行与状态点', () => {
    setup()
    expect(screen.getByText('Pixel 8 API 34')).toBeTruthy()
    expect(screen.getByText('Pixel 8 · API 34 · ' + copy.statusStopped)).toBeTruthy()
    expect(
      screen.getByRole('img', { name: format(copy.statusAria, { status: copy.statusStopped }) })
    ).toBeTruthy()
  })

  it('停止态：启动钮回调 onStart；删除可用', () => {
    const { onStart } = setup()
    fireEvent.click(
      screen.getByRole('button', { name: format(copy.startAria, { name: 'Pixel 8 API 34' }) })
    )
    expect(onStart).toHaveBeenCalledTimes(1)
    expect(
      (
        screen.getByRole('button', {
          name: format(copy.deleteAria, { name: 'Pixel 8 API 34' })
        }) as HTMLButtonElement
      ).disabled
    ).toBe(false)
  })

  it('运行态：副行带 serial；停止/复制 serial/删除可用', () => {
    const { onStop, onCopySerial } = setup({
      device: { ...baseDevice, status: 'running', serial: 'emulator-5554' }
    })
    expect(screen.getByText('Pixel 8 · API 34 · emulator-5554')).toBeTruthy()
    fireEvent.click(
      screen.getByRole('button', { name: format(copy.stopAria, { name: 'Pixel 8 API 34' }) })
    )
    expect(onStop).toHaveBeenCalledTimes(1)
    fireEvent.click(
      screen.getByRole('button', { name: format(copy.copySerialAria, { serial: 'emulator-5554' }) })
    )
    expect(onCopySerial).toHaveBeenCalledTimes(1)
  })

  it('启动中：忙态 + 取消启动钮；删除禁用', () => {
    const { onCancelStart } = setup({
      device: { ...baseDevice, status: 'starting', serial: 'emulator-5554' }
    })
    // 语义落在与按钮同尺寸的非交互槽位上，旋转 SVG 自身退为装饰
    const busy = screen.getByRole('img', {
      name: format(copy.startingAria, { name: 'Pixel 8 API 34' })
    })
    expect(busy.tagName).toBe('SPAN')
    expect(busy.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
    fireEvent.click(
      screen.getByRole('button', { name: format(copy.cancelStartAria, { name: 'Pixel 8 API 34' }) })
    )
    expect(onCancelStart).toHaveBeenCalledTimes(1)
    // stopped-only 删除入口（plan 2026-11-06 设计 E）：启动中无删除按钮（非禁用）
    expect(
      screen.queryByRole('button', { name: format(copy.deleteAria, { name: 'Pixel 8 API 34' }) })
    ).toBeNull()
  })

  it('停止中：重试停止入口在；无删除入口；lastError 行内可见', () => {
    const { onStop } = setup({
      device: {
        ...baseDevice,
        status: 'stopping',
        lastError: { code: 'stop-failed', message: '停止失败：停止超时' }
      }
    })
    expect(screen.getByText('停止失败：停止超时')).toBeTruthy()
    fireEvent.click(
      screen.getByRole('button', { name: format(copy.retryStopAria, { name: 'Pixel 8 API 34' }) })
    )
    expect(onStop).toHaveBeenCalledTimes(1)
    expect(
      screen.queryByRole('button', { name: format(copy.deleteAria, { name: 'Pixel 8 API 34' }) })
    ).toBeNull()
  })

  it('摄像头回退通知行内可见（启动仲裁命中的运行会话提示）', () => {
    setup({
      device: {
        ...baseDevice,
        status: 'running',
        cameraNotice: '前置摄像头被设备「先启机」占用，本次以模拟画面运行'
      }
    })
    expect(screen.getByText('前置摄像头被设备「先启机」占用，本次以模拟画面运行')).toBeTruthy()
  })

  it('创建中/删除中：无启停钮、无删除入口、双击不进重命名', () => {
    for (const status of ['creating', 'deleting'] as const) {
      setup({ device: { ...baseDevice, status } })
      expect(
        screen.queryByRole('button', { name: format(copy.startAria, { name: 'Pixel 8 API 34' }) })
      ).toBeNull()
      expect(
        screen.queryByRole('button', {
          name: format(copy.deleteAria, { name: 'Pixel 8 API 34' })
        })
      ).toBeNull()
      fireEvent.doubleClick(screen.getByText('Pixel 8 API 34'))
      expect(screen.queryByLabelText(copy.renameAria)).toBeNull()
      cleanup()
    }
  })

  it('点删除钮回调 onDelete；行点击回调 onSelect', () => {
    const { onDelete, onSelect } = setup()
    fireEvent.click(
      screen.getByRole('button', { name: format(copy.deleteAria, { name: 'Pixel 8 API 34' }) })
    )
    expect(onDelete).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByText('Pixel 8 API 34'))
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  describe('文件健康（对账）', () => {
    it('missing：健康原因行可见；停止态启动钮禁用并说明', async () => {
      const { onStart } = setup({
        device: {
          ...baseDevice,
          availability: {
            state: 'missing',
            issues: [
              {
                component: 'avd',
                code: 'ini-missing',
                message: '缺少 d1.ini（AVD 可能被外部删除）',
                severity: 'error'
              }
            ],
            checkedAt: 2
          }
        }
      })
      expect(
        screen.getByText(`${copy.availMissing}：缺少 d1.ini（AVD 可能被外部删除）`)
      ).toBeTruthy()
      const start = screen.getByRole('button', {
        name: format(copy.startAria, { name: 'Pixel 8 API 34' })
      }) as HTMLButtonElement
      expect(start.disabled).toBe(true)
      expect(await popoverTextOf(format(copy.startAria, { name: 'Pixel 8 API 34' }))).toContain(
        '重新检查'
      )
      fireEvent.click(start)
      expect(onStart).not.toHaveBeenCalled()
    })

    it('checking：停止态启动禁用（检查完成前不放行）', async () => {
      const { onStart } = setup({
        device: {
          ...baseDevice,
          availability: { state: 'checking', issues: [], checkedAt: null }
        }
      })
      const start = screen.getByRole('button', {
        name: format(copy.startAria, { name: 'Pixel 8 API 34' })
      }) as HTMLButtonElement
      expect(start.disabled).toBe(true)
      fireEvent.click(start)
      expect(onStart).not.toHaveBeenCalled()
    })

    it('运行中文件异常：停止/复制入口保留，原因行可见（不清画面）', async () => {
      const { onStop } = setup({
        device: {
          ...baseDevice,
          status: 'running',
          serial: 'emulator-5554',
          availability: {
            state: 'broken',
            issues: [
              {
                component: 'avd',
                code: 'config-conflict',
                message: 'config.ini 的 hw.lcd.width 存在冲突的重复值',
                severity: 'error'
              }
            ],
            checkedAt: 3
          }
        }
      })
      expect(screen.getByText(/存在冲突的重复值/)).toBeTruthy()
      fireEvent.click(
        screen.getByRole('button', { name: format(copy.stopAria, { name: 'Pixel 8 API 34' }) })
      )
      expect(onStop).toHaveBeenCalledTimes(1)
    })

    it('库不可信（store error）：停止态启动禁用', async () => {
      const { onStart } = setup({ storeTrusted: false })
      const start = screen.getByRole('button', {
        name: format(copy.startAria, { name: 'Pixel 8 API 34' })
      }) as HTMLButtonElement
      expect(start.disabled).toBe(true)
      fireEvent.click(start)
      expect(onStart).not.toHaveBeenCalled()
    })

    it('库只读（read-only）：删除禁用并说明；双击/F2 不进重命名', async () => {
      setup({ metaWritable: false })
      const del = screen.getByRole('button', {
        name: format(copy.deleteAria, { name: 'Pixel 8 API 34' })
      }) as HTMLButtonElement
      expect(del.disabled).toBe(true)
      expect(await popoverTextOf(format(copy.deleteAria, { name: 'Pixel 8 API 34' }))).toContain(
        '冻结'
      )
      fireEvent.doubleClick(screen.getByText('Pixel 8 API 34'))
      expect(screen.queryByLabelText(copy.renameAria)).toBeNull()
      fireEvent.keyDown(screen.getByText('Pixel 8 API 34').parentElement!, { key: 'F2' })
      expect(screen.queryByLabelText(copy.renameAria)).toBeNull()
    })
  })

  it('键盘语义：Enter / 空格选中行', () => {
    const { onSelect } = setup()
    const row = screen.getByText('Pixel 8 API 34').parentElement!
    fireEvent.keyDown(row, { key: 'Enter' })
    fireEvent.keyDown(row, { key: ' ' })
    expect(onSelect).toHaveBeenCalledTimes(2)
  })

  it('键盘可达性：行声明 aria-keyshortcuts="F2"', () => {
    setup()
    expect(
      screen.getByText('Pixel 8 API 34').closest('div')?.getAttribute('aria-keyshortcuts')
    ).toBe('F2')
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
      const input = screen.getByLabelText(copy.renameAria) as HTMLInputElement
      expect(input.value).toBe('Pixel 8 API 34')
      expect(document.activeElement).toBe(input)
    })

    it('Enter 提交修剪后的新名并退出重命名', () => {
      const { onRename } = setup()
      fireEvent.doubleClick(screen.getByText('Pixel 8 API 34'))
      const input = screen.getByLabelText(copy.renameAria)
      fireEvent.change(input, { target: { value: '  新名字  ' } })
      fireEvent.keyDown(input, { key: 'Enter' })
      expect(onRename).toHaveBeenCalledWith('新名字')
      expect(screen.queryByLabelText(copy.renameAria)).toBeNull()
    })

    it('Escape 取消：不回调 onRename', () => {
      const { onRename } = setup()
      fireEvent.doubleClick(screen.getByText('Pixel 8 API 34'))
      const input = screen.getByLabelText(copy.renameAria)
      fireEvent.change(input, { target: { value: '改名' } })
      fireEvent.keyDown(input, { key: 'Escape' })
      expect(onRename).not.toHaveBeenCalled()
      expect(screen.queryByLabelText(copy.renameAria)).toBeNull()
    })

    it('空/纯空白名不提交', () => {
      const { onRename } = setup()
      fireEvent.doubleClick(screen.getByText('Pixel 8 API 34'))
      const input = screen.getByLabelText(copy.renameAria)
      fireEvent.change(input, { target: { value: '   ' } })
      fireEvent.keyDown(input, { key: 'Enter' })
      expect(onRename).not.toHaveBeenCalled()
    })

    it('F2 进入重命名：输入框出现、回填现名、自动聚焦', () => {
      setup()
      fireEvent.keyDown(screen.getByText('Pixel 8 API 34').parentElement!, { key: 'F2' })
      const input = screen.getByLabelText(copy.renameAria) as HTMLInputElement
      expect(input.value).toBe('Pixel 8 API 34')
      expect(document.activeElement).toBe(input)
    })

    it('选中态下再按 Enter 进入重命名（macOS Finder 惯例）', () => {
      setup({ selected: true })
      fireEvent.keyDown(screen.getByText('Pixel 8 API 34').parentElement!, { key: 'Enter' })
      expect(screen.getByLabelText(copy.renameAria)).toBeTruthy()
    })

    it('未选中 Enter 仅选中，不进重命名', () => {
      const { onSelect } = setup()
      fireEvent.keyDown(screen.getByText('Pixel 8 API 34').parentElement!, { key: 'Enter' })
      expect(onSelect).toHaveBeenCalledTimes(1)
      expect(screen.queryByLabelText(copy.renameAria)).toBeNull()
    })

    it('创建中/删除中：F2 不进重命名', () => {
      for (const status of ['creating', 'deleting'] as const) {
        setup({ device: { ...baseDevice, status } })
        fireEvent.keyDown(screen.getByText('Pixel 8 API 34').parentElement!, { key: 'F2' })
        expect(screen.queryByLabelText(copy.renameAria)).toBeNull()
        cleanup()
      }
    })

    it('重命名中输入框按键不触发行级语义', () => {
      const { onSelect, onRename } = setup()
      const row = screen.getByText('Pixel 8 API 34').parentElement!
      fireEvent.keyDown(row, { key: 'F2' })
      const input = screen.getByLabelText(copy.renameAria)
      fireEvent.change(input, { target: { value: '键盘名' } })
      fireEvent.keyDown(input, { key: 'Enter' })
      expect(onRename).toHaveBeenCalledWith('键盘名')
      expect(onSelect).not.toHaveBeenCalled()
    })

    it('失焦提交；与原名相同不提交', () => {
      const { onRename } = setup()
      fireEvent.doubleClick(screen.getByText('Pixel 8 API 34'))
      const input = screen.getByLabelText(copy.renameAria)
      fireEvent.change(input, { target: { value: '失焦改名' } })
      fireEvent.blur(input)
      expect(onRename).toHaveBeenCalledWith('失焦改名')

      // 组件不持有提交结果（改名走回调由父级落库），再次双击回填的仍是现 prop 名；
      // 与原名相同的提交视为无变化
      fireEvent.doubleClick(screen.getByText('Pixel 8 API 34'))
      fireEvent.blur(screen.getByLabelText(copy.renameAria))
      expect(onRename).toHaveBeenCalledTimes(1)
    })
  })
})

describe('DeviceRow（review 修复轮）', () => {
  it('read-only 下尝试重命名：不进输入框，onRenameBlocked 反馈被调用', () => {
    const onRename = vi.fn()
    const onRenameBlocked = vi.fn()
    render(
      <DeviceRow
        device={baseDevice}
        selected={false}
        storeTrusted
        metaWritable={false}
        onSelect={vi.fn()}
        onStart={vi.fn()}
        onStop={vi.fn()}
        onCancelStart={vi.fn()}
        onHibernate={vi.fn()}
        onResume={vi.fn()}
        onCopySerial={vi.fn()}
        onDelete={vi.fn()}
        onRename={onRename}
        onEdit={vi.fn()}
        onRenameBlocked={onRenameBlocked}
      />
    )
    fireEvent.doubleClick(screen.getByText('Pixel 8 API 34'))
    expect(screen.queryByLabelText(copy.renameAria)).toBeNull()
    fireEvent.keyDown(screen.getByText('Pixel 8 API 34').parentElement!, { key: 'F2' })
    expect(screen.queryByLabelText(copy.renameAria)).toBeNull()
    expect(onRenameBlocked).toHaveBeenCalledTimes(2)
    expect(onRename).not.toHaveBeenCalled()
  })

  it('跨来源桶（用户复核 5）：编辑/删除禁用带说明，重命名路径拦截反馈；停止不受限', async () => {
    const onCrossBucketBlocked = vi.fn()
    // 停止态跨桶：编辑/删除禁用 + tooltip 指路；F2 重命名走拦截回调不进输入框
    render(
      <DeviceRow
        device={baseDevice}
        selected={false}
        storeTrusted
        metaWritable
        crossBucket
        onSelect={vi.fn()}
        onStart={vi.fn()}
        onStop={vi.fn()}
        onCancelStart={vi.fn()}
        onHibernate={vi.fn()}
        onResume={vi.fn()}
        onCopySerial={vi.fn()}
        onDelete={vi.fn()}
        onRename={vi.fn()}
        onEdit={vi.fn()}
        onRenameBlocked={vi.fn()}
        onCrossBucketBlocked={onCrossBucketBlocked}
      />
    )
    const edit = screen.getByRole('button', {
      name: format(copy.editAria, { name: 'Pixel 8 API 34' })
    }) as HTMLButtonElement
    const del = screen.getByRole('button', {
      name: format(copy.deleteAria, { name: 'Pixel 8 API 34' })
    }) as HTMLButtonElement
    expect(edit.disabled).toBe(true)
    expect(del.disabled).toBe(true)
    expect(await popoverTextOf(format(copy.editAria, { name: 'Pixel 8 API 34' }))).toContain(
      copy.crossBucketBlockedTitle
    )
    expect(await popoverTextOf(format(copy.deleteAria, { name: 'Pixel 8 API 34' }))).toContain(
      copy.crossBucketBlockedTitle
    )
    fireEvent.keyDown(screen.getByText('Pixel 8 API 34').parentElement!, { key: 'F2' })
    expect(onCrossBucketBlocked).toHaveBeenCalledTimes(1)
    expect(screen.queryByLabelText(copy.renameAria)).toBeNull()
    cleanup()
    // 运行中跨桶（过渡态豁免显示）：停止钮可用——另一侧设备必须可停
    render(
      <DeviceRow
        device={{ ...baseDevice, status: 'running', serial: 'emulator-5554' }}
        selected={false}
        storeTrusted
        metaWritable
        crossBucket
        onSelect={vi.fn()}
        onStart={vi.fn()}
        onStop={vi.fn()}
        onCancelStart={vi.fn()}
        onHibernate={vi.fn()}
        onResume={vi.fn()}
        onCopySerial={vi.fn()}
        onDelete={vi.fn()}
        onRename={vi.fn()}
        onEdit={vi.fn()}
        onCrossBucketBlocked={vi.fn()}
      />
    )
    expect(
      (
        screen.getByRole('button', {
          name: format(copy.stopAria, { name: 'Pixel 8 API 34' })
        }) as HTMLButtonElement
      ).disabled
    ).toBe(false)
    // review P2-1：跨桶运行设备恢复「查看配置」——编辑钮可用（保存由主进程跨桶守卫拦）
    expect(
      (
        screen.getByRole('button', {
          name: format(copy.editAria, { name: 'Pixel 8 API 34' })
        }) as HTMLButtonElement
      ).disabled
    ).toBe(false)
    // 删除入口仅停止态渲染（plan 2026-11-06 设计 E）：运行中无按钮可聚焦
    expect(
      screen.queryByRole('button', { name: format(copy.deleteAria, { name: 'Pixel 8 API 34' }) })
    ).toBeNull()
  })

  it('出身徽标：shared-studio 出身显示（aria/tooltip 三语全称）；app-owned 与缺席不显示', () => {
    setup({ device: { ...baseDevice, imageSourceOrigin: 'shared-studio' } })
    expect(screen.getByLabelText(copy.deviceOriginStudio)).toBeTruthy()
    cleanup()
    setup({ device: { ...baseDevice, imageSourceOrigin: 'app-owned' } })
    expect(screen.queryByLabelText(copy.deviceOriginStudio)).toBeNull()
    cleanup()
    setup()
    expect(screen.queryByLabelText(copy.deviceOriginStudio)).toBeNull()
  })
})

describe('休眠域行内动作（plan 2026-11-06-emulator-hibernation）', () => {
  it('运行中：休眠钮在，可用（Mac + host 能力）', () => {
    const { onHibernate } = setup({
      device: {
        ...baseDevice,
        status: 'running',
        serial: 'emulator-5554',
        hibernationAvailable: true
      }
    })
    const button = screen.getByRole('button', {
      name: format(copy.hibernateAria, { name: 'Pixel 8 API 34' })
    }) as HTMLButtonElement
    expect(button.disabled).toBe(false)
    fireEvent.click(button)
    expect(onHibernate).toHaveBeenCalledTimes(1)
  })

  it('运行中（能力关闭）：休眠钮禁用，tooltip 带原因', async () => {
    setup({
      device: {
        ...baseDevice,
        status: 'running',
        serial: 'emulator-5554',
        hibernationAvailable: false,
        hibernationDisabledReason: copy.hibernateUnsupported
      }
    })
    const button = screen.getByRole('button', {
      name: format(copy.hibernateAria, { name: 'Pixel 8 API 34' })
    }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(await popoverTextOf(format(copy.hibernateAria, { name: 'Pixel 8 API 34' }))).toContain(
      copy.hibernateUnsupported
    )
  })

  it('休眠中：忙态槽位；无删除/启动入口；退出失败出现重试与停止出口', () => {
    const busy = setup({ device: { ...baseDevice, status: 'hibernating' } })
    expect(
      screen.getByRole('img', { name: format(copy.hibernatingAria, { name: 'Pixel 8 API 34' }) })
    ).toBeTruthy()
    expect(
      screen.queryByRole('button', { name: format(copy.deleteAria, { name: 'Pixel 8 API 34' }) })
    ).toBeNull()
    expect(
      screen.queryByRole('button', { name: format(copy.startAria, { name: 'Pixel 8 API 34' }) })
    ).toBeNull()
    expect(
      screen.queryByRole('button', {
        name: format(copy.retryHibernateAria, { name: 'Pixel 8 API 34' })
      })
    ).toBeNull()
    cleanup()

    const retry = setup({
      device: {
        ...baseDevice,
        status: 'hibernating',
        lastError: { code: 'hibernate-exit-failed', message: '快照已保存，但进程未退出' }
      }
    })
    fireEvent.click(
      screen.getByRole('button', {
        name: format(copy.retryHibernateAria, { name: 'Pixel 8 API 34' })
      })
    )
    expect(retry.onHibernate).toHaveBeenCalledTimes(1)
    fireEvent.click(
      screen.getByRole('button', { name: format(copy.stopAria, { name: 'Pixel 8 API 34' }) })
    )
    expect(retry.onStop).toHaveBeenCalledTimes(1)
    void busy
  })

  it('已休眠：恢复钮在；无停止/删除/启动入口', () => {
    const { onResume } = setup({ device: { ...baseDevice, status: 'hibernated' } })
    fireEvent.click(
      screen.getByRole('button', { name: format(copy.resumeAria, { name: 'Pixel 8 API 34' }) })
    )
    expect(onResume).toHaveBeenCalledTimes(1)
    expect(
      screen.queryByRole('button', { name: format(copy.stopAria, { name: 'Pixel 8 API 34' }) })
    ).toBeNull()
    expect(
      screen.queryByRole('button', { name: format(copy.deleteAria, { name: 'Pixel 8 API 34' }) })
    ).toBeNull()
    expect(
      screen.queryByRole('button', { name: format(copy.startAria, { name: 'Pixel 8 API 34' }) })
    ).toBeNull()
  })

  it('恢复中：忙态 + 取消恢复钮（不出现停止）', () => {
    const { onCancelStart } = setup({ device: { ...baseDevice, status: 'resuming' } })
    expect(
      screen.getByRole('img', { name: format(copy.resumingAria, { name: 'Pixel 8 API 34' }) })
    ).toBeTruthy()
    fireEvent.click(
      screen.getByRole('button', {
        name: format(copy.cancelResumeAria, { name: 'Pixel 8 API 34' })
      })
    )
    expect(onCancelStart).toHaveBeenCalledTimes(1)
    expect(
      screen.queryByRole('button', { name: format(copy.stopAria, { name: 'Pixel 8 API 34' }) })
    ).toBeNull()
  })
})

describe('WHPX 缺失引导按钮（plan 2026-10-22-windows-emulator-env）', () => {
  const openWindowsFeatures = vi.fn(async () => undefined)

  beforeEach(() => {
    openWindowsFeatures.mockClear()
    ;(window as unknown as { api: unknown }).api = {
      platform: 'win32',
      dialog: { openWindowsFeatures }
    }
  })

  it('lastError 为 whpx-missing：渲染「去开启」按钮，点击走受控深链通道', () => {
    setup({
      device: {
        ...baseDevice,
        lastError: { code: 'whpx-missing', message: '启动失败：Windows 虚拟化（WHPX）未开启' }
      }
    })
    const button = screen.getByRole('button', { name: copy.openWindowsFeatures })
    fireEvent.click(button)
    expect(openWindowsFeatures).toHaveBeenCalledTimes(1)
  })

  it('其他 lastError code：不渲染引导按钮（该入口仅随 whpx-missing 出现）', () => {
    setup({
      device: {
        ...baseDevice,
        lastError: { code: 'unexpected-exit', message: '模拟器意外退出：PANIC' }
      }
    })
    expect(screen.queryByRole('button', { name: copy.openWindowsFeatures })).toBeNull()
  })
})
