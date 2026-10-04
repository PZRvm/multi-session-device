// @vitest-environment node
/**
 * 投屏 main 链路真机并测（stage04 步骤 5 验收）：MSD_SMOKE_STREAM=1 时才跑。
 * 真启动两台 AVD → 双会话建流 → 激活 A/B 切换与回放突发 → 交互码率采样 →
 * 输入注入（按键/文本/旋转）→ 清理后 forward 零残留。
 * renderer 解码与触摸延迟走应用 CDP 冒烟（本文件只验 main 链路）。
 */
import { spawn as realSpawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import type { ScreenPacketMessage, ScreenStateMessage } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EmulatorRunner, defaultBootProbe } from '../../emulator/runner'
import { PortAllocator, tcpProbe } from '../../emulator/ports'
import { listAdbSerials, runAdb as runAdbRaw } from '../../emulator/adb'

const SmokeGate = process.env['MSD_SMOKE_STREAM'] === '1'

const appRoot = (): string =>
  join(homedir(), 'Library', 'Application Support', 'multi-session-device')
const sdkRoot = (): string => join(appRoot(), 'AndroidSDK')
const avdHome = (): string => join(appRoot(), 'avd-home')
const adbPath = (): string => join(sdkRoot(), 'platform-tools', 'adb')

const AVD_A = 'b0056668-35dc-4ad4-a5ee-c44c035f4c97'
const AVD_B = '1c3745a3-e16a-4708-89c9-c83219cc6018'

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const runAdb = (args: string[], timeoutMs = 10_000) => runAdbRaw(adbPath(), args, { timeoutMs })

const mocks = vi.hoisted(() => ({
  handle: vi.fn(),
  windowRef: {
    current: null as {
      isDestroyed: () => boolean
      webContents: { send: (channel: string, payload: unknown) => void }
    } | null
  }
}))

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => process.cwd() },
  ipcMain: { handle: mocks.handle },
  BrowserWindow: {}
}))

