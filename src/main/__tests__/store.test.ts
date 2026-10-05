// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DeviceMeta } from '@shared/types'

// store.ts 用 app.getPath('userData') 定位文件——mock 到临时目录
let userDataDir: string
vi.mock('electron', () => ({
  app: { getPath: () => userDataDir }
}))

import {
  readDeviceMetas,
  resetStoreProtection,
  storeWriteProtection,
  writeDeviceMetas
} from '../store'

const v2Meta = (overrides: Partial<DeviceMeta> = {}): DeviceMeta => ({
  id: 'd1',
  name: '测试机',
  profileId: 'pixel_8',
  profileLabel: 'Pixel 8',
  imagePackageName: 'system-images;android-36.1;google_apis_playstore;arm64-v8a',
  apiDisplay: '36.1',
  formFactor: 'phone',
  screenSummary: { widthPx: 1080, heightPx: 2400, diagonalInches: 6.31 },
  advancedSettings: null,
  createdAt: 0,
  ...overrides
})

const storeFile = (): string => join(userDataDir, 'devices.json')

beforeEach(async () => {
  userDataDir = await mkdtemp(join(tmpdir(), 'msd-store-'))
  resetStoreProtection()
})

describe('store v1/v2 双版本读取', () => {
  it('无文件 = 首次启动空表，无写保护', async () => {
    expect(await readDeviceMetas()).toEqual([])
    expect(storeWriteProtection()).toBeNull()
  })

  it('v2 文件：合法条目读取，坏条目丢弃', async () => {
    await writeFile(
      storeFile(),
      JSON.stringify({
        version: 2,
        devices: [v2Meta(), { id: 'broken', name: 42 }]
      }),
      'utf8'
    )
    const metas = await readDeviceMetas()
    expect(metas).toHaveLength(1)
    expect(metas[0]?.imagePackageName).toBe(v2Meta().imagePackageName)
  })

  it('v1 文件：合法旧记录派生精确身份（arm64 + 变体反推），形态不猜', async () => {
    await writeFile(
      storeFile(),
      JSON.stringify({
        version: 1,
        devices: [
          {
            id: 'old1',
            name: '旧设备',
            profileId: 'pixel_8',
            profileLabel: 'Pixel 8',
            apiLevel: 34,
            variant: 'google_play',
            createdAt: 100
          },
          { id: 'old-bad', apiLevel: 'x' }
        ]
      }),
      'utf8'
    )
    const metas = await readDeviceMetas()
    expect(metas).toHaveLength(1)
    expect(metas[0]).toMatchObject({
      id: 'old1',
      imagePackageName: 'system-images;android-34;google_apis_playstore;arm64-v8a',
      apiDisplay: '34',
      formFactor: 'unknown',
      screenSummary: null,
      advancedSettings: null
    })
  })

  it('损坏 JSON：返回空表并置写保护——不静默当空库覆盖（issue 契约）', async () => {
    await writeFile(storeFile(), '{not json', 'utf8')
    const metas = await readDeviceMetas()
    expect(metas).toEqual([])
    expect(storeWriteProtection()).toContain('不是合法 JSON')
    await expect(writeDeviceMetas([v2Meta()])).rejects.toThrow('已写保护')
  })

  it('未知版本：空表 + 写保护', async () => {
    await writeFile(storeFile(), JSON.stringify({ version: 99, devices: [] }), 'utf8')
    await readDeviceMetas()
    expect(storeWriteProtection()).toContain('版本未知')
    await expect(writeDeviceMetas([v2Meta()])).rejects.toThrow('已写保护')
  })
})

describe('store 写入与备份', () => {
  it('首次写入 v2 覆盖 v1 前留备份；再次写入不重复备份', async () => {
    await writeFile(
      storeFile(),
      JSON.stringify({
        version: 1,
        devices: [
          {
            id: 'old1',
            name: '旧',
            profileId: 'p',
            profileLabel: 'P',
            apiLevel: 34,
            variant: 'aosp',
            createdAt: 1
          }
        ]
      }),
      'utf8'
    )
    await writeDeviceMetas([v2Meta()])
    const backup = join(userDataDir, 'devices.json.v1-backup')
    const backupRaw = JSON.parse(await readFile(backup, 'utf8')) as { version: number }
    expect(backupRaw.version).toBe(1)
    const current = JSON.parse(await readFile(storeFile(), 'utf8')) as { version: number }
    expect(current.version).toBe(2)
    // 再写一次：备份仍是旧的那份（不重复覆盖）
    await writeDeviceMetas([v2Meta({ id: 'd2' })])
    const files = await readdir(userDataDir)
    expect(files.filter((name) => name.includes('v1-backup'))).toHaveLength(1)
  })

  it('v2 之上再写不产生备份', async () => {
    await writeDeviceMetas([v2Meta()])
    await writeDeviceMetas([v2Meta({ id: 'd2' })])
    const files = await readdir(userDataDir)
    expect(files.some((name) => name.includes('v1-backup'))).toBe(false)
  })
})
