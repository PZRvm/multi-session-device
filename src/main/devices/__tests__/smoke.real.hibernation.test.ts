// @vitest-environment node
/**
 * 休眠域真机冒烟（plan 2026-11-06-emulator-hibernation G7）：MSD_SMOKE_HIB=1 才跑。
 * 与 PoC 的差别：走本仓库真实模块——emuConsoleExec（真 TCP+token）、
 * waitHibernationSnapshotStable（真 fs 稳定探测）、runner.quit（真进程优雅退出）、
 * afterBoot 式 boot_id 复核（真 adb）。隔离一次性 AVD（独立 ANDROID_AVD_HOME），
 * 不触碰用户实例与应用数据目录。
 */
import { spawn } from 'node:child_process'
import { mkdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { describe, expect, it, vi } from 'vitest'
import { EmulatorRunner, defaultBootProbe } from '../../emulator/runner'
import { PortAllocator, tcpProbe } from '../../emulator/ports'
import { listAdbSerials, runAdb, scrubAdbEnv } from '../../emulator/adb'
import { emuConsoleExec } from '../../emulator/emuConsole'
import {
  newHibernationSnapshotName,
  waitHibernationSnapshotStable
} from '../../emulator/hibernation'

const SmokeGate = process.env['MSD_SMOKE_HIB'] === '1'

const ROOT = process.env['MSD_SMOKE_HIB_ROOT'] ?? '/tmp/msd-hib-smoke'
const SDK = join(homedir(), 'Library', 'Android', 'sdk')
const ADB = join(SDK, 'platform-tools', 'adb')
const EMULATOR = join(SDK, 'emulator', 'emulator')
const IMAGE = 'system-images;android-36.1;google_apis_playstore;arm64-v8a'
const AVD_NAME = 'msd_hib_smoke'

const env = (): NodeJS.ProcessEnv =>
  scrubAdbEnv({
    ...process.env,
    ANDROID_SDK_ROOT: SDK,
    ANDROID_HOME: SDK,
    ANDROID_AVD_HOME: join(ROOT, 'avds'),
    ANDROID_USER_HOME: join(ROOT, 'user'),
    ANDROID_EMULATOR_HOME: join(ROOT, 'user'),
    JAVA_HOME: '/Applications/Android Studio.app/Contents/jbr/Contents/Home'
  })

const run = (cmd: string, args: string[]): Promise<{ code: number; text: string }> =>
  new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], env: env() })
    const out: Buffer[] = []
    child.stdout?.on('data', (c) => out.push(c))
    child.stderr?.on('data', (c) => out.push(c))
    child.on('close', (code) => resolve({ code: code ?? -1, text: Buffer.concat(out).toString() }))
  })

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

const until = async (
  fn: () => Promise<boolean>,
  label: string,
  timeoutMs: number
): Promise<void> => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await fn()) return
    await sleep(1_000)
  }
  throw new Error(`timeout: ${label}`)
}

const bootId = async (serial: string): Promise<string> =>
  (await runAdb(ADB, ['-s', serial, 'shell', 'cat /proc/sys/kernel/random/boot_id'])).stdout.trim()

