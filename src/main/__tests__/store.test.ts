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
  armStoreProtection,
  classifyReadError,
  readDeviceStore,
  resetStoreProtection,
  storeWriteProtection,
  writeDeviceMetas
} from '../store'

const v2Meta = (overrides: Partial<DeviceMeta> = {}): DeviceMeta => ({
  id: '0f0d3e26-7f63-4a8e-9d1a-3b0c6f001101',
  name: '测试机',
  profileId: 'pixel_8',
  profileLabel: 'Pixel 8',
  imagePackageName: 'system-images;android-36.1;google_apis_playstore;arm64-v8a',
  apiDisplay: '36.1',
  formFactor: 'phone',
  screenSummary: { widthPx: 1080, heightPx: 2400, diagonalInches: 6.31 },
  advancedSettings: null,
  snapshotReadyAt: null,
  createdAt: 0,
  ...overrides
})

const storeFile = (): string => join(userDataDir, 'devices.json')

const writeStore = async (payload: unknown): Promise<void> => {
  await writeFile(storeFile(), JSON.stringify(payload), 'utf8')
}

beforeEach(async () => {
  userDataDir = await mkdtemp(join(tmpdir(), 'msd-store-'))
  resetStoreProtection()
})

describe('store v1/v2 typed 读取', () => {
  it('无文件（ENOENT）= 首次空库 ok，无写保护', async () => {
    const result = await readDeviceStore()
    expect(result.metas).toEqual([])
    expect(result.health).toEqual({ state: 'ok', issues: [] })
    expect(result.sourceVersion).toBeNull()
    expect(storeWriteProtection()).toBeNull()
  })

  it('合法 v2：条目全载入、ok、可写', async () => {
    await writeStore({ version: 2, devices: [v2Meta()] })
    const result = await readDeviceStore()
    expect(result.metas).toHaveLength(1)
    expect(result.health.state).toBe('ok')
    expect(result.sourceVersion).toBe(2)
    expect(storeWriteProtection()).toBeNull()
  })

  it('v2 坏条目：read-only + entryIndex 诊断 + suspectIds，好条目仍可读可启动', async () => {
    await writeStore({ version: 2, devices: [v2Meta(), { id: 'broken', name: 42 }] })
    const result = await readDeviceStore()
    expect(result.metas).toHaveLength(1)
    expect(result.health.state).toBe('read-only')
    expect(result.health.issues).toEqual([
      { code: 'invalid-entry', entryIndex: 1, message: expect.stringContaining('（id）') }
    ])
    expect(result.suspectIds).toEqual([]) // 非 UUID id 不进关联表
    // read-only 冻结写入
    await expect(writeDeviceMetas([v2Meta()])).rejects.toThrow('已写保护')
  })

  it('v2 重复 id：该 id 全部条目排除、两条诊断、suspectIds 命中', async () => {
    const dup = v2Meta({ name: '重名机' })
    const other = v2Meta({
      id: '0f0d3e26-7f63-4a8e-9d1a-3b0c6f001102',
      name: '另一台'
    })
    await writeStore({ version: 2, devices: [dup, other, dup] })
    const result = await readDeviceStore()
    expect(result.metas.map((meta) => meta.id)).toEqual([other.id])
    expect(result.health.state).toBe('read-only')
    expect(result.health.issues.map((issue) => issue.code)).toEqual([
      'duplicate-id',
      'duplicate-id'
    ])
    expect(result.suspectIds).toEqual([dup.id])
  })

  it('v2 字段完整校验：包名逃逸段/非法形态/坏设置形状各判 invalid-entry', async () => {
    const escape = v2Meta({
      id: '0f0d3e26-7f63-4a8e-9d1a-3b0c6f001103',
      imagePackageName: 'system-images;..;google_apis;arm64-v8a'
    })
    const badFactor = v2Meta({
      id: '0f0d3e26-7f63-4a8e-9d1a-3b0c6f001104',
      formFactor: 'foldable' as DeviceMeta['formFactor']
    })
    const badSettings = v2Meta({
      id: '0f0d3e26-7f63-4a8e-9d1a-3b0c6f001105',
      advancedSettings: { bootMode: 'hot' } as unknown as DeviceMeta['advancedSettings']
    })
    const longName = v2Meta({
      id: '0f0d3e26-7f63-4a8e-9d1a-3b0c6f001106',
      name: 'x'.repeat(51)
    })
    await writeStore({ version: 2, devices: [escape, badFactor, badSettings, longName] })
    const result = await readDeviceStore()
    expect(result.metas).toEqual([])
    expect(result.health.state).toBe('read-only')
    expect(result.health.issues.map((issue) => issue.message)).toEqual([
      expect.stringContaining('imagePackageName'),
      expect.stringContaining('formFactor'),
      expect.stringContaining('advancedSettings'),
      expect.stringContaining('name')
    ])
    expect(result.suspectIds).toEqual([escape.id, badFactor.id, badSettings.id, longName.id])
  })

  it('旧合法设置不判损坏：Quick 已存、缺 hostDeviceId 的 webcam、null 均通过', async () => {
    const quick = v2Meta({
      id: '0f0d3e26-7f63-4a8e-9d1a-3b0c6f001107',
      advancedSettings: {
        skinRef: null,
        frontCamera: { mode: 'webcam', deviceId: 'webcam0' },
        rearCamera: { mode: 'emulated', deviceId: null },
        networkSpeed: null,
        networkLatency: null,
        orientation: null,
        bootMode: 'quick',
        internalStorageMiB: 2048,
        cpuCores: 4,
        graphics: 'host',
        ramMiB: 2048,
        vmHeapMiB: 256,
        preferredAbi: 'optimal'
      }
    })
    await writeStore({ version: 2, devices: [quick] })
    const result = await readDeviceStore()
    expect(result.health.state).toBe('ok')
    expect(result.metas).toHaveLength(1)
  })

  it('screenSummary/advancedSettings 为 null 的合法 v2 记录不判坏（真实数据回归：2026-10-08 冻结事故）', async () => {
    // 与真机 devices.json 逐字段同构的记录——此前 screenSummary null 被误判
    // invalid-entry，导致整库 read-only + 设备行消失 + 自身 AVD 成「关联组」
    const realWorld = v2Meta({
      id: '5e5b1d65-19e0-4e9e-bbdc-615ed2370762',
      name: 'Pixel 8 API 32',
      imagePackageName: 'system-images;android-32;default;arm64-v8a',
      apiDisplay: '32',
      formFactor: 'unknown',
      screenSummary: null,
      advancedSettings: null,
      snapshotReadyAt: null,
      createdAt: 1791213247885
    })
    await writeStore({ version: 2, devices: [realWorld] })
    const result = await readDeviceStore()
    expect(result.health).toEqual({ state: 'ok', issues: [] })
    expect(result.metas).toHaveLength(1)
    expect(result.metas[0]?.id).toBe('5e5b1d65-19e0-4e9e-bbdc-615ed2370762')
    expect(result.sourceVersion).toBe(2)
    expect(storeWriteProtection()).toBeNull()
  })

  it('v1 文件：合法旧记录派生精确身份（arm64 + 变体反推），坏条目诊断不阻断', async () => {
    await writeStore({
      version: 1,
      devices: [
        {
          id: '0f0d3e26-7f63-4a8e-9d1a-3b0c6f001108',
          name: '旧设备',
          profileId: 'pixel_8',
          profileLabel: 'Pixel 8',
          apiLevel: 34,
          variant: 'google_play',
          createdAt: 100
        },
        { id: 'old-bad', apiLevel: 'x' }
      ]
    })
    const result = await readDeviceStore()
    expect(result.metas).toHaveLength(1)
    expect(result.metas[0]).toMatchObject({
      imagePackageName: 'system-images;android-34;google_apis_playstore;arm64-v8a',
      apiDisplay: '34',
      formFactor: 'unknown',
      screenSummary: null,
      advancedSettings: null
    })
    expect(result.sourceVersion).toBe(1)
    expect(result.health.state).toBe('read-only')
    expect(result.health.issues[0]?.entryIndex).toBe(1)
  })

  it('损坏 JSON / 顶层非对象 / 缺 devices 数组 / 未知版本：error + 原文件保留 + 写保护', async () => {
    await writeFile(storeFile(), '{not json', 'utf8')
    let result = await readDeviceStore()
    expect(result.health).toMatchObject({ state: 'error', issues: [{ code: 'invalid-json' }] })
    expect(await readFile(storeFile(), 'utf8')).toBe('{not json')
    expect(storeWriteProtection()).toContain('不是合法 JSON')

    await writeFile(storeFile(), '[1,2]', 'utf8')
    result = await readDeviceStore()
    expect(result.health.issues[0]?.code).toBe('invalid-top-level')

    await writeStore({ version: 2 })
    result = await readDeviceStore()
    expect(result.health.issues[0]?.code).toBe('missing-devices-array')

    await writeStore({ version: 99, devices: [] })
    result = await readDeviceStore()
    expect(result.health.issues[0]?.code).toBe('unknown-version')
    expect(storeWriteProtection()).toContain('版本未知')
    await expect(writeDeviceMetas([v2Meta()])).rejects.toThrow('已写保护')
  })

  it('受控解除：坏文件读成保护态 → 修复后 readDeviceStore ok 解除 → 写入通过', async () => {
    await writeFile(storeFile(), '{not json', 'utf8')
    await readDeviceStore()
    expect(storeWriteProtection()).not.toBeNull()
    await writeStore({ version: 2, devices: [v2Meta()] })
    const result = await readDeviceStore()
    expect(result.health.state).toBe('ok')
    expect(storeWriteProtection()).toBeNull()
    await expect(writeDeviceMetas([v2Meta()])).resolves.toBeUndefined()
  })

  it('armStoreProtection：生产侧再次武装（外部变化用），写入拒绝', async () => {
    armStoreProtection('devices.json 已被外部修改')
    await expect(writeDeviceMetas([v2Meta()])).rejects.toThrow('已被外部修改')
  })
})

