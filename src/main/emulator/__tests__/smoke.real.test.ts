// @vitest-environment node
/**
 * 真机冒烟（stage04 步骤 4 验收）：MSD_SMOKE=1 时才跑，常规套件跳过。
 * 依赖本机应用自有 SDK（userData/AndroidSDK）与 avd-home 里的既有 AVD；
 * 宿主若有外部实例占用 5554，正好覆盖端口避让路径。
 */
import { spawn as realSpawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { EmulatorRunner, defaultBootProbe } from '../runner'
import { PortAllocator, tcpProbe } from '../ports'
import { listAdbSerials, runAdb, scrubAdbEnv } from '../adb'

const SmokeGate = process.env['MSD_SMOKE'] === '1'

const appRoot = (): string =>
  join(homedir(), 'Library', 'Application Support', 'multi-session-device')
const sdkRoot = (): string => join(appRoot(), 'AndroidSDK')
const avdHome = (): string => join(appRoot(), 'avd-home')
const adbPath = (): string => join(sdkRoot(), 'platform-tools', 'adb')

// 测试用 AVD（stage03/04 建的两台）
const AVD_A = 'b0056668-35dc-4ad4-a5ee-c44c035f4c97'
const AVD_B = '1c3745a3-e16a-4708-89c9-c83219cc6018'

const qemuAlive = (avdName: string): Promise<boolean> =>
  new Promise((resolve) => {
    const probe = realSpawn('pgrep', ['-f', `qemu-system.*${avdName}`])
    probe.on('close', (code) => resolve(code === 0))
  })

const tokenDigest = (): string =>
  createHash('sha256')
    .update(readFileSync(join(homedir(), '.emulator_console_auth_token')))
    .digest('hex')

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

;(SmokeGate ? describe : describe.skip)('runner 真机冒烟', () => {
  vi.setConfig({ testTimeout: 480_000 })

  const ports = new PortAllocator({
    probeTcp: tcpProbe,
    adbSerials: () => listAdbSerials(adbPath())
  })
  const events = { running: vi.fn(), unexpectedExit: vi.fn() }
  const runner = new EmulatorRunner({
    sdkRoot,
    avdHome,
    emulatorPath: () => join(sdkRoot(), 'emulator', 'emulator'),
    adbPath,
    ports,
    ensureAdbServer: async () => {
      const result = await runAdb(adbPath(), ['start-server'], { timeoutMs: 30_000 })
      if (result.code !== 0) throw new Error(`adb start-server 失败：${result.stderr}`)
    },
    bootProbe: defaultBootProbe(adbPath),
    adbSerials: () => listAdbSerials(adbPath()),
    spawnEmulator: (path: string, args: string[], options: SpawnOptions): ChildProcess =>
      realSpawn(path, args, options),
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

  const waitRunning = async (id: string): Promise<void> => {
    const deadline = Date.now() + 300_000
    while (runner.phaseOf(id) !== 'running' && Date.now() < deadline) {
      await sleep(2_000)
    }
    expect(runner.phaseOf(id)).toBe('running')
  }

  it('AVD_A 启动到 running（外部 5554 占用时避让）+ 停止 + 复启停', async () => {
    const tokenBefore = tokenDigest()
    const started = await runner.start(AVD_A)
    expect(started.serial).not.toBe('emulator-5554') // 外部实例占着 5554
    await waitRunning(AVD_A)
    expect(events.running).toHaveBeenCalledWith(AVD_A, started.runId, started.serial)
    // boot 后真身可查：getprop 走共享 server
    const check = await runAdb(adbPath(), [
      '-s',
      started.serial,
      'shell',
      'getprop',
      'sys.boot_completed'
    ])
    expect(check.stdout.trim()).toBe('1')

    // 停止：进程组终止、无残留
    await runner.stop(AVD_A)
    expect(runner.phaseOf(AVD_A)).toBeNull()
    await sleep(2_000)
    expect(await qemuAlive(AVD_A)).toBe(false)

    // 宿主 token 零改写
    expect(tokenDigest()).toBe(tokenBefore)

    // 复启停一轮（参数固定 -no-snapshot，冷启动语义）
    await runner.start(AVD_A)
    await waitRunning(AVD_A)
    await runner.stop(AVD_A)
    await sleep(2_000)
    expect(await qemuAlive(AVD_A)).toBe(false)
    expect(events.unexpectedExit).not.toHaveBeenCalled()
  })

  it('AVD_B 启动中取消：进程组整组终止，无残留 qemu', async () => {
    await runner.start(AVD_B)
    // boot 早期即取消
    await sleep(3_000)
    await runner.cancelStart(AVD_B)
    expect(runner.phaseOf(AVD_B)).toBeNull()
    await sleep(2_000)
    expect(await qemuAlive(AVD_B)).toBe(false)
  })

  it('主动终止 qemu → 非预期退出回写（崩溃路径）', async () => {
    const started = await runner.start(AVD_A)
    await waitRunning(AVD_A)
    // 找到该 serial 对应的 qemu 真身，SIGKILL 模拟崩溃
    const killed = new Promise<boolean>((resolve) => {
      const ps = realSpawn('sh', [
        '-c',
        `pgrep -f "qemu-system.*${AVD_A}" | head -1 | xargs kill -9`
      ])
      ps.on('close', (code) => resolve(code === 0))
    })
    expect(await killed).toBe(true)
    const deadline = Date.now() + 15_000
    while (events.unexpectedExit.mock.calls.length === 0 && Date.now() < deadline) {
      await sleep(500)
    }
    expect(events.unexpectedExit).toHaveBeenCalledTimes(1)
    const call = events.unexpectedExit.mock.calls[0]
    expect(call[0]).toBe(AVD_A)
    expect(call[1]).toBe(started.runId)
    expect(runner.phaseOf(AVD_A)).toBeNull()
  })

  it('退出清理 disposeAll：拒绝新启动', async () => {
    const leftovers = await runner.disposeAll()
    expect(leftovers).toEqual([])
    await expect(runner.start(AVD_A)).rejects.toThrow('暂停启动')
    const env = scrubAdbEnv({ ...process.env, ADB_SERVER_SOCKET: 'tcp:1.2.3.4:5037' })
    expect(env['ADB_SERVER_SOCKET']).toBeUndefined()
  })
})