;(SmokeGate ? describe : describe.skip)('休眠域真机冒烟（隔离一次性 AVD）', () => {
  vi.setConfig({ testTimeout: 600_000, hookTimeout: 120_000 })

  it('保存 → 优雅退出 → 快照恢复（boot_id 复核）→ 清理', async () => {
    // 上一轮失败可能遗留模拟器进程（会在删目录后回写文件）——先杀再清场
    await run('/usr/bin/pkill', ['-f', AVD_NAME]).catch(() => undefined)
    await sleep(1_500)
    await rm(ROOT, { recursive: true, force: true })
    await mkdir(join(ROOT, 'avds'), { recursive: true })
    await mkdir(join(ROOT, 'user'), { recursive: true })
    await run(ADB, ['start-server'])

    // 一次性 AVD：avdmanager 创建 + 2C/2G 裁剪
    const created = await run(join(SDK, 'cmdline-tools', 'latest', 'bin', 'avdmanager'), [
      'create',
      'avd',
      '-n',
      AVD_NAME,
      '-k',
      IMAGE,
      '-d',
      'pixel_7'
    ])
    expect(created.code, created.text.slice(-300)).toBe(0)
    const { readFile, writeFile } = await import('node:fs/promises')
    const configPath = join(ROOT, 'avds', `${AVD_NAME}.avd`, 'config.ini')
    const config = await readFile(configPath, 'utf8')
    await writeFile(
      configPath,
      config
        .replace(/^hw.cpu.ncore=.*$/m, 'hw.cpu.ncore=2')
        .replace(/^hw.ramSize=.*$/m, 'hw.ramSize=2048')
    )

    const ports = new PortAllocator({ probeTcp: tcpProbe, adbSerials: () => listAdbSerials(ADB) })
    const events = { running: vi.fn(), unexpectedExit: vi.fn() }
    const runner = new EmulatorRunner({
      sdkRoot: () => SDK,
      avdHome: () => join(ROOT, 'avds'),
      emulatorPath: () => EMULATOR,
      adbPath: () => ADB,
      ports,
      ensureAdbServer: async () => {
        const result = await runAdb(ADB, ['start-server'], { timeoutMs: 30_000 })
        if (result.code !== 0) throw new Error('adb start-server 失败')
      },
      bootProbe: defaultBootProbe(() => ADB),
      adbSerials: () => listAdbSerials(ADB),
      spawnEmulator: (path, args, options) => spawn(path, args, { ...options, env: env() }),
      platform: process.platform,
      sleep: (ms, signal) =>
        new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, ms)
          signal?.addEventListener(
            'abort',
            () => {
              clearTimeout(timer)
              reject(new Error('aborted'))
            },
            { once: true }
          )
        }),
      now: () => Date.now(),
      confirmedPortConflict: async (port) => (await tcpProbe(port)) || (await tcpProbe(port + 1)),
      onRunning: events.running,
      onUnexpectedExit: events.unexpectedExit
    })

    // 冷启动（-no-snapshot：禁自动加载，验证手动保存仍可用——PoC 协议）。
    // 端口由 PortAllocator 分配（不写死）：serial 与 console 端口都从 runner 取
    await runner.start(AVD_NAME, '11111111-1111-4111-8111-111111111111')
    await until(async () => runner.portOf(AVD_NAME) !== undefined, 'port allocated', 30_000)
    const port = runner.portOf(AVD_NAME)!
    const serial = `emulator-${port}`
    await until(
      async () =>
        (
          await runAdb(ADB, ['-s', serial, 'shell', 'getprop', 'sys.boot_completed'])
        ).stdout.trim() === '1',
      'cold boot',
      240_000
    )
    const coldBootId = await bootId(serial)
    // runner 侧 boot 探测（1.5s 节奏）可能落后于 adb 单查——等 phase 进入 running
    try {
      await until(async () => runner.phaseOf(AVD_NAME) === 'running', 'runner running', 60_000)
    } catch (error) {
      console.error(
        '[hib-smoke] phaseOf=',
        runner.phaseOf(AVD_NAME),
        'running calls=',
        events.running.mock.calls.length,
        'unexpectedExit=',
        JSON.stringify(events.unexpectedExit.mock.calls[0]?.[2] ?? null)?.slice(0, 300)
      )
      throw error
    }

    // ---- 休眠保存：真 console 客户端 + 真稳定探测 ----
    const snapshotName = newHibernationSnapshotName()
    const saveBegin = Date.now()
    const response = await emuConsoleExec(port, `avd snapshot save ${snapshotName}`, 120_000)
    expect(response).not.toMatch(/KO/i)
    const kib = await waitHibernationSnapshotStable(
      join(ROOT, 'avds', `${AVD_NAME}.avd`, 'snapshots', snapshotName),
      { firstByteBudgetMs: 90_000, stableBudgetMs: 180_000, intervalMs: 1_000 }
    )
    expect(kib).toBeGreaterThan(100_000)

    // ---- 优雅退出：console kill + 端口复核 ----
    const quitBegin = Date.now()
    await runner.quit(AVD_NAME)
    expect(runner.phaseOf(AVD_NAME)).toBeNull()
    await until(async () => !(await tcpProbe(port)), 'console port released', 15_000)
    const quitSeconds = (Date.now() - quitBegin) / 1000

    // ---- 恢复：-snapshot + -no-snapshot-save + boot_id 复核 ----
    const resumePlan = { snapshotName, expectedBootId: coldBootId, runId: 'smoke-run-2' }
    const resumeRunner = new EmulatorRunner({
      sdkRoot: () => SDK,
      avdHome: () => join(ROOT, 'avds'),
      emulatorPath: () => EMULATOR,
      adbPath: () => ADB,
      ports,
      ensureAdbServer: async () => undefined,
      bootProbe: defaultBootProbe(() => ADB),
      adbSerials: () => listAdbSerials(ADB),
      spawnEmulator: (path, args, options) => spawn(path, args, { ...options, env: env() }),
      platform: process.platform,
      sleep: (ms, signal) =>
        new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, ms)
          signal?.addEventListener(
            'abort',
            () => {
              clearTimeout(timer)
              reject(new Error('aborted'))
            },
            { once: true }
          )
        }),
      now: () => Date.now(),
      confirmedPortConflict: async (port) => (await tcpProbe(port)) || (await tcpProbe(port + 1)),
      extraArgsFor: () => [
        '-gpu',
        'host',
        '-snapshot',
        resumePlan.snapshotName,
        '-no-snapshot-save'
      ],
      onRunning: events.running,
      onUnexpectedExit: events.unexpectedExit
    })
    const resumeBegin = Date.now()
    await resumeRunner.start(AVD_NAME, '22222222-2222-4222-8222-222222222222')
    await until(
      async () =>
        (
          await runAdb(ADB, ['-s', serial, 'shell', 'getprop', 'sys.boot_completed'])
        ).stdout.trim() === '1',
      'resume boot_completed',
      120_000
    )
    const resumedBootId = await bootId(serial)
    expect(resumedBootId).toBe(coldBootId) // 快照加载成功；静默冷启动在此拦截
    const resumeSeconds = (Date.now() - resumeBegin) / 1000

    // 截图/输入通道可用性（真 adb）
    const screencap = await runAdb(ADB, ['-s', serial, 'exec-out', 'screencap', '-p'], {
      timeoutMs: 30_000
    })
    expect(screencap.stdout.length).toBeGreaterThan(10_000)
    const input = await runAdb(ADB, ['-s', serial, 'shell', 'input', 'keyevent', 'KEYCODE_WAKEUP'])
    expect(input.code).toBe(0)

    // ---- 清理：退出 + 删一次性 AVD ----
    await until(
      async () => resumeRunner.phaseOf(AVD_NAME) === 'running',
      'resume runner running',
      60_000
    )
    await resumeRunner.quit(AVD_NAME)
    await rm(ROOT, { recursive: true, force: true })
    expect(existsSync(ROOT)).toBe(false)
    expect(events.unexpectedExit).not.toHaveBeenCalled()

    console.log(
      `[hib-smoke] save=${((Date.now() - saveBegin) / 1000).toFixed(1)}s(stable=${(kib / 1024).toFixed(0)}MiB) quit=${quitSeconds.toFixed(1)}s resume=${resumeSeconds.toFixed(1)}s boot_id=${coldBootId.slice(0, 8)}…`
    )
  })
})

