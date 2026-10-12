// sender 白名单与退出清理（源码 ipc.ts + lifecycle.ts 收尾）
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import { freshDomain, mainWindowEvent, mocks, validCreateInput, wizardEvent } from './harness'

describe('devices 域（sender 白名单与退出清理）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.readDeviceMetas.mockResolvedValue([])
    mocks.isPackageNameInstalled.mockResolvedValue(true)
    mocks.getMainWindow.mockReturnValue({ webContents: { id: 7, send: vi.fn() } })
    mocks.wizardOwns.mockImplementation((sender: { id: number }) => sender.id === 9)
  })

  it('未登记 sender 拒绝；向导可 create、不可 start', async () => {
    const { handlerFor } = await freshDomain()
    mocks.getMainWindow.mockReturnValue(null)
    await expect(
      handlerFor(IPC_CHANNELS.devicesList)(mainWindowEvent(), undefined)
    ).rejects.toThrow('未登记的窗口')
    mocks.getMainWindow.mockReturnValue({ webContents: { id: 7, send: vi.fn() } })
    // 向导 create 放行
    const created = (await handlerFor(IPC_CHANNELS.devicesCreate)(
      wizardEvent(),
      validCreateInput
    )) as { createdId: string }
    expect(created.createdId).toBeTruthy()
    // 向导 start 拒绝
    await expect(
      handlerFor(IPC_CHANNELS.devicesStart)(wizardEvent(), { id: created.createdId })
    ).rejects.toThrow('未登记的窗口')
  })

  it('prepareAppShutdown：停全部实例、收敛状态、返回残留', async () => {
    const { handlerFor } = await freshDomain()
    const created = (await handlerFor(IPC_CHANNELS.devicesCreate)(
      mainWindowEvent(),
      validCreateInput
    )) as { createdId: string }
    await handlerFor(IPC_CHANNELS.devicesStart)(mainWindowEvent(), { id: created.createdId })
    const domain = await import('..')
    const { leftovers } = await domain.prepareAppShutdown()
    expect(leftovers).toEqual([])
    expect(mocks.runnerInstance.disposeAll).toHaveBeenCalledTimes(1)
    const list = (await handlerFor(IPC_CHANNELS.devicesList)(mainWindowEvent(), undefined)) as {
      devices: Array<{ status: string }>
    }
    expect(list.devices[0].status).toBe('stopped')
    // 清理后拒绝新启动，恢复后放行
    await expect(
      handlerFor(IPC_CHANNELS.devicesStart)(mainWindowEvent(), { id: created.createdId })
    ).rejects.toThrow('暂停启动')
    domain.resumeAfterShutdown()
    expect(mocks.runnerInstance.resumeAccepting).toHaveBeenCalledTimes(1)
    await handlerFor(IPC_CHANNELS.devicesStart)(mainWindowEvent(), { id: created.createdId })
  })
})
