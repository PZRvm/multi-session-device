import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Device } from '@shared/types'
import CanvasPlaceholder from '../CanvasPlaceholder'
import { MAIN_COPY } from '@shared/i18n'
const copy = MAIN_COPY['zh-CN']

afterEach(cleanup)

const device = (overrides: Partial<Device> = {}): Device => ({
  id: 'd1',
  name: 'Pixel test',
  profileId: 'pixel_8',
  profileLabel: 'Pixel 8',
  imagePackageName: 'system-images;android-34;google_apis;arm64-v8a',
  apiDisplay: '34',
  formFactor: 'phone',
  screenSummary: null,
  advancedSettings: null,
  snapshotReadyAt: null,
  createdAt: 0,
  availability: { state: 'valid', issues: [], checkedAt: 1 },
  status: 'stopped',
  ...overrides
})

describe('CanvasPlaceholder（对账健康态）', () => {
  it('停止且健康：正常停止占位，无重新检查入口', () => {
    render(
      <CanvasPlaceholder device={device()} onCreate={vi.fn()} onRecheck={vi.fn()} storeState="ok" />
    )
    expect(screen.getByText(copy.hintStopped)).toBeTruthy()
    expect(screen.queryByRole('button', { name: new RegExp(copy.recheck) })).toBeNull()
  })

  it('停止且文件异常：显示具体原因与重新检查', () => {
    const onRecheck = vi.fn()
    render(
      <CanvasPlaceholder
        device={device({
          availability: {
            state: 'missing',
            issues: [
              {
                component: 'avd',
                code: 'avd-dir-missing',
                message: '缺少 d1.avd 目录（AVD 可能被外部删除）',
                severity: 'error'
              }
            ],
            checkedAt: 2
          }
        })}
        onCreate={vi.fn()}
        onRecheck={onRecheck}
        storeState="ok"
      />
    )
    expect(screen.getByText(/缺少 d1.avd 目录/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: new RegExp(copy.recheck) }))
    expect(onRecheck).toHaveBeenCalledTimes(1)
  })

  it('store error 且无设备：显示「设备数据读取失败」而非空库文案，提供重试', () => {
    const onRecheck = vi.fn()
    render(
      <CanvasPlaceholder
        device={null}
        onCreate={vi.fn()}
        onRecheck={onRecheck}
        storeState="error"
      />
    )
    expect(screen.getByText(copy.readFailedTitle)).toBeTruthy()
    expect(screen.queryByText(copy.emptyTitle)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: new RegExp(copy.recheck) }))
    expect(onRecheck).toHaveBeenCalledTimes(1)
  })

  it('正常空库：保留「还没有设备」与新建入口', () => {
    render(
      <CanvasPlaceholder device={null} onCreate={vi.fn()} onRecheck={vi.fn()} storeState="ok" />
    )
    expect(screen.getByText(copy.emptyTitle)).toBeTruthy()
    expect(screen.getByRole('button', { name: new RegExp(copy.createDevice) })).toBeTruthy()
  })
})

describe('CanvasPlaceholder（新建入口冻结）', () => {
  it('createDisabled：空库新建钮禁用并说明（read-only 冻结时）', () => {
    const onCreate = vi.fn()
    render(
      <CanvasPlaceholder
        device={null}
        onCreate={onCreate}
        onRecheck={vi.fn()}
        storeState="ok"
        createDisabled={true}
      />
    )
    const create = screen.getByRole('button', {
      name: new RegExp(copy.createDevice)
    }) as HTMLButtonElement
    expect(create.disabled).toBe(true)
    expect(create.title).toContain('冻结')
    fireEvent.click(create)
    expect(onCreate).not.toHaveBeenCalled()
  })
})

describe('CanvasPlaceholder（review 修复轮）', () => {
  it('rechecking：重查按钮忙碌禁用', () => {
    render(
      <CanvasPlaceholder
        device={null}
        onCreate={vi.fn()}
        onRecheck={vi.fn()}
        storeState="error"
        rechecking={true}
      />
    )
    expect(
      (screen.getByRole('button', { name: new RegExp(copy.recheck) }) as HTMLButtonElement).disabled
    ).toBe(true)
  })
})