;(SmokeGate ? describe : describe.skip)('投屏 main 链路真机并测', () => {
  vi.setConfig({ testTimeout: 480_000 })

  const runner = new EmulatorRunner({
    sdkRoot,
    avdHome,
    emulatorPath: () => join(sdkRoot(), 'emulator', 'emulator'),
    adbPath,
    ports: new PortAllocator({ probeTcp: tcpProbe, adbSerials: () => listAdbSerials(adbPath()) }),
    ensureAdbServer: async () => {
      const result = await runAdb(['start-server'], 30_000)
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
    onRunning: () => undefined,
    onUnexpectedExit: () => undefined
  })

  const boot = async (id: string): Promise<{ serial: string; runId: string }> => {
    const started = await runner.start(id)
    const deadline = Date.now() + 300_000
    while (runner.phaseOf(id) !== 'running' && Date.now() < deadline) await sleep(2_000)
    if (runner.phaseOf(id) !== 'running') throw new Error(`boot 超时：${id}`)
    return { serial: started.serial, runId: started.runId }
  }

  const importSut = async () => {
    const { createScrcpyManager } = await import('../index')
    const manager = createScrcpyManager({
      adbPath,
      toolEnv: () => ({
        ...process.env,
        ANDROID_SDK_ROOT: sdkRoot(),
        ANDROID_AVD_HOME: avdHome()
      }),
      getMainWindow: () => mocks.windowRef.current as never,
      isMainSender: () => true
    })
    manager.registerIpc()
    return manager
  }

  const handlerFor = async (
    channel: string
  ): Promise<(event: unknown, raw: unknown) => Promise<unknown>> => {
    const call = mocks.handle.mock.calls.find(([name]) => name === channel)
    if (!call) throw new Error(`handler 未注册：${channel}`)
    return call[1] as (event: unknown, raw: unknown) => Promise<unknown>
  }

  const sendCalls = (): Array<[string, unknown]> =>
    (
      mocks.windowRef.current!.webContents.send as unknown as {
        mock: { calls: Array<[string, unknown]> }
      }
    ).mock.calls

  const states = (): ScreenStateMessage[] =>
    sendCalls()
      .filter(([channel]) => channel === IPC_CHANNELS.screenState)
      .map(([, payload]) => payload as ScreenStateMessage)

  const packets = (): ScreenPacketMessage[] =>
    sendCalls()
      .filter(([channel]) => channel === IPC_CHANNELS.screenPacket)
      .map(([, payload]) => payload as ScreenPacketMessage)

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.windowRef.current = {
      isDestroyed: () => false,
      webContents: { send: vi.fn() as never }
    }
  })

  it('双会话建流 → 激活切换 → 交互码率 → 输入注入 → 清理零残留', async () => {
    const manager = await importSut()
    try {
      const [a, b] = await Promise.all([boot(AVD_A), boot(AVD_B)])

      await manager.ensureSession({ id: AVD_A, runId: a.runId, serial: a.serial })
      await manager.ensureSession({ id: AVD_B, runId: b.runId, serial: b.serial })
      const readyDeadline = Date.now() + 60_000
      while (
        states().filter((state) => state.status === 'ready').length < 2 &&
        Date.now() < readyDeadline
      ) {
        await sleep(500)
      }
      const readyStates = states().filter((state) => state.status === 'ready')
      expect(readyStates.length).toBeGreaterThanOrEqual(2)
      for (const state of readyStates) {
        expect(state.format?.width).toBeGreaterThan(0)
        expect(state.format?.height).toBeGreaterThan(0)
      }

      const activate = (await handlerFor(IPC_CHANNELS.screenActivate)) as (
        event: unknown,
        raw: unknown
      ) => Promise<unknown>
      const input = (await handlerFor(IPC_CHANNELS.screenInput)) as (
        event: unknown,
        raw: unknown
      ) => Promise<unknown>
      const ack = (await handlerFor(IPC_CHANNELS.screenAck)) as (
        event: unknown,
        raw: unknown
      ) => Promise<unknown>

      // 激活 A → 突发回放（首包是配置）
      await activate({}, { id: AVD_A, viewToken: 'vt-a' })
      await sleep(1_000)
      const burstA = packets().filter((packet) => packet.viewToken === 'vt-a')
      console.log(
        '[debug] vt-a 前 5 包:',
        burstA
          .slice(0, 5)
          .map(
            (packet) =>
              `${packet.type}#${packet.seq}g${packet.generation}${packet.keyframe ? 'K' : ''}`
          )
          .join(' '),
        '| 总数',
        burstA.length,
        '| 状态:',
        states()
          .map(
            (state) =>
              `${state.deviceId.slice(0, 4)}:${state.status}:g${state.generation}:vt${state.viewToken.slice(0, 5)}`
          )
          .join(' | ')
      )
      expect(burstA.length).toBeGreaterThan(1)
      expect(burstA[0].type).toBe('configuration')
      // 持续 ACK（贴近真实 renderer 每 8 包一回执）：让背压预算不触发重同步阻塞
      const ackTimer = setInterval(() => {
        const last = packets().at(-1)
        if (last) {
          void ack(
            {},
            { viewToken: last.viewToken, generation: last.generation, throughSeq: last.seq }
          )
        }
      }, 100)

      // 交互码率采样（10s，交互由 adb input swipe 驱动）：编码器出包速率 ≥30 包/s 为过线近似
      const idleMark = packets().length
      const idleStart = Date.now()
      await sleep(5_000)
      const idleFps = ((packets().length - idleMark) / (Date.now() - idleStart)) * 1_000

      const interactMark = packets().length
      const interactStart = Date.now()
      let swipes = 0
      while (Date.now() - interactStart < 10_000) {
        const up = swipes % 2 === 0
        await runAdb([
          '-s',
          a.serial,
          'shell',
          'input',
          'swipe',
          '500',
          up ? '1800' : '600',
          '500',
          up ? '600' : '1800',
          '250'
        ])
        swipes += 1
      }
      clearInterval(ackTimer)
      const interactFps = ((packets().length - interactMark) / (Date.now() - interactStart)) * 1_000
      console.log(
        `[smoke-stream] 静置 ${idleFps.toFixed(1)} 包/s · 交互 ${interactFps.toFixed(1)} 包/s（${swipes} 次滑动）`
      )
      expect(interactFps).toBeGreaterThanOrEqual(30)

      // 切换 B：突发以配置包开头，token 更换
      const switchStart = Date.now()
      await activate({}, { id: AVD_B, viewToken: 'vt-b' })
      const switchDeadline = Date.now() + 5_000
      while (Date.now() < switchDeadline) {
        const burstB = packets().filter((packet) => packet.viewToken === 'vt-b')
        if (burstB.length > 2) break
        await sleep(50)
      }
      const burstB = packets().filter((packet) => packet.viewToken === 'vt-b')
      expect(burstB[0].type).toBe('configuration')
      expect(burstB.length).toBeGreaterThan(2)
      const switchMs = Date.now() - switchStart
      console.log(`[smoke-stream] 切换 B 回放突发 ${burstB.length} 包（${switchMs}ms 内）`)

      // 切回 A：再次突发
      await activate({}, { id: AVD_A, viewToken: 'vt-a2' })
      const backDeadline = Date.now() + 5_000
      while (Date.now() < backDeadline) {
        const back = packets().filter((packet) => packet.viewToken === 'vt-a2')
        if (back.length > 2) break
        await sleep(50)
      }
      const back = packets().filter((packet) => packet.viewToken === 'vt-a2')
      expect(back[0].type).toBe('configuration')

      // 输入注入（经完整守卫与控制链）：back 键 + 英文文本 + IME 中文（剪贴板粘贴）
      // 与 renderer 一致：归属信封取自最新包（generation 随重配置前进）
      const latestA = packets()
        .filter((packet) => packet.viewToken === 'vt-a2')
        .at(-1)!
      const aFormat = states()
        .filter((state) => state.deviceId === AVD_A && state.status === 'ready')
        .at(-1)!.format!
      const inputRequest = (inputValue: object): object => ({
        deviceId: AVD_A,
        runId: a.runId,
        streamId: latestA.streamId,
        generation: latestA.generation,
        viewToken: 'vt-a2',
        width: aFormat.width,
        height: aFormat.height,
        input: inputValue
      })
      await input({}, inputRequest({ kind: 'button', button: 'back' }))
      await input({}, inputRequest({ kind: 'text', text: 'hello', ime: false }))
      await input({}, inputRequest({ kind: 'text', text: '你好，世界', ime: true }))

      // 清理：forward 只清本会话，最终零残留
      const forwardBefore = await runAdb(['forward', '--list'])
      expect(forwardBefore.stdout).toContain(a.serial)
      await manager.destroyAll()
      await runner.disposeAll()
      const forwardAfter = await runAdb(['forward', '--list'])
      expect(forwardAfter.stdout).not.toContain(a.serial)
      expect(forwardAfter.stdout).not.toContain(b.serial)
    } finally {
      await manager.destroyAll()
      await runner.disposeAll()
    }
  }, 480_000)
})
