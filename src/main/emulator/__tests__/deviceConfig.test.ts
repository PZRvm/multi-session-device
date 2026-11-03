// @vitest-environment node
import { mkdtemp, mkdir, readFile, symlink, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import type { DeviceAdvancedSettings, DeviceMeta } from '@shared/types'
import {
  applyConfigPatchToText,
  buildConfigEditPatch,
  configFingerprintOf,
  parseConfigEntries,
  readAvdConfigRaw,
  readHardwareSchemaDefaults,
  storageMiBFromText,
  writeAvdConfigRaw,
  MAX_CONFIG_BYTES
} from '../deviceConfig'

const dirsOf = (avdHome: string): { avdHome: string; sdkRoot: string } => ({
  avdHome,
  sdkRoot: join(avdHome, 'sdk')
})

const metaOf = (overrides: Partial<DeviceMeta> = {}): DeviceMeta => ({
  id: '018f1c2d-0000-4000-8000-000000000001',
  name: '设备',
  profileId: 'pixel_8',
  profileLabel: 'Pixel 8',
  imagePackageName: 'system-images;android-34;default;arm64-v8a',
  apiDisplay: '34',
  formFactor: 'phone',
  screenSummary: null,
  advancedSettings: null,
  snapshotReadyAt: null,
  createdAt: 0,
  ...overrides
})

const settingsOf = (overrides: Partial<DeviceAdvancedSettings> = {}): DeviceAdvancedSettings => ({
  skinRef: null,
  frontCamera: { mode: 'emulated', deviceId: null },
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
  preferredAbi: 'optimal',
  ...overrides
})

describe('readAvdConfigRaw（受控读取）', () => {
  let root: string
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'msd-device-config-'))
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('读取存在的 config.ini；同键多行以最后一处为准由 parse 处理', async () => {
    const dirs = dirsOf(root)
    await mkdir(join(dirs.avdHome, 'a.avd'), { recursive: true })
    await writeFile(join(dirs.avdHome, 'a.avd', 'config.ini'), 'hw.ramSize=2048\n', 'utf8')
    await expect(readAvdConfigRaw('a', dirs)).resolves.toBe('hw.ramSize=2048\n')
  })

  it('文件不存在返回 null（legacy 语义）', async () => {
    await expect(readAvdConfigRaw('missing', dirsOf(root))).resolves.toBeNull()
  })

  it('symlink 拒绝读取', async () => {
    const dirs = dirsOf(root)
    await mkdir(join(dirs.avdHome, 'a.avd'), { recursive: true })
    await writeFile(join(root, 'target.ini'), 'x=1\n', 'utf8')
    await symlink(join(root, 'target.ini'), join(dirs.avdHome, 'a.avd', 'config.ini'))
    await expect(readAvdConfigRaw('a', dirs)).rejects.toThrow('符号链接')
  })

  it('超过大小上限拒绝', async () => {
    const dirs = dirsOf(root)
    await mkdir(join(dirs.avdHome, 'a.avd'), { recursive: true })
    await writeFile(
      join(dirs.avdHome, 'a.avd', 'config.ini'),
      `key=${'v'.repeat(MAX_CONFIG_BYTES)}`,
      'utf8'
    )
    await expect(readAvdConfigRaw('a', dirs)).rejects.toThrow('大小上限')
  })

  it('writeAvdConfigRaw 原子替换后再读一致', async () => {
    const dirs = dirsOf(root)
    await mkdir(join(dirs.avdHome, 'a.avd'), { recursive: true })
    await writeAvdConfigRaw('a', dirs, 'hw.cpu.ncore=8\n')
    await expect(readFile(join(dirs.avdHome, 'a.avd', 'config.ini'), 'utf8')).resolves.toBe(
      'hw.cpu.ncore=8\n'
    )
  })

  it.each(['parent', 'root'] as const)(
    '%s 是指向外部的目录链接：读写都拒绝，外部原文保持',
    async (kind) => {
      const outside = join(root, 'outside')
      const home = join(root, 'home')
      await mkdir(join(outside, 'a.avd'), { recursive: true })
      const external = join(outside, 'a.avd', 'config.ini')
      await writeFile(external, 'external=1\n')
      if (kind === 'root') await symlink(outside, home)
      else {
        await mkdir(home)
        await symlink(join(outside, 'a.avd'), join(home, 'a.avd'))
      }
      await expect(readAvdConfigRaw('a', dirsOf(home))).rejects.toThrow(/符号链接|路径/)
      await expect(writeAvdConfigRaw('a', dirsOf(home), 'bad=1')).rejects.toThrow(/符号链接|路径/)
      await expect(readFile(external, 'utf8')).resolves.toBe('external=1\n')
    }
  )

  it('config 是目录：读写拒绝，不能将非普通文件当作配置', async () => {
    await mkdir(join(root, 'a.avd', 'config.ini'), { recursive: true })
    await expect(readAvdConfigRaw('a', dirsOf(root))).rejects.toThrow('普通文件')
    await expect(writeAvdConfigRaw('a', dirsOf(root), 'bad=1')).rejects.toThrow('普通文件')
  })

  it('写入时原文已变：拦截提交/回滚，不覆盖外部内容', async () => {
    const dir = join(root, 'a.avd')
    await mkdir(dir)
    await writeFile(join(dir, 'config.ini'), 'external=1\n')
    await expect(writeAvdConfigRaw('a', dirsOf(root), 'old=1\n', 'new=1\n')).rejects.toThrow(
      '外部修改'
    )
    expect(await readFile(join(dir, 'config.ini'), 'utf8')).toBe('external=1\n')
  })
})

