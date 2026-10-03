import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { isPackageNameInstalled, parseSysImgManifest, packageNameFor } from '../catalog'

const tmpDirs: string[] = []
const makeTmp = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), 'mst-cat-'))
  tmpDirs.push(dir)
  return dir
}
afterAll(async () => {
  await Promise.all(tmpDirs.map((dir) => rm(dir, { recursive: true, force: true })))
})

const FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<sdk:sdk-repository xmlns:sdk="http://schemas.android.com/sdk/android/repo/repository2/03">
  <remotePackage path="system-images;android-36;default;arm64-v8a">
    <type-details xsi:type="sys-img:sysImgDetailsType">
      <api-level>36</api-level>
      <tag><id>default</id><display>Default Android System Image</display></tag>
      <abi>arm64-v8a</abi>
    </type-details>
    <revision><major>2</major></revision>
    <channelRef ref="channel-0"/>
    <archives><archive><complete>
      <size>810736863</size>
      <checksum type="sha1">abc</checksum>
      <url>arm64-v8a-36_r02.zip</url>
    </complete></archive></archives>
  </remotePackage>
  <remotePackage path="system-images;android-36;google_apis;arm64-v8a">
    <type-details xsi:type="sys-img:sysImgDetailsType">
      <api-level>36</api-level>
      <tag><id>google_apis</id><display>Google APIs</display></tag>
      <abi>arm64-v8a</abi>
    </type-details>
    <channelRef ref="channel-1"/>
    <archives><archive><complete><size>900</size><checksum type="sha1">def</checksum><url>x.zip</url></complete></archive></archives>
  </remotePackage>
  <remotePackage path="system-images;android-35;google_apis_playstore;x86_64">
    <type-details xsi:type="sys-img:sysImgDetailsType">
      <api-level>35</api-level>
      <tag><id>google_apis_playstore</id><display>Google Play</display></tag>
      <abi>x86_64</abi>
    </type-details>
    <channelRef ref="channel-0"/>
    <archives><archive><complete><size>800</size><checksum type="sha1">ghi</checksum><url>y.zip</url></complete></archive></archives>
  </remotePackage>
  <remotePackage path="system-images;android-36;google_apis;arm64-v8a-broken">
    <type-details xsi:type="sys-img:sysImgDetailsType">
      <api-level>36</api-level>
      <tag><id>google_apis</id><display>Google APIs</display></tag>
    </type-details>
    <channelRef ref="channel-0"/>
  </remotePackage>
</sdk:sdk-repository>
`

describe('parseSysImgManifest', () => {
  it('aosp（default tag）条目解析出体积与 api', () => {
    const entries = parseSysImgManifest(FIXTURE, 'aosp')
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      packageName: 'system-images;android-36;default;arm64-v8a',
      apiLevel: 36,
      tag: 'default',
      abi: 'arm64-v8a',
      sizeBytes: 810736863,
      channel: 0
    })
  })

  it('变体过滤：google_apis 只吃同 tag 条目', () => {
    const entries = parseSysImgManifest(FIXTURE, 'google_apis')
    expect(entries).toHaveLength(1)
    expect(entries[0].channel).toBe(1)
  })

  it('坏条目（缺 abi/size）跳过不炸', () => {
    const entries = parseSysImgManifest(FIXTURE, 'google_apis')
    expect(entries.some((entry) => entry.packageName.includes('broken'))).toBe(false)
  })
})

describe('isPackageNameInstalled', () => {
  it('镜像目录存在且非空 → true', async () => {
    const root = await makeTmp()
    const dir = join(root, 'system-images', 'android-32', 'default', 'arm64-v8a')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'package.xml'), '<xml/>', 'utf8')
    await expect(
      isPackageNameInstalled(root, 'system-images;android-32;default;arm64-v8a')
    ).resolves.toBe(true)
  })

  it('空目录与缺失目录 → false（守卫的回归锁：split 错位会取空 abi）', async () => {
    const root = await makeTmp()
    const dir = join(root, 'system-images', 'android-33', 'default', 'arm64-v8a')
    await mkdir(dir, { recursive: true })
    await expect(
      isPackageNameInstalled(root, 'system-images;android-33;default;arm64-v8a')
    ).resolves.toBe(false)
    await expect(
      isPackageNameInstalled(root, 'system-images;android-34;google_apis;arm64-v8a')
    ).resolves.toBe(false)
  })
})

describe('packageNameFor', () => {
  it('变体映射到 manifest 命名（aosp→default，google_play→google_apis_playstore）', () => {
    expect(packageNameFor(36, 'aosp')).toBe('system-images;android-36;default;arm64-v8a')
    expect(packageNameFor(36, 'google_apis')).toBe('system-images;android-36;google_apis;arm64-v8a')
    expect(packageNameFor(36, 'google_play')).toBe(
      'system-images;android-36;google_apis_playstore;arm64-v8a'
    )
  })
})
