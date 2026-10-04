// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import type { DeviceMeta } from '@shared/types'

const mocks = vi.hoisted(() => ({
  handle: vi.fn(),
  getAllWindows: vi.fn(() => []),
  readDeviceMetas: vi.fn<() => Promise<DeviceMeta[]>>(async () => []),
  writeDeviceMetas: vi.fn<(metas: DeviceMeta[]) => Promise<void>>(async () => {}),
  createAvd: vi.fn<(input: unknown, dirs: unknown) => Promise<string>>(async () => '/avd'),
  deleteAvd: vi.fn<(name: string, dirs: unknown) => Promise<void>>(async () => {}),
  isPackageNameInstalled: vi.fn<(root: string, packageName: string) => Promise<boolean>>(
    async () => true
  )
}))

vi.mock('electron', () => ({
  ipcMain: { handle: mocks.handle },
  BrowserWindow: { getAllWindows: mocks.getAllWindows },
  app: { getPath: vi.fn(() => '/userdata') }
}))
vi.mock('../../store', () => ({
  isImageVariant: (value: unknown): boolean =>
    value === 'aosp' || value === 'google_apis' || value === 'google_play',
  readDeviceMetas: mocks.readDeviceMetas,
  writeDeviceMetas: mocks.writeDeviceMetas
}))
vi.mock('../../emulator/avd', () => ({
  createAvd: mocks.createAvd,
  deleteAvd: mocks.deleteAvd
}))
// 'assert on args' helper lives inline in tests below
vi.mock('../../emulator/catalog', () => ({
  isPackageNameInstalled: mocks.isPackageNameInstalled,
  packageNameFor: (apiLevel: number, variant: string): string =>
    `system-images;android-${apiLevel};${variant === 'aosp' ? 'default' : variant === 'google_play' ? 'google_apis_playstore' : 'google_apis'};arm64-v8a`
}))
/** devices 域有模块级状态（devices/loaded）——每用例 resetModules 动态导入隔离 */
const freshDomain = async (): Promise<{
  handlerFor: (channel: string) => (event: unknown, raw: unknown) => Promise<unknown>
}> => {
  vi.resetModules()
  const domain = await import('..')
  domain.registerDevicesIpc()
  return {
    handlerFor: (channel: string) => {
      const call = mocks.handle.mock.calls.find(([name]) => name === channel)
      if (!call) throw new Error(`handler 未注册：${channel}`)
      return call[1] as (event: unknown, raw: unknown) => Promise<unknown>
    }
  }
}

const validCreateInput = {
  profileId: 'pixel_8',
  profileLabel: 'Pixel 8',
  apiLevel: 36,
  variant: 'google_play',
  name: '测试机'
}