describe('classifyReadError（errno 归因）', () => {
  it('只有 ENOENT 是首次使用；EACCES/EIO 归因读取失败', () => {
    expect(
      classifyReadError(Object.assign(new Error('no such file'), { code: 'ENOENT' })).code
    ).toBe('ENOENT')
    expect(classifyReadError(Object.assign(new Error('denied'), { code: 'EACCES' })).code).toBe(
      'EACCES'
    )
    expect(classifyReadError(Object.assign(new Error('io'), { code: 'EIO' })).code).toBe('EIO')
    expect(classifyReadError(new Error('plain')).code).toBe('read-failed')
  })

  it('EACCES 文件：error 而非空库（真实 chmod）', async () => {
    await writeStore({ version: 2, devices: [v2Meta()] })
    const { chmod } = await import('node:fs/promises')
    await chmod(storeFile(), 0o000)
    const result = await readDeviceStore()
    // 容器/CI 以 root 运行时 EACCES 可能不生效——按 errno 分支断言，不冒充空库即可
    if (result.health.state === 'error') {
      expect(result.health.issues[0]?.code).not.toBe('ENOENT')
      expect(result.metas).toEqual([])
      expect(storeWriteProtection()).not.toBeNull()
    }
    await chmod(storeFile(), 0o644)
  })
})