;(SmokeGate ? describe : describe.skip)('devices 域休眠全链路（真 fs 清单 + 真清理）', () => {
  vi.setConfig({ testTimeout: 600_000, hookTimeout: 120_000 })

  it('创建→启动→休眠（快照在场）→恢复→再休眠（旧快照被清、新快照保留）→放弃（清场）', async () => {
    const { freshDomain, mainWindowEvent, mocks, validCreateInput } = await import('./harness')
    const ROOT2 = process.env['MSD_SMOKE_HIB_ROOT'] ?? '/tmp/msd-hib-smoke-domain'
    await run('/usr/bin/pkill', ['-f', 'msd_hib_smoke_d']).catch(() => undefined)
    await rm(ROOT2, { recursive: true, force: true })
    const USERDATA = join(ROOT2, 'userdata')
    await mkdir(join(USERDATA, 'avd-home'), { recursive: true })
    await mkdir(join(USERDATA, 'android-user'), { recursive: true })

    // —— 把 harness 的 IO mock 全部换成真实实现（mock 盲区正是本轮缺陷来源）——
    mocks.appGetPath.mockImplementation(() => USERDATA)
    const { writeFile: wf } = await import('node:fs/promises')
    await wf(
      join(USERDATA, 'sdk.json'),
      JSON.stringify({
        version: 1,
        source: 'shared-studio',
        customPath: null,
        sharedPath: SDK
      }),
      'utf8'
    )
    const realRunner = (await vi.importActual(
      '../../emulator/runner'
    )) as typeof import('../../emulator/runner')
    const realAdb = (await vi.importActual(
      '../../emulator/adb'
    )) as typeof import('../../emulator/adb')
    const realPorts = (await vi.importActual(
      '../../emulator/ports'
    )) as typeof import('../../emulator/ports')
    const realConsole = (await vi.importActual(
      '../../emulator/emuConsole'
    )) as typeof import('../../emulator/emuConsole')
    const realHib = (await vi.importActual(
      '../../emulator/hibernation'
    )) as typeof import('../../emulator/hibernation')
    const realAvd = (await vi.importActual(
      '../../emulator/avd'
    )) as typeof import('../../emulator/avd')
    const realDirs = (): { avdHome: string; sdkRoot: string } => ({
      avdHome: join(USERDATA, 'avd-home'),
      sdkRoot: SDK
    })
    mocks.createRunner.mockImplementation((deps: unknown) => realRunner.createRunner(deps as never))
    mocks.runAdb.mockImplementation(((path: string, args: string[], opts?: unknown) =>
      realAdb.runAdb(path, args, opts as never)) as never)
    mocks.listAdbSerials.mockImplementation((async (path: string) =>
      realAdb.listAdbSerials(path)) as never)
    mocks.ensureSharedServer.mockImplementation((async (
      executable: Parameters<typeof realAdb.ensureSharedServer>[0]
    ) => realAdb.ensureSharedServer(executable)) as never)
    mocks.resolveAdbExecutable.mockImplementation((async () => ({
      path: ADB,
      source: 'app-sdk' as const,
      protocolVersion: 41
    })) as never)
    mocks.tcpProbe.mockImplementation(((port: number) => realPorts.tcpProbe(port)) as never)
    mocks.emuConsoleExec.mockImplementation(((port: number, command: string, timeoutMs: number) =>
      realConsole.emuConsoleExec(port, command, timeoutMs)) as never)
    mocks.readHibernationManifest.mockImplementation((async (deviceId: string) =>
      realHib.readHibernationManifest(deviceId, realDirs())) as never)
    mocks.writeHibernationManifest.mockImplementation((async (
      deviceId: string,
      manifest: unknown
    ) => realHib.writeHibernationManifest(deviceId, manifest as never, realDirs())) as never)
    mocks.removeHibernationManifest.mockImplementation((async (deviceId: string) =>
      realHib.removeHibernationManifest(deviceId, realDirs())) as never)
    mocks.hibernationSnapshotExists.mockImplementation((async (deviceId: string, name: string) =>
      realHib.hibernationSnapshotExists(deviceId, name, realDirs())) as never)
    mocks.waitHibernationSnapshotStable.mockImplementation(((dir: string) =>
      realHib.waitHibernationSnapshotStable(dir, {
        firstByteBudgetMs: 90_000,
        stableBudgetMs: 180_000,
        intervalMs: 1_000
      })) as never)
    mocks.cleanupOldHibernationSnapshots.mockImplementation((async (
      deviceId: string,
      keep: string | null
    ) => realHib.cleanupOldHibernationSnapshots(deviceId, keep, realDirs())) as never)
    mocks.createAvd.mockImplementation((async (input: { avdName: string }) =>
      realAvd.createAvd(input as never, {
        avdHome: join(USERDATA, 'avd-home'),
        sdkRoot: SDK,
        javaHome: '/Applications/Android Studio.app/Contents/jbr/Contents/Home',
        userHome: join(USERDATA, 'android-user')
      })) as never)
    // 指纹参与项的 config 读也走真文件（默认 mock 返回 null 也一致，但真读更贴近产品）
    mocks.readAvdConfigRaw.mockImplementation((async (name: string) => {
      const { readFile: rf } = await import('node:fs/promises')
      return rf(join(USERDATA, 'avd-home', `${name}.avd`, 'config.ini'), 'utf8').catch(() => null)
    }) as never)

    mocks.getMainWindow.mockReturnValue({ webContents: { id: 7, send: () => undefined } })
    const { handlerFor, runnerEvents } = await freshDomain({ useFakeRunner: false })
    // SDK 来源态是模块内存态（freshDomain 的 resetModules 会重置）——在域就绪后
    // 用同一实例恢复：sdk.json 指向 Studio SDK（emulator 二进制真实所在）
    const sdkSource = (await vi.importActual(
      '../../emulator/sdkSource'
    )) as typeof import('../../emulator/sdkSource')
    await sdkSource.restoreSdkSource()
    // 创建事务的镜像登记：36.1 playstore 标记 verified（真实在场由真实
    // avdmanager create -k 兜底——镜像缺失会直接失败）
    mocks.scanLocalImages.mockImplementation(
      (async () =>
        new Map([
          [
            'system-images;android-36.1;google_apis_playstore;arm64-v8a',
            {
              packageName: 'system-images;android-36.1;google_apis_playstore;arm64-v8a',
              displayName: null,
              apiLevelText: '36.1',
              extensionLevel: null,
              tagIds: ['google_apis_playstore'],
              abi: 'arm64-v8a',
              revision: null,
              verified: true
            }
          ]
        ])) as never
    )
    const IPC = (await import('@shared/ipc-channels')).IPC_CHANNELS
    const statusOf = async (id: string): Promise<string> => {
      const snapshot = (await handlerFor(IPC.devicesList)(mainWindowEvent(), undefined)) as {
        devices: Array<{ id: string; status: string }>
      }
      return snapshot.devices.find((device) => device.id === id)!.status
    }
    const manifestOnDisk = async (
      id: string
    ): Promise<{ stage: string; snapshotName: string } | null> => {
      const { readFile: rf } = await import('node:fs/promises')
      return rf(join(USERDATA, 'avd-home', `${id}.avd`, 'msd-hibernation.json'), 'utf8')
        .then((text) => JSON.parse(text))
        .catch(() => null)
    }
    const serialBootId = async (serial: string): Promise<string> => bootId(serial)

    // 创建（真实 avdmanager 建 AVD）→ 启动 → running
    const created = (await handlerFor(IPC.devicesCreate)(mainWindowEvent(), {
      ...validCreateInput,
      imagePackageName: 'system-images;android-36.1;google_apis_playstore;arm64-v8a'
    })) as { createdId: string }
    const id = created.createdId
    await handlerFor(IPC.devicesStart)(mainWindowEvent(), { id })
    try {
      await until(async () => (await statusOf(id)) === 'running', 'start → running', 240_000)
    } catch (error) {
      const snapshot = (await handlerFor(IPC.devicesList)(mainWindowEvent(), undefined)) as {
        devices: Array<{
          id: string
          status: string
          serial?: string
          lastError?: { code: string; message: string }
        }>
      }
      const row = snapshot.devices.find((device) => device.id === id)!
      console.error(
        '[domain-smoke] start failed:',
        JSON.stringify({
          status: row.status,
          serial: row.serial,
          lastError: row.lastError?.message?.slice(0, 500)
        })
      )
      throw error
    }
    const serialRow = (await handlerFor(IPC.devicesList)(mainWindowEvent(), undefined)) as {
      devices: Array<{ id: string; serial?: string }>
    }
    const serial = serialRow.devices.find((device) => device.id === id)!.serial!
    const port = Number(serial.replace('emulator-', ''))
    void runnerEvents
    const coldBootId = await serialBootId(serial)

    // —— 第一次休眠：真保存/真退出/真清理，回归断言：快照目录必须在场 ——
    await handlerFor(IPC.devicesHibernate)(mainWindowEvent(), { id })
    await until(async () => (await statusOf(id)) === 'hibernated', 'hibernate', 300_000)
    const manifest1 = await manifestOnDisk(id)
    expect(manifest1?.stage).toBe('hibernated')
    const snapshotDir1 = join(
      USERDATA,
      'avd-home',
      `${id}.avd`,
      'snapshots',
      manifest1!.snapshotName
    )
    expect(existsSync(snapshotDir1)).toBe(true) // 用户实测缺陷的回归点（自删快照）
    await until(async () => !(await tcpProbe(port)), 'port released after hibernate', 15_000)

    // —— 恢复：boot_id 一致 ——
    await handlerFor(IPC.devicesResume)(mainWindowEvent(), { id })
    await until(async () => (await statusOf(id)) === 'running', 'resume → running', 240_000)
    expect(await serialBootId(serial)).toBe(coldBootId)

    // —— 第二次休眠：旧快照被清（真 fs），新快照保留 ——
    await handlerFor(IPC.devicesHibernate)(mainWindowEvent(), { id })
    await until(async () => (await statusOf(id)) === 'hibernated', 'second hibernate', 300_000)
    const manifest2 = await manifestOnDisk(id)
    expect(manifest2?.snapshotName).not.toBe(manifest1!.snapshotName)
    // 旧快照清理是 fire-and-forget——有界等待其落地
    await until(
      async () => !existsSync(snapshotDir1),
      'old snapshot cleaned after second hibernate',
      30_000
    )
    expect(
      existsSync(join(USERDATA, 'avd-home', `${id}.avd`, 'snapshots', manifest2!.snapshotName))
    ).toBe(true)

    // —— 放弃：快照全清、清单删除、stopped ——
    await handlerFor(IPC.devicesDiscardHibernation)(mainWindowEvent(), { id })
    expect(await statusOf(id)).toBe('stopped')
    expect(await manifestOnDisk(id)).toBeNull()
    const snapshotsRoot = join(USERDATA, 'avd-home', `${id}.avd`, 'snapshots')
    const { readdir: rd } = await import('node:fs/promises')
    const left = await rd(snapshotsRoot).catch(() => [] as string[])
    expect(left.filter((entry) => entry.startsWith('msd-hib-'))).toEqual([])

    // 清场
    await run('/usr/bin/pkill', ['-f', `qemu-system.*${id}`]).catch(() => undefined)
    await rm(ROOT2, { recursive: true, force: true })
    expect(existsSync(ROOT2)).toBe(false)
  })
})