describe('devices 域接真（create/delete）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // clearAllMocks 只清调用记录，mockResolvedValue/RejectedValue 的实现会跨用例泄漏——显式重置
    mocks.readDeviceMetas.mockResolvedValue([])
    mocks.isPackageNameInstalled.mockResolvedValue(true)
    mocks.createAvd.mockResolvedValue('/avd')
    mocks.deleteAvd.mockResolvedValue(undefined)
  })

  it('create：镜像已装 → 真建 AVD（avdName=设备 id，profileId 透传给 avdmanager）→ 元数据落盘', async () => {
    const { handlerFor } = await freshDomain()
    const devices = (await handlerFor(IPC_CHANNELS.devicesCreate)({}, validCreateInput)) as Array<
      DeviceMeta & { status: string }
    >
    expect(devices).toHaveLength(1)
    const created = devices[0]
    expect(created.name).toBe('测试机')
    expect(created.status).toBe('stopped')
    expect(mocks.createAvd).toHaveBeenCalledTimes(1)
    const call = mocks.createAvd.mock.calls[0][0] as {
      avdName: string
      profileId: string
      packageName: string
    }
    expect(call.avdName).toBe(created.id)
    expect(call.profileId).toBe('pixel_8')
    expect(call.packageName).toBe('system-images;android-36;google_apis_playstore;arm64-v8a')
    const callDirs = mocks.createAvd.mock.calls[0][1] as { avdHome: string; sdkRoot: string }
    expect(callDirs.avdHome).toBe('/userdata/avd-home')
    expect(callDirs.sdkRoot).toBe('/userdata/AndroidSDK')
    const persisted = mocks.writeDeviceMetas.mock.calls[0][0] as DeviceMeta[]
    expect(persisted).toHaveLength(1)
    expect(persisted[0].id).toBe(created.id)
    expect((persisted[0] as unknown as Record<string, unknown>).status).toBeUndefined()
    expect(mocks.isPackageNameInstalled).toHaveBeenCalledWith(
      '/userdata/AndroidSDK',
      'system-images;android-36;google_apis_playstore;arm64-v8a'
    )
  })

  it('create：avdmanager 拒绝未知画像 → 错误上抛且不写元数据（-d 校验交给 avdmanager）', async () => {
    mocks.createAvd.mockRejectedValue(new Error('Error: Device definition nope is not valid'))
    const { handlerFor } = await freshDomain()
    await expect(
      handlerFor(IPC_CHANNELS.devicesCreate)({}, { ...validCreateInput, profileId: 'nope' })
    ).rejects.toThrow('nope')
    expect(mocks.writeDeviceMetas).not.toHaveBeenCalled()
  })

  it('create：镜像未装拒绝且不写元数据（零部分成功）', async () => {
    mocks.isPackageNameInstalled.mockResolvedValue(false)
    const { handlerFor } = await freshDomain()
    await expect(handlerFor(IPC_CHANNELS.devicesCreate)({}, validCreateInput)).rejects.toThrow(
      '系统镜像未安装'
    )
    expect(mocks.createAvd).not.toHaveBeenCalled()
    expect(mocks.writeDeviceMetas).not.toHaveBeenCalled()
  })

  it('create：AVD 建失败 → 元数据不落盘', async () => {
    mocks.createAvd.mockRejectedValue(new Error('磁盘满'))
    const { handlerFor } = await freshDomain()
    await expect(handlerFor(IPC_CHANNELS.devicesCreate)({}, validCreateInput)).rejects.toThrow(
      '磁盘满'
    )
    expect(mocks.writeDeviceMetas).not.toHaveBeenCalled()
  })

  it('create：非法 payload（apiLevel 非整数）拒绝', async () => {
    const { handlerFor } = await freshDomain()
    await expect(
      handlerFor(IPC_CHANNELS.devicesCreate)({}, { ...validCreateInput, apiLevel: 36.5 })
    ).rejects.toThrow()
    expect(mocks.createAvd).not.toHaveBeenCalled()
  })

  it('delete：运行中设备拒绝（issue 2026-10-03-delete-running-device-no-stop 的拦截层）', async () => {
    const { handlerFor } = await freshDomain()
    const create = handlerFor(IPC_CHANNELS.devicesCreate)
    const devices = (await create({}, validCreateInput)) as DeviceMeta[]
    const id = devices[0].id
    await handlerFor(IPC_CHANNELS.devicesSetRunning)({}, { id, running: true })
    await expect(handlerFor(IPC_CHANNELS.devicesDelete)({}, { id })).rejects.toThrow('设备正在运行')
    expect(mocks.deleteAvd).not.toHaveBeenCalled()
  })

  it('delete：已停止设备 → 真删 AVD 目录 + 元数据移除', async () => {
    const { handlerFor } = await freshDomain()
    const devices = (await handlerFor(IPC_CHANNELS.devicesCreate)(
      {},
      validCreateInput
    )) as DeviceMeta[]
    const id = devices[0].id
    const deleteHandler = handlerFor(IPC_CHANNELS.devicesDelete)
    const after = (await deleteHandler({}, { id })) as DeviceMeta[]
    expect(after).toHaveLength(0)
    expect(mocks.deleteAvd).toHaveBeenCalledWith(id, {
      avdHome: '/userdata/avd-home',
      sdkRoot: '/userdata/AndroidSDK'
    })
    expect(mocks.writeDeviceMetas).toHaveBeenLastCalledWith([])
  })
})
