// 启动前摄像头核验 + 皮肤外观不覆盖机型尺寸（源码 startup.ts）
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import type { DeviceMeta } from '@shared/types'
import {
  freshDomain,
  mainWindowEvent,
  mocks,
  startThroughPreflight,
  validCreateInput,
  quickDevice
} from './harness'

describe('启动前摄像头核验（review P3：文案不叠加建议从句）', () => {
  /** 前置绑定 webcam0 的设备（normalizeAdvancedSettings 为透传 mock） */
  const createWebcamDevice = async (
    handlerFor: (channel: string) => (event: unknown, raw: unknown) => Promise<unknown>
  ): Promise<string> => {
    const created = (await handlerFor(IPC_CHANNELS.devicesCreate)(mainWindowEvent(), {
      ...validCreateInput,
      advancedSettings: {
        skinRef: null,
        frontCamera: { mode: 'webcam', deviceId: 'webcam0' },
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
    })) as { createdId: string }
    return created.createdId
  }

  beforeEach(() => {
    vi.clearAllMocks()
    // 状态机组遗留的 checkDeviceHealth 缺失态会先拦掉启动——回默认健康
    mocks.checkDeviceHealth.mockResolvedValue({ state: 'valid', issues: [], checkedAt: 42 })
    mocks.readDeviceMetas.mockResolvedValue([])
    mocks.writeDeviceMetas.mockImplementation(async (metas: DeviceMeta[]) => {
      mocks.fileMetas.current = metas
    })
    mocks.isPackageNameInstalled.mockResolvedValue(true)
    mocks.createAvd.mockResolvedValue('/avd')
    mocks.avdExists.mockResolvedValue(true)
    mocks.getMainWindow.mockReturnValue({ webContents: { id: 7, send: vi.fn() } })
    mocks.wizardOwns.mockImplementation((sender: { id: number }) => sender.id === 9)
    mocks.runnerInstance.start.mockResolvedValue({ runId: 'run-1', serial: 'emulator-5554' })
    mocks.listWebcams.mockResolvedValue([{ id: 'webcam0', deviceLabel: 'host-a' }])
    // 摄像头核验移入 beforeStart（对账设计 4）：让 mock start 驱动它
    startThroughPreflight()
  })

  it('枚举失败且底层错误自带建议从句：不再叠加第二条建议', async () => {
    mocks.listWebcams.mockRejectedValue(new Error('摄像头输出格式无法识别，请检查 emulator 版本'))
    const { handlerFor } = await freshDomain()
    const id = await createWebcamDevice(handlerFor)
    await expect(handlerFor(IPC_CHANNELS.devicesStart)(mainWindowEvent(), { id })).rejects.toThrow(
      '启动前无法核验摄像头'
    )
    const list = (await handlerFor(IPC_CHANNELS.devicesList)(mainWindowEvent(), undefined)) as {
      devices: Array<{ lastError?: { code: string; message: string } }>
    }
    expect(list.devices[0].lastError?.code).toBe('webcam-missing')
    expect(list.devices[0].lastError?.message).toBe(
      '启动前无法核验摄像头：摄像头输出格式无法识别，请检查 emulator 版本'
    )
  })

  it('枚举失败为裸错误：保留原错误并附行动建议', async () => {
    mocks.listWebcams.mockRejectedValue(new Error('spawn ENOENT'))
    const { handlerFor } = await freshDomain()
    const id = await createWebcamDevice(handlerFor)
    await expect(handlerFor(IPC_CHANNELS.devicesStart)(mainWindowEvent(), { id })).rejects.toThrow(
      '启动前无法核验摄像头：spawn ENOENT，请检查权限或改用模拟画面'
    )
  })

  it('配置的宿主摄像头消失：原样透传，不进枚举失败分支', async () => {
    mocks.listWebcams.mockResolvedValue([])
    const { handlerFor } = await freshDomain()
    const id = await createWebcamDevice(handlerFor)
    await expect(handlerFor(IPC_CHANNELS.devicesStart)(mainWindowEvent(), { id })).rejects.toThrow(
      '宿主摄像头（webcam0）已不可用'
    )
    const list = (await handlerFor(IPC_CHANNELS.devicesList)(mainWindowEvent(), undefined)) as {
      devices: Array<{ lastError?: { code: string; message: string } }>
    }
    expect(list.devices[0].lastError?.message).not.toContain('启动前无法核验')
  })
})

describe('皮肤只装饰外观，不能覆盖机型屏幕尺寸', () => {
  const skinConfig = 'skin.path=/skins/pixel_7\nskin.name=pixel_7\n'
  const runnerConfig = (): {
    beforeStart: (id: string, runId: string, signal: AbortSignal) => Promise<void>
    extraArgsFor: (id: string) => string[]
  } => mocks.createRunner.mock.calls.at(-1)![0] as never

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.readDeviceMetas.mockResolvedValue([quickDevice({ advancedSettings: null }) as never])
    mocks.readAvdConfigRaw.mockResolvedValue(null)
    mocks.recoverPendingTransactions.mockResolvedValue({
      completed: [],
      rolledBack: [],
      frozen: []
    })
    mocks.checkDeviceHealth.mockResolvedValue({ state: 'valid', issues: [], checkedAt: 42 })
    mocks.storeHealth.mockReturnValue({ state: 'ok', issues: [] })
    mocks.getMainWindow.mockReturnValue({ webContents: { id: 7, send: vi.fn() } })
    mocks.runnerInstance.start.mockImplementation(async (id: string, runId: string) => {
      await runnerConfig().beforeStart(id, runId, new AbortController().signal)
      return { runId, serial: 'emulator-5556' }
    })
    mocks.runnerInstance.cancelStart.mockResolvedValue(undefined)
  })

  it('QVGA 配了大屏皮肤，启动仍指定 240x320；原运行参数和落盘配置不变', async () => {
    mocks.readAvdConfigRaw.mockResolvedValue(
      `${skinConfig}hw.lcd.width=240\nhw.lcd.height=320\nhw.lcd.density=120\n`
    )
    const { handlerFor } = await freshDomain()
    await handlerFor(IPC_CHANNELS.devicesStart)(mainWindowEvent(), { id: 'quick-1' })
    expect(runnerConfig().extraArgsFor('quick-1')).toEqual([
      '-no-snapshot',
      '-gpu',
      'host',
      '-skin',
      '240x320'
    ])
    expect(mocks.writeAvdConfigRaw).not.toHaveBeenCalled()
    expect(mocks.patchAvdConfig).not.toHaveBeenCalled()
    expect(mocks.writeDeviceMetas).not.toHaveBeenCalled()
  })

  it('附加屏幕参数保留 Quick 首启策略，不把 GPU 或快照策略改成 legacy 默认值', async () => {
    mocks.readDeviceMetas.mockResolvedValue([quickDevice() as never])
    mocks.readAvdConfigRaw.mockResolvedValue(`${skinConfig}hw.lcd.width=1080\nhw.lcd.height=2400\n`)
    const { handlerFor } = await freshDomain()
    await handlerFor(IPC_CHANNELS.devicesStart)(mainWindowEvent(), { id: 'quick-1' })
    expect(runnerConfig().extraArgsFor('quick-1')).toEqual([
      '-no-snapshot-load',
      '-skin',
      '1080x2400'
    ])
  })

  it.each([
    null,
    skinConfig,
    `${skinConfig}hw.lcd.width=0\nhw.lcd.height=320\n`,
    `${skinConfig}hw.lcd.width=240x1080\nhw.lcd.height=320\n`,
    'hw.lcd.width=240\nhw.lcd.height=320\n'
  ])('无皮肤或无有效尺寸不猜测分辨率，保持原启动参数（%s）', async (raw) => {
    mocks.readAvdConfigRaw.mockResolvedValue(raw)
    const { handlerFor } = await freshDomain()
    await handlerFor(IPC_CHANNELS.devicesStart)(mainWindowEvent(), { id: 'quick-1' })
    expect(runnerConfig().extraArgsFor('quick-1')).toEqual(['-no-snapshot', '-gpu', 'host'])
  })

  it('取消后再次启动重读配置，不复用上一代次的屏幕参数', async () => {
    mocks.readAvdConfigRaw
      .mockResolvedValueOnce(`${skinConfig}hw.lcd.width=240\nhw.lcd.height=320\n`)
      .mockResolvedValueOnce('hw.lcd.width=240\nhw.lcd.height=320\n')
    const { handlerFor } = await freshDomain()
    await handlerFor(IPC_CHANNELS.devicesStart)(mainWindowEvent(), { id: 'quick-1' })
    expect(runnerConfig().extraArgsFor('quick-1')).toContain('240x320')
    await handlerFor(IPC_CHANNELS.devicesCancelStart)(mainWindowEvent(), { id: 'quick-1' })
    await handlerFor(IPC_CHANNELS.devicesStart)(mainWindowEvent(), { id: 'quick-1' })
    expect(runnerConfig().extraArgsFor('quick-1')).toEqual(['-no-snapshot', '-gpu', 'host'])
    expect(mocks.readAvdConfigRaw).toHaveBeenCalledTimes(2)
  })

  it('读取配置失败时启动失败，不带着未经检查的皮肤继续启动', async () => {
    // 一次性拒绝：mockRejectedValue 会渗入后续 describe（clearAllMocks 不清实现，
    // issue 2026-10-10-devices-test-mock-leak），Once 用完即回底层缺省实现
    mocks.readAvdConfigRaw.mockRejectedValueOnce(new Error('AVD config.ini 读取失败'))
    const { handlerFor } = await freshDomain()
    await expect(
      handlerFor(IPC_CHANNELS.devicesStart)(mainWindowEvent(), { id: 'quick-1' })
    ).rejects.toThrow('AVD config.ini 读取失败')
    expect(runnerConfig().extraArgsFor('quick-1')).not.toContain('-skin')
  })
})