describe('parseConfigEntries / storageMiBFromText', () => {
  it('注释与空行跳过；同键多行最后一处生效', () => {
    const map = parseConfigEntries('# 注释\nhw.ramSize=2048\n\nhw.ramSize=4096\nskin.name=Pixel\n')
    expect(map.get('hw.ramSize')).toBe('4096')
    expect(map.get('skin.name')).toBe('Pixel')
  })

  it('容量解析：M/G 后缀与字节数；不可识别返回 null', () => {
    expect(storageMiBFromText('6144M')).toBe(6144)
    expect(storageMiBFromText('6g')).toBe(6144)
    expect(storageMiBFromText('6442450944')).toBe(6144)
    expect(storageMiBFromText('6442450945')).toBeNull()
    expect(storageMiBFromText('abc')).toBeNull()
    expect(storageMiBFromText(undefined)).toBeNull()
  })
})

describe('configFingerprintOf', () => {
  it('配置字节或持久字段任一变化即指纹变化', () => {
    const meta = metaOf()
    const base = configFingerprintOf('a=1\n', meta)
    expect(configFingerprintOf('a=1\n', metaOf())).toBe(base)
    expect(configFingerprintOf('a=2\n', meta)).not.toBe(base)
    expect(configFingerprintOf('a=1\n', metaOf({ name: '改名' }))).not.toBe(base)
    expect(configFingerprintOf('a=1\n', metaOf({ snapshotReadyAt: 123 }))).not.toBe(base)
    expect(configFingerprintOf(null, meta)).not.toBe(base)
  })
})