describe('store 写入与备份', () => {
  it('首次写入 v2 覆盖 v1 前留备份；再次写入不重复备份', async () => {
    await writeStore({
      version: 1,
      devices: [
        {
          id: '0f0d3e26-7f63-4a8e-9d1a-3b0c6f001109',
          name: '旧',
          profileId: 'p',
          profileLabel: 'P',
          apiLevel: 34,
          variant: 'aosp',
          createdAt: 1
        }
      ]
    })
    await writeDeviceMetas([v2Meta()])
    const backup = join(userDataDir, 'devices.json.v1-backup')
    const backupRaw = JSON.parse(await readFile(backup, 'utf8')) as { version: number }
    expect(backupRaw.version).toBe(1)
    const current = JSON.parse(await readFile(storeFile(), 'utf8')) as { version: number }
    expect(current.version).toBe(2)
    // 再写一次：备份仍是旧的那份（不重复覆盖）
    await writeDeviceMetas([v2Meta({ id: '0f0d3e26-7f63-4a8e-9d1a-3b0c6f00110a' })])
    const files = await readdir(userDataDir)
    expect(files.filter((name) => name.includes('v1-backup'))).toHaveLength(1)
  })

  it('v2 之上再写不产生备份', async () => {
    await writeDeviceMetas([v2Meta()])
    await writeDeviceMetas([v2Meta({ id: '0f0d3e26-7f63-4a8e-9d1a-3b0c6f00110b' })])
    const files = await readdir(userDataDir)
    expect(files.some((name) => name.includes('v1-backup'))).toBe(false)
  })

  it('对账读取不写盘、不因查看生成备份（v1 库只读仍是 v1）', async () => {
    const v1Payload = { version: 1, devices: [] }
    await writeStore(v1Payload)
    await readDeviceStore()
    expect(JSON.parse(await readFile(storeFile(), 'utf8'))).toEqual(v1Payload)
    const files = await readdir(userDataDir)
    expect(files.some((name) => name.includes('v1-backup'))).toBe(false)
  })
})

