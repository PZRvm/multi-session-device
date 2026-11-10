// 顺序重排（源码 reorder.ts；plan 2026-11-09-device-list-drag-reorder）
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import type { DeviceMeta, DeviceSnapshot } from '@shared/types'
import { freshDomain, mainWindowEvent, mocks } from './harness'

const metaOf = (suffix: string, name: string): DeviceMeta =>
  ({
    id: `018f1c2d-0000-4000-8000-00000000${suffix}`,
    name,
    profileId: 'pixel_8',
    profileLabel: 'Pixel 8',
    imagePackageName: 'system-images;android-36;google_apis_playstore;arm64-v8a',
    apiDisplay: '36',
    formFactor: 'phone',
    screenSummary: null,
    advancedSettings: null,
    snapshotReadyAt: null,
    createdAt: 0
  }) as never

const A = metaOf('0001', '甲')
const B = metaOf('0002', '乙')
const C = metaOf('0003', '丙')

describe('devices 域（顺序重排）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.readDeviceMetas.mockResolvedValue([A, B, C])
    mocks.writeDeviceMetas.mockImplementation(async (metas: DeviceMeta[]) => {
      mocks.fileMetas.current = metas
    })
    mocks.getAllWindows.mockReturnValue([])
    mocks.getMainWindow.mockReturnValue({ webContents: { id: 7, send: vi.fn() } })
  })

  it('合法重排：数组序落盘 = 用户序、快照同序、revision 自增、广播推送', async () => {
    const { handlerFor } = await freshDomain()
    const before = (await handlerFor(IPC_CHANNELS.devicesList)(
      mainWindowEvent(),
      undefined
    )) as DeviceSnapshot
    const result = (await handlerFor(IPC_CHANNELS.devicesReorder)(mainWindowEvent(), {
      ids: [C.id, A.id, B.id]
    })) as DeviceSnapshot
    expect(result.devices.map((device) => device.id)).toEqual([C.id, A.id, B.id])
    expect(result.revision).toBe(before.revision + 1)
    expect(mocks.fileMetas.current!.map((meta) => meta.id)).toEqual([C.id, A.id, B.id])
  })

  it('陈旧全序整单拒绝：重复/未知/缺项均不落盘且不断队列（随后合法重排成功）', async () => {
    const { handlerFor } = await freshDomain()
    for (const ids of [
      [A.id, A.id, C.id],
      [A.id, B.id, '018f1c2d-0000-4000-8000-00000000ffff'],
      [A.id, B.id]
    ]) {
      await expect(
        handlerFor(IPC_CHANNELS.devicesReorder)(mainWindowEvent(), { ids })
      ).rejects.toThrow()
    }
    expect(mocks.writeDeviceMetas).not.toHaveBeenCalled()
    const result = (await handlerFor(IPC_CHANNELS.devicesReorder)(mainWindowEvent(), {
      ids: [B.id, C.id, A.id]
    })) as DeviceSnapshot
    expect(result.devices.map((device) => device.id)).toEqual([B.id, C.id, A.id])
  })

  it('载荷非法整单拒绝：非对象/缺 ids/非数组/非串条目/空串', async () => {
    const { handlerFor } = await freshDomain()
    for (const bad of [null, 'x', {}, { ids: 'x' }, { ids: [1] }, { ids: [''] }]) {
      await expect(handlerFor(IPC_CHANNELS.devicesReorder)(mainWindowEvent(), bad)).rejects.toThrow(
        'devices:reorder'
      )
    }
    expect(mocks.writeDeviceMetas).not.toHaveBeenCalled()
  })

  it('read-only 态拒绝（assertMetaWritable 门，双闸的服务端侧）', async () => {
    mocks.storeHealth.mockReturnValue({ state: 'read-only', issues: [] })
    const { handlerFor } = await freshDomain()
    await expect(
      handlerFor(IPC_CHANNELS.devicesReorder)(mainWindowEvent(), {
        ids: [A.id, B.id, C.id]
      })
    ).rejects.toThrow()
    expect(mocks.writeDeviceMetas).not.toHaveBeenCalled()
  })

  it('非主窗 sender 拒绝（reorder 仅登记主窗）', async () => {
    const { handlerFor } = await freshDomain()
    await expect(
      handlerFor(IPC_CHANNELS.devicesReorder)({ sender: { id: 99 } }, { ids: [A.id] })
    ).rejects.toThrow('devices:reorder')
  })
})
