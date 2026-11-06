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
    await runner.start(AVD_NAME, 'smoke-run-1')
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
    await resumeRunner.start(AVD_NAME, 'smoke-run-2')
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