describe('store review 修复轮（P2-4/P3 回归锚）', () => {
  it('v1 非 UUID id：按坏条目诊断不载入（不再绕过重复检测/延迟冻结）', async () => {
    await writeStore({
      version: 1,
      devices: [
        {
          id: 'old1',
          name: '手改 id',
          profileId: 'p',
          profileLabel: 'P',
          apiLevel: 34,
          variant: 'aosp',
          createdAt: 1
        },
        {
          id: 'old1',
          name: '重复 id',
          profileId: 'p',
          profileLabel: 'P',
          apiLevel: 35,
          variant: 'aosp',
          createdAt: 2
        }
      ]
    })
    const result = await readDeviceStore()
    expect(result.metas).toEqual([])
    expect(result.health.state).toBe('read-only')
    expect(result.health.issues.map((issue) => issue.code)).toEqual([
      'invalid-entry',
      'invalid-entry'
    ])
    expect(result.suspectIds).toEqual([]) // 非 UUID 不进关联表
    expect(result.sourceVersion).toBe(1)
  })

  it('screenSummary 坏形状对象 / 负数时间戳 / 数值 apiDisplay / webcam+null deviceId 各判 invalid-entry', async () => {
    const badSummary = v2Meta({
      id: '0f0d3e26-7f63-4a8e-9d1a-3b0c6f00110c',
      screenSummary: { widthPx: 'wide' } as unknown as DeviceMeta['screenSummary']
    })
    const negativeCreated = v2Meta({
      id: '0f0d3e26-7f63-4a8e-9d1a-3b0c6f00110d',
      createdAt: -1
    })
    const numericApi = v2Meta({
      id: '0f0d3e26-7f63-4a8e-9d1a-3b0c6f00110e',
      apiDisplay: 36 as unknown as DeviceMeta['apiDisplay']
    })
    const webcamNull = v2Meta({
      id: '0f0d3e26-7f63-4a8e-9d1a-3b0c6f00110f',
      advancedSettings: {
        skinRef: null,
        frontCamera: { mode: 'webcam', deviceId: null },
        rearCamera: { mode: 'emulated', deviceId: null },
        networkSpeed: null,
        networkLatency: null,
        orientation: null,
        bootMode: 'cold',
        internalStorageMiB: 2048,
        cpuCores: 4,
        graphics: 'host',
        ramMiB: 2048,
        vmHeapMiB: 256,
        preferredAbi: 'optimal'
      }
    })
    await writeStore({ version: 2, devices: [badSummary, negativeCreated, numericApi, webcamNull] })
    const result = await readDeviceStore()
    expect(result.metas).toEqual([])
    expect(result.health.state).toBe('read-only')
    expect(result.health.issues.map((issue) => issue.message)).toEqual([
      expect.stringContaining('screenSummary'),
      expect.stringContaining('createdAt'),
      expect.stringContaining('apiDisplay'),
      expect.stringContaining('advancedSettings')
    ])
  })

  it('载入投影：未知顶层键与嵌套多余键不进内存，也不随写回盘', async () => {
    const settings = {
      skinRef: null,
      frontCamera: { mode: 'emulated', deviceId: null },
      rearCamera: { mode: 'emulated', deviceId: null },
      networkSpeed: null,
      networkLatency: null,
      orientation: null,
      bootMode: 'cold',
      internalStorageMiB: 2048,
      cpuCores: 4,
      graphics: 'host',
      ramMiB: 2048,
      vmHeapMiB: 256,
      preferredAbi: 'optimal'
    }
    ;(settings.frontCamera as Record<string, unknown>).evilNested = 'x'
    ;(settings as Record<string, unknown>).unknownSetting = 'y'
    const noisy = {
      ...v2Meta({ advancedSettings: settings as DeviceMeta['advancedSettings'] }),
      serial: 'fake-serial',
      runId: 'fake-run',
      extraTop: true
    } as Record<string, unknown>
    noisy.screenSummary = { ...(noisy.screenSummary as object), extra: 1 }
    await writeStore({ version: 2, devices: [noisy] })
    const result = await readDeviceStore()
    expect(result.health.state).toBe('ok')
    const meta = result.metas[0] as unknown as Record<string, unknown>
    expect(meta.serial).toBeUndefined()
    expect(meta.extraTop).toBeUndefined()
    expect((meta.screenSummary as Record<string, unknown>).extra).toBeUndefined()
    const projectedSettings = meta.advancedSettings as Record<string, unknown>
    expect(projectedSettings.unknownSetting).toBeUndefined()
    expect((projectedSettings.frontCamera as Record<string, unknown>).evilNested).toBeUndefined()
    // 写回磁盘的内容同样不含未知键
    await writeDeviceMetas(result.metas)
    const onDisk = JSON.parse(await readFile(storeFile(), 'utf8')) as {
      devices: Array<Record<string, unknown>>
    }
    expect(onDisk.devices[0].serial).toBeUndefined()
    expect(onDisk.devices[0].extraTop).toBeUndefined()
  })

  it('写保护置位时写入不产生任何 tmp/备份残留', async () => {
    await writeFile(storeFile(), '{bad', 'utf8')
    await readDeviceStore() // 置保护
    await expect(writeDeviceMetas([v2Meta()])).rejects.toThrow('已写保护')
    const files = await readdir(userDataDir)
    expect(files.filter((name) => name.includes('.tmp') || name.includes('v1-backup'))).toEqual([])
  })

  it('现存文件读失败（非 ENOENT）→ 写入中止拒绝盲覆盖（真实 chmod，root 环境降级）', async () => {
    const { chmod } = await import('node:fs/promises')
    await writeStore({ version: 2, devices: [v2Meta()] })
    resetStoreProtection()
    await chmod(storeFile(), 0o000)
    try {
      const attempt = writeDeviceMetas([v2Meta()])
      const outcome = await attempt.then(
        () => 'written',
        (error: unknown) => (error instanceof Error ? error.message : String(error))
      )
      if (outcome !== 'written') {
        expect(outcome).toContain('中止')
      }
      // root 环境 chmod 不生效时允许写入成功（与既有条件断言口径一致）
    } finally {
      await chmod(storeFile(), 0o644)
    }
  })
})
