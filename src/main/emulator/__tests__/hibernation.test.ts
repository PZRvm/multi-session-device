// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import {
  HIBERNATION_SNAPSHOT_PREFIX,
  cleanupOldHibernationSnapshots,
  hardwareFingerprintOf,
  hibernationManifestPath,
  newHibernationSnapshotName,
  readHibernationManifest,
  waitHibernationSnapshotStable,
  writeHibernationManifest,
  type HibernationManifest
} from '../hibernation'
import type { AvdDirs } from '../avd'

const dirs: AvdDirs = { avdHome: '/avd-home', sdkRoot: '/sdk' }

const validManifest = (overrides: Partial<HibernationManifest> = {}): HibernationManifest => ({
  schemaVersion: 1,
  deviceId: 'dev-1',
  snapshotName: 'msd-hib-abc12345',
  savedAt: 123,
  guestBootId: 'boot-1',
  stage: 'hibernated',
  emulatorVersion: '36.1.9',
  imagePackageName: 'system-images;android-36.1;google_apis;arm64-v8a',
  imageRevision: 1,
  gpuBackend: 'host',
  hardwareFingerprint: 'fp',
  ...overrides
})

const memoryFs = (): {
  files: Map<string, string>
  deps: {
    readFile: (path: string) => Promise<string>
    writeFile: (path: string, data: string) => Promise<void>
    rename: (from: string, to: string) => Promise<void>
  }
} => {
  const files = new Map<string, string>()
  return {
    files,
    deps: {
      readFile: async (path: string) => {
        const content = files.get(path)
        if (content === undefined) throw new Error('ENOENT')
        return content
      },
      writeFile: async (path: string, data: string) => {
        files.set(path, data)
      },
      rename: async (from: string, to: string) => {
        const content = files.get(from)
        if (content === undefined) throw new Error('ENOENT')
        files.delete(from)
        files.set(to, content)
      }
    }
  }
}

describe('休眠清单（msd-hibernation.json）', () => {
  it('路径派生：单设备 AVD 目录内，固定文件名', () => {
    expect(hibernationManifestPath('dev-1', dirs)).toBe('/avd-home/dev-1.avd/msd-hibernation.json')
  })

  it('快照名：应用独占前缀 + 唯一后缀，两次生成不同', () => {
    const a = newHibernationSnapshotName()
    const b = newHibernationSnapshotName()
    expect(a.startsWith(HIBERNATION_SNAPSHOT_PREFIX)).toBe(true)
    expect(a).not.toBe(b)
  })

  it('写 → 读往返；原子写经 tmp+rename（完成后仅剩目标文件）', async () => {
    const fs = memoryFs()
    const manifest = validManifest()
    await writeHibernationManifest('dev-1', manifest, dirs, fs.deps)
    const target = hibernationManifestPath('dev-1', dirs)
    expect([...fs.files.keys()]).toEqual([target])
    const read = await readHibernationManifest('dev-1', dirs, { readFile: fs.deps.readFile })
    expect(read).toEqual({ kind: 'ok', manifest })
  })

  it('缺失 = none；半写/坏 JSON = corrupt；未知 schema/形状非法 = corrupt', async () => {
    const fs = memoryFs()
    expect(await readHibernationManifest('dev-1', dirs, { readFile: fs.deps.readFile })).toEqual({
      kind: 'none'
    })
    const target = hibernationManifestPath('dev-1', dirs)
    fs.files.set(target, '{half')
    expect(
      await readHibernationManifest('dev-1', dirs, { readFile: fs.deps.readFile })
    ).toMatchObject({ kind: 'corrupt' })
    fs.files.set(target, JSON.stringify({ schemaVersion: 2 }))
    expect(
      await readHibernationManifest('dev-1', dirs, { readFile: fs.deps.readFile })
    ).toMatchObject({ kind: 'corrupt' })
    // 非独占前缀快照名/未知阶段均拒绝
    fs.files.set(target, JSON.stringify(validManifest({ snapshotName: 'default_boot' })))
    expect(
      await readHibernationManifest('dev-1', dirs, { readFile: fs.deps.readFile })
    ).toMatchObject({ kind: 'corrupt' })
    fs.files.set(target, JSON.stringify(validManifest({ stage: 'unknown' as never })))
    expect(
      await readHibernationManifest('dev-1', dirs, { readFile: fs.deps.readFile })
    ).toMatchObject({ kind: 'corrupt' })
  })

  it('deviceId 不匹配 = corrupt（防误挂到别的设备）', async () => {
    const fs = memoryFs()
    fs.files.set(
      hibernationManifestPath('dev-1', dirs),
      JSON.stringify(validManifest({ deviceId: 'dev-2' }))
    )
    expect(
      await readHibernationManifest('dev-1', dirs, { readFile: fs.deps.readFile })
    ).toMatchObject({
      kind: 'corrupt',
      reason: 'device id mismatch'
    })
  })

  it('指纹：参与键取值变化即变化，缺席键用 - 占位', () => {
    const base = hardwareFingerprintOf({
      imagePackageName: 'pkg',
      imageRevision: 1,
      emulatorVersion: '36.1.9',
      gpuBackend: 'host',
      cpuCores: '4',
      ramMiB: '2048',
      vmHeapMiB: '256',
      cameraFront: 'emulated',
      cameraBack: 'webcam0',
      lcdWidth: '1080',
      lcdHeight: '2400',
      lcdDensity: '420'
    })
    expect(
      hardwareFingerprintOf({
        imagePackageName: 'pkg',
        imageRevision: 1,
        emulatorVersion: '36.1.9',
        gpuBackend: 'host',
        cpuCores: '4',
        ramMiB: '3072',
        vmHeapMiB: '256',
        cameraFront: 'emulated',
        cameraBack: 'webcam0',
        lcdWidth: '1080',
        lcdHeight: '2400',
        lcdDensity: '420'
      })
    ).not.toBe(base)
    expect(
      hardwareFingerprintOf({
        imagePackageName: 'pkg',
        imageRevision: null,
        emulatorVersion: null,
        gpuBackend: 'host',
        cpuCores: null,
        ramMiB: null,
        vmHeapMiB: null,
        cameraFront: null,
        cameraBack: null,
        lcdWidth: null,
        lcdHeight: null,
        lcdDensity: null
      })
    ).toBe('pkg|-|-|host|-|-|-|-|-|-|-|-')
  })
})