describe('buildConfigEditPatch（白名单差异）', () => {
  const skinDirectoryFor = (ref: string): string => `/skins/${ref}`

  it('未变化字段不产生键；变化字段映射到白名单键', () => {
    const patch = buildConfigEditPatch(settingsOf(), settingsOf({ cpuCores: 8 }), {
      skinDirectoryFor
    })
    expect(patch.sets).toEqual({ 'hw.cpu.ncore': '8' })
    expect(patch.deletes).toEqual([])
  })

  it('RAM/heap/GPU/摄像头逐一映射；webcam 写资源 id', () => {
    const patch = buildConfigEditPatch(
      settingsOf(),
      settingsOf({
        ramMiB: 4096,
        vmHeapMiB: 512,
        graphics: 'host',
        frontCamera: { mode: 'webcam', deviceId: 'webcam0', hostDeviceId: 'FaceTime' }
      }),
      { skinDirectoryFor }
    )
    expect(patch.sets).toEqual({
      'hw.ramSize': '4096',
      'vm.heapSize': '512',
      'hw.gpu.mode': 'host',
      'hw.camera.front': 'webcam0'
    })
  })

  it.each([
    ['frontCamera', 'hw.camera.front'],
    ['rearCamera', 'hw.camera.back']
  ] as const)('编辑 %s 为虚拟场景：写入 emulator 识别的小写值', (field, key) => {
    const patch = buildConfigEditPatch(
      settingsOf(),
      settingsOf({ [field]: { mode: 'virtualScene', deviceId: null } }),
      { skinDirectoryFor }
    )
    expect(patch.sets).toEqual({ [key]: 'virtualscene' })
    expect(patch.deletes).toEqual([])
  })

  it('清空朝向删除 hw.initialOrientation；设置朝向写键', () => {
    const clear = buildConfigEditPatch(settingsOf({ orientation: 'portrait' }), settingsOf(), {
      skinDirectoryFor
    })
    expect(clear.deletes).toContain('hw.initialOrientation')
    const set = buildConfigEditPatch(settingsOf(), settingsOf({ orientation: 'landscape' }), {
      skinDirectoryFor
    })
    expect(set.sets['hw.initialOrientation']).toBe('landscape')
  })

  it('清空皮肤删除 skin.name/path/dynamic；sdk 皮肤不写 path；导入皮肤写绝对 path', () => {
    const clear = buildConfigEditPatch(settingsOf({ skinRef: 'sdk:pixel_8' }), settingsOf(), {
      skinDirectoryFor
    })
    expect(clear.deletes).toEqual(['skin.name', 'skin.path', 'skin.dynamic'])
    const sdk = buildConfigEditPatch(settingsOf(), settingsOf({ skinRef: 'sdk:pixel_8' }), {
      skinDirectoryFor
    })
    expect(sdk.sets['skin.name']).toBe('pixel_8')
    expect(sdk.sets['skin.path']).toBeUndefined()
    expect(sdk.deletes).toContain('skin.path')
    const imported = buildConfigEditPatch(settingsOf(), settingsOf({ skinRef: 'imported:u1' }), {
      skinDirectoryFor
    })
    expect(imported.sets['skin.path']).toBe('/skins/imported:u1')
  })

  it('存储键永不出现在编辑映射（防御断言）', () => {
    const patch = buildConfigEditPatch(settingsOf(), settingsOf({ cpuCores: 2 }), {
      skinDirectoryFor
    })
    expect(Object.keys(patch.sets)).not.toContain('disk.dataPartition.size')
  })
})

describe('applyConfigPatchToText', () => {
  it('set 全部重写（含重复行）、delete 整行移除、缺失 set 追加、注释保留', () => {
    const original =
      '# header\nhw.ramSize=2048\nhw.ramSize=4096\nskin.name=Pixel\nvm.heapSize=256\n'
    const next = applyConfigPatchToText(original, {
      sets: { 'hw.ramSize': '8192', 'hw.cpu.ncore': '6' },
      deletes: ['skin.name']
    })
    expect(next).toBe(
      '# header\nhw.ramSize=8192\nhw.ramSize=8192\nvm.heapSize=256\nhw.cpu.ncore=6\n'
    )
  })
})

describe('readHardwareSchemaDefaults', () => {
  it('解析条目名 + default 属性行；缺失文件返回空表', async () => {
    const raw = [
      '# comment',
      'name = hw.ramSize',
      'type = integer',
      'default = 2048',
      '',
      'name = vm.heapSize',
      'type = integer',
      'default = 256'
    ].join('\n')
    const defaults = await readHardwareSchemaDefaults('/sdk', {
      readFile: vi.fn(async () => raw)
    })
    expect(defaults).toEqual({ 'hw.ramSize': '2048', 'vm.heapSize': '256' })
    await expect(
      readHardwareSchemaDefaults('/sdk', {
        readFile: vi.fn(async () => {
          throw new Error('ENOENT')
        })
      })
    ).resolves.toEqual({})
  })
})
