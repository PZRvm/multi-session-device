// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { assertUninstallable } from '../uninstall'
import type { ImageEntry } from '@shared/types'

const image = (overrides: Partial<ImageEntry> = {}): ImageEntry => ({
  packageName: 'system-images;android-36;google_apis_playstore;arm64-v8a',
  displayName: 'Google Play ARM 64 v8a System Image 36',
  api: {
    platformSegment: 'android-36',
    major: 36,
    minor: null,
    codename: null,
    extensionLevel: null,
    baseExtension: null
  },
  services: ['google_play'],
  featureTags: [],
  abi: 'arm64-v8a',
  channel: 0,
  revision: null,
  sizeBytes: 1_900_000_000,
  installed: true,
  source: 'remote+local',
  ...overrides
})

const PKG = 'system-images;android-36;google_apis_playstore;arm64-v8a'

describe('assertUninstallable（守卫链，顺序与文案）', () => {
  it('已装、无包操作、无引用 → 放行', () => {
    expect(() =>
      assertUninstallable(PKG, { catalog: { images: [image()] }, activeOp: null, referencing: [] })
    ).not.toThrow()
  })

  it('不在可信目录 → 拒绝', () => {
    expect(() =>
      assertUninstallable('system-images;android-99;default;arm64-v8a', {
        catalog: { images: [image()] },
        activeOp: null,
        referencing: []
      })
    ).toThrow('不在可信镜像目录中')
  })

  it('未装/半安装 → 拒绝（先修复才有删除资格）', () => {
    expect(() =>
      assertUninstallable(PKG, {
        catalog: { images: [image({ installed: false })] },
        activeOp: null,
        referencing: []
      })
    ).toThrow('未完整安装')
  })

  it('下载进行中 → 拒绝并带在下载的包名', () => {
    expect(() =>
      assertUninstallable(PKG, {
        catalog: { images: [image()] },
        activeOp: {
          kind: 'download',
          packageName: 'system-images;android-37.2;google_apis_ps16k;arm64-v8a'
        },
        referencing: []
      })
    ).toThrow('android-37.2')
  })

  it('另一卸载进行中 → 拒绝（双向互斥，review P1）', () => {
    expect(() =>
      assertUninstallable(PKG, {
        catalog: { images: [image()] },
        activeOp: {
          kind: 'uninstall',
          packageName: 'system-images;android-35;google_apis;arm64-v8a'
        },
        referencing: []
      })
    ).toThrow('正在卸载镜像')
  })

  it('被设备引用 → 拒绝并列设备名', () => {
    expect(() =>
      assertUninstallable(PKG, {
        catalog: { images: [image()] },
        activeOp: null,
        referencing: ['测试机 A', '测试机 B']
      })
    ).toThrow('测试机 A、测试机 B')
  })
})

describe('uninstallSdkManagerPackage（注入接缝）', () => {
  it('参数与 env 走官方路径；失败带 exit 与错误输出', async () => {
    const { uninstallSdkManagerPackage } = await import('../sdk')
    const runner = vi.fn<(bin: string, args: string[], env: NodeJS.ProcessEnv) => Promise<void>>(
      async () => {}
    )
    await uninstallSdkManagerPackage('/sdk', PKG, { runner })
    const [bin, args, env] = runner.mock.calls[0]
    expect(bin).toContain('sdkmanager')
    expect(args).toEqual(['--sdk_root', '/sdk', '--uninstall', PKG])
    expect(env.ANDROID_SDK_ROOT).toBe('/sdk')

    const failing = vi.fn<(bin: string, args: string[], env: NodeJS.ProcessEnv) => Promise<void>>(
      async () => {
        throw new Error('sdkmanager --uninstall x 失败（exit 1）：Warning: something')
      }
    )
    await expect(uninstallSdkManagerPackage('/sdk', PKG, { runner: failing })).rejects.toThrow(
      'exit 1'
    )
  })

  it('注入 runner 挂死 → 有界超时拒绝（review 遗留：超时对注入同样生效）', async () => {
    const { uninstallSdkManagerPackage } = await import('../sdk')
    await expect(
      uninstallSdkManagerPackage('/sdk', PKG, {
        runner: () => new Promise(() => {}),
        timeoutMs: 40
      })
    ).rejects.toThrow('超时')
  })
})

describe('packageOps（统一互斥）', () => {
  it('空闲放行；占用中拒绝且带在操作的包名；end 后复位', async () => {
    const { activePackageOp, beginPackageOp, endPackageOp } = await import('../packageOps')
    expect(activePackageOp()).toBeNull()
    beginPackageOp({ kind: 'download', packageName: 'pkg-a' })
    expect(activePackageOp()).toEqual({ kind: 'download', packageName: 'pkg-a' })
    expect(() => beginPackageOp({ kind: 'uninstall', packageName: 'pkg-b' })).toThrow(
      '已有镜像在下载（pkg-a）'
    )
    endPackageOp()
    beginPackageOp({ kind: 'uninstall', packageName: 'pkg-b' })
    expect(() => beginPackageOp({ kind: 'download', packageName: 'pkg-c' })).toThrow(
      '正在卸载镜像（pkg-b）'
    )
    endPackageOp()
    expect(activePackageOp()).toBeNull()
  })
})