describe('快照写盘稳定性探测（PoC：OK 只是受理，写盘异步）', () => {
  it('首字节出现后大小稳定即返回', async () => {
    const sizes = [0, 0, 500, 900, 900]
    const dirKiB = vi.fn(async () => sizes.shift() ?? 900)
    const kib = await waitHibernationSnapshotStable(
      '/snap',
      { firstByteBudgetMs: 1_000, stableBudgetMs: 1_000, intervalMs: 1 },
      { dirKiB, sleep: async () => undefined }
    )
    expect(kib).toBe(900)
  })

  it('首字节预算耗尽抛错（不得冒充保存完成）', async () => {
    const dirKiB = vi.fn(async () => 0)
    await expect(
      waitHibernationSnapshotStable(
        '/snap',
        { firstByteBudgetMs: 50, stableBudgetMs: 1_000, intervalMs: 5 },
        { dirKiB, sleep: async () => undefined }
      )
    ).rejects.toThrow('zero bytes')
  })

  it('大小持续增长不判稳', async () => {
    let size = 0
    const dirKiB = vi.fn(async () => {
      size += 100
      return size
    })
    await expect(
      waitHibernationSnapshotStable(
        '/snap',
        { firstByteBudgetMs: 1_000, stableBudgetMs: 60, intervalMs: 5 },
        { dirKiB, sleep: async () => undefined }
      )
    ).rejects.toThrow('stabilize')
  })
})

describe('旧休眠快照清理（进程退出后安全窗口）', () => {
  it('只删独占前缀且保留 keepName；不碰 default_boot 与无关目录', async () => {
    const removed: string[] = []
    const readdir = vi.fn(async () => [
      'msd-hib-old1',
      'msd-hib-keepme',
      'default_boot',
      'unrelated'
    ])
    const rm = vi.fn(async (path: string) => {
      removed.push(path)
    })
    await cleanupOldHibernationSnapshots('dev-1', 'msd-hib-keepme', dirs, undefined, {
      readdir: readdir as never,
      rm: rm as never
    })
    expect(removed).toEqual(['/avd-home/dev-1.avd/snapshots/msd-hib-old1'])
  })

  it('清理失败不抛——经 onWarning 留痕', async () => {
    const onWarning = vi.fn()
    const readdir = vi.fn(async () => {
      throw new Error('EACCES')
    })
    await expect(
      cleanupOldHibernationSnapshots('dev-1', null, dirs, onWarning, {
        readdir: readdir as never
      })
    ).resolves.toBeUndefined()
    expect(onWarning).toHaveBeenCalledTimes(1)
  })
})
