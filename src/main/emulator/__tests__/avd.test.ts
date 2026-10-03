import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { ImageEntry } from '@shared/types'
import { createAvd, deleteAvd, avdExists } from '../avd'
import { DEVICE_PROFILES } from '../profiles'

const tmpDirs: string[] = []
const makeTmp = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), 'mst-avd-'))
  tmpDirs.push(dir)
  return dir
}
afterAll(async () => {
  await Promise.all(tmpDirs.map((dir) => rm(dir, { recursive: true, force: true })))
})

const entry: ImageEntry = {
  packageName: 'system-images;android-36;google_apis_playstore;arm64-v8a',
  apiLevel: 36,
  variant: 'google_play',
  abi: 'arm64-v8a',
  installed: true,
  sizeBytes: 1_500_000_000
}

const profile = DEVICE_PROFILES.find((item) => item.id === 'pixel_8')!

describe('createAvd', () => {
  it('写 .ini + config.ini，镜像路径与变体映射正确', async () => {
    const avdHome = await makeTmp()
    const dir = await createAvd({ avdName: 'mst-it-1', profile, entry }, { avdHome })
    expect(dir).toBe(join(avdHome, 'mst-it-1.avd'))
    const ini = await readFile(join(avdHome, 'mst-it-1.ini'), 'utf8')
    expect(ini).toContain('path=' + join(avdHome, 'mst-it-1.avd'))
    expect(ini).toContain('target=android-36')
    const config = await readFile(join(avdHome, 'mst-it-1.avd', 'config.ini'), 'utf8')
    expect(config).toContain(
      'image.sysdir.1=system-images/android-36/google_apis_playstore/arm64-v8a/'
    )
    expect(config).toContain('tag.id=google_apis_playstore')
    expect(config).toContain('PlayStore.enabled=true')
    expect(config).toContain('hw.lcd.width=1080')
    expect(config).toContain('hw.ramSize=2048')
    expect(await avdExists('mst-it-1', { avdHome })).toBe(true)
  })

  it('aosp 变体映射到 default 目录且 PlayStore 关闭', async () => {
    const avdHome = await makeTmp()
    await createAvd(
      {
        avdName: 'mst-aosp',
        profile,
        entry: {
          ...entry,
          variant: 'aosp',
          packageName: 'system-images;android-36;default;arm64-v8a'
        }
      },
      { avdHome }
    )
    const config = await readFile(join(avdHome, 'mst-aosp.avd', 'config.ini'), 'utf8')
    expect(config).toContain('image.sysdir.1=system-images/android-36/default/arm64-v8a/')
    expect(config).toContain('PlayStore.enabled=false')
  })

  it('非法 AVD 名（路径穿越）拒绝', async () => {
    const avdHome = await makeTmp()
    await expect(createAvd({ avdName: '../escape', profile, entry }, { avdHome })).rejects.toThrow(
      '非法 AVD 名'
    )
  })

  it('重复创建拒绝', async () => {
    const avdHome = await makeTmp()
    await createAvd({ avdName: 'mst-dup', profile, entry }, { avdHome })
    await expect(createAvd({ avdName: 'mst-dup', profile, entry }, { avdHome })).rejects.toThrow(
      'AVD 已存在'
    )
  })
})

describe('deleteAvd', () => {
  it('目录与 ini 一并删除', async () => {
    const avdHome = await makeTmp()
    await createAvd({ avdName: 'mst-del', profile, entry }, { avdHome })
    await deleteAvd('mst-del', { avdHome })
    expect(await avdExists('mst-del', { avdHome })).toBe(false)
    await expect(mkdir(join(avdHome, 'mst-del.avd'))).resolves.toBeUndefined()
  })

  it('文件缺失按已删成功（force 语义）', async () => {
    const avdHome = await makeTmp()
    await expect(deleteAvd('mst-never-existed', { avdHome })).resolves.toBeUndefined()
  })
})
