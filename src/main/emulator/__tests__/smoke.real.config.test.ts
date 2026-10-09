// @vitest-environment node
/** SDK 升级回归：只写临时 SDK / AVD，真实 SDK 的工具和镜像只读复用。 */
import { createHash, randomUUID } from 'node:crypto'
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createAvd, patchAvdConfig } from '../avd'
import { ensureSharedServer, listAdbSerials, resolveAdbExecutable, runAdb } from '../adb'
import { scanLocalImages } from '../catalog'
import {
  applyConfigPatchToText,
  nativeDisplayArgs,
  readAvdConfigRaw,
  writeAvdConfigRaw
} from '../deviceConfig'
import { enabledCutoutOverlays, resetDisplayCutout } from '../displayCutout'
import { buildPackageXml } from '../downloader'
import { PortAllocator, tcpProbe } from '../ports'
import { createRunner, type EmulatorRunner } from '../runner'

describe.skipIf(process.env['MSD_REAL_CONFIG'] !== '1')('隔离 SDK 配置回归', () => {
  it('官方创建接受生成 XML；皮肤选择/移除保持尺寸；用户挖孔保留，明确恢复才清除', async () => {
    const sourceSdk = process.env['MSD_CONFIG_SDK_ROOT']!
    const packageName = process.env['MSD_CONFIG_IMAGE']!
    const images = await scanLocalImages(sourceSdk)
    const image = images.get(packageName)
    if (!image?.verified) throw new Error(`测试镜像未完整安装：${packageName}`)
    const sourceImage = join(sourceSdk, ...packageName.split(';'))
    const originalXml = await readFile(join(sourceImage, 'package.xml'))
    const digest = (value: Buffer): string => createHash('sha256').update(value).digest('hex')
    const root = await mkdtemp(join(tmpdir(), 'msd-config-check-'))
    const sdkRoot = join(root, 'sdk')
    const avdHome = join(root, 'avd-home')
    const dirs = { sdkRoot, avdHome }
    const avdName = randomUUID()
    let runner: EmulatorRunner | undefined
    try {
      await mkdir(sdkRoot)
      await mkdir(avdHome)
      for (const tool of ['emulator', 'platform-tools', 'cmdline-tools', 'jre']) {
        await symlink(join(sourceSdk, tool), join(sdkRoot, tool), 'dir')
      }
      const isolatedImage = join(sdkRoot, ...packageName.split(';'))
      await mkdir(isolatedImage, { recursive: true })
      for (const entry of await readdir(sourceImage)) {
        if (entry !== 'package.xml')
          await symlink(join(sourceImage, entry), join(isolatedImage, entry))
      }
      await writeFile(
        join(isolatedImage, 'package.xml'),
        buildPackageXml({
          packageName,
          zipUrl: null,
          zipSha1: null,
          sizeBytes: null,
          displayName: image.displayName ?? packageName,
          apiLevelText: image.apiLevelText ?? packageName.split(';')[1].replace('android-', ''),
          extensionLevel: image.extensionLevel,
          tagIds: image.tagIds,
          abi: image.abi,
          revision: image.revision
        })
      )
      await createAvd({ avdName, profileId: 'pixel_8', packageName }, dirs)
      console.info('官方 avdmanager 接受生成的 package.xml')
      if (process.env['MSD_CONFIG_CREATE_ONLY'] === '1') return
      const skinPath = join(root, 'pixel_7')
      await mkdir(skinPath)
      await copyFile(
        join(import.meta.dirname, 'fixtures/skins/pixel_7-layout'),
        join(skinPath, 'layout')
      )
      await patchAvdConfig(avdName, dirs, {
        'hw.lcd.width': '240',
        'hw.lcd.height': '320',
        'hw.lcd.density': '120',
        'hw.ramSize': '2048',
        'hw.cpu.ncore': '2',
        'skin.name': 'pixel_7',
        'skin.path': skinPath
      })
      const adb = await resolveAdbExecutable([
        { path: join(sdkRoot, 'platform-tools/adb'), source: 'app-sdk' }
      ])
      let displayArgs: string[] = []
      let restore = false
      let ready!: (serial: string) => void
      let failed!: (error: Error) => void
      runner = createRunner({
        sdkRoot: () => sdkRoot,
        avdHome: () => avdHome,
        emulatorPath: () => join(sdkRoot, 'emulator/emulator'),
        adbPath: () => adb.path,
        ports: new PortAllocator({
          probeTcp: tcpProbe,
          adbSerials: () => listAdbSerials(adb.path)
        }),
        ensureAdbServer: async () => {
          await ensureSharedServer(adb)
        },
        beforeStart: async () => {
          displayArgs = nativeDisplayArgs(await readAvdConfigRaw(avdName, dirs))
        },
        extraArgsFor: () => ['-no-snapshot', '-gpu', 'host', ...displayArgs],
        afterBoot: async (_id, _runId, serial, signal) => {
          if (restore) await resetDisplayCutout({ adbPath: adb.path, avdName, serial, signal })
        },
        onRunning: (_id, _runId, serial) => ready(serial),
        onUnexpectedExit: (_id, _runId, info) => failed(new Error(info.stderrTail))
      })
      const start = async (): Promise<string> => {
        const running = new Promise<string>((resolve, reject) => {
          ready = resolve
          failed = reject
        })
        void running.catch(() => undefined)
        await runner!.start(avdName)
        return running
      }
      const command = async (serial: string, args: string[]): Promise<string> => {
        const result = await runAdb(adb.path, ['-s', serial, ...args])
        expect(result.code, result.stderr).toBe(0)
        return result.stdout.trim()
      }
      const checkGeometry = async (serial: string): Promise<void> => {
        expect(await command(serial, ['shell', 'wm', 'size'])).toBe('Physical size: 240x320')
        expect(await command(serial, ['shell', 'wm', 'density'])).toBe('Physical density: 120')
        expect(await command(serial, ['shell', 'getprop', 'sys.boot_completed'])).toBe('1')
      }
      const overlays = (serial: string): Promise<string> =>
        command(serial, ['shell', 'cmd', 'overlay', 'list', '--user', '0'])
      let serial = await start()
      await checkGeometry(serial)
      expect(enabledCutoutOverlays(await overlays(serial))).toEqual([])
      console.info('选择 Pixel 7 皮肤：240×320 / 120dpi，未引入挖孔')
      await runner.stop(avdName)
      const old = (await readAvdConfigRaw(avdName, dirs))!
      await writeAvdConfigRaw(
        avdName,
        dirs,
        applyConfigPatchToText(old, {
          sets: {},
          deletes: ['skin.name', 'skin.path', 'skin.dynamic']
        }),
        old
      )
      serial = await start()
      await checkGeometry(serial)
      expect(enabledCutoutOverlays(await overlays(serial))).toEqual([])
      console.info('移除皮肤再启动：尺寸、密度与挖孔均正常')
      const hole = 'com.android.internal.display.cutout.emulation.hole'
      await command(serial, ['shell', 'cmd', 'overlay', 'enable', '--user', '0', hole])
      await vi.waitFor(
        async () => {
          const raw = await overlays(serial)
          expect(enabledCutoutOverlays(raw), raw).toContain(hole)
        },
        { timeout: 5000 }
      )
      console.info('已在临时安卓中启用挖孔模拟')
      await runner.stop(avdName)
      serial = await start()
      const afterRestart = await overlays(serial)
      expect(enabledCutoutOverlays(afterRestart), afterRestart).toContain(hole)
      console.info('普通重启保留用户主动启用的挖孔模拟')
      await runner.stop(avdName)
      restore = true
      serial = await start()
      await checkGeometry(serial)
      expect(enabledCutoutOverlays(await overlays(serial))).toEqual([])
      console.info('明确恢复：等待安卓新一轮启动后清除挖孔')
    } finally {
      const leftovers = await runner?.disposeAll()
      // 清理失败保留现场，避免删掉仍被进程使用的目录。
      expect(leftovers ?? [], `测试进程未停止时保留 ${root}`).toEqual([])
      expect(digest(await readFile(join(sourceImage, 'package.xml')))).toBe(digest(originalXml))
      await rm(root, { recursive: true, force: true })
    }
  }, 600_000)
})
