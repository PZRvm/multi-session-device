// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RecordingObserver } from '../../scrcpy/recording'
import { RecordingManager, type RecordingDeps } from '../manager'
import { mediaRecords } from '../segments'
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: false } }))
vi.mock('electron', () => ({ app: {}, BrowserWindow: {}, ipcMain: {} }))
vi.mock('../source', async (original) => ({
  ...(await original<object>()),
  videoConfig: () => ({ codec: 'avc1.640034', width: 1080, height: 2400 })
}))
const roots: string[] = []
const managers: RecordingManager[] = []
afterEach(async () => {
  for (const manager of managers.splice(0)) {
    await manager.discardForQuit()
    manager.dispose()
  }
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
const setup = async (
  overrides: Partial<RecordingDeps> = {}
): Promise<{
  manager: RecordingManager
  observers: Map<string, RecordingObserver>
  deps: RecordingDeps
  root: string
}> => {
  const root = await mkdtemp(join(tmpdir(), 'msd-recording-'))
  roots.push(root)
  const observers = new Map<string, RecordingObserver>()
  const deps: RecordingDeps = {
    adbPath: () => '/adb',
    toolEnv: () => ({}),
    directory: join(root, 'tasks'),
    downloads: () => root,
    device: async (id) => ({ serial: `emulator-${id}`, name: `Device ${id}` }),
    changed: vi.fn(),
    reveal: vi.fn(),
    confirm: vi.fn(async () => true),
    run: vi.fn(async () => ({ code: 0, stdout: '31', stderr: '' })),
    generate: vi.fn(async ({ temporary }) => {
      const bytes = Buffer.alloc(128)
      bytes.write('ftyp', 4)
      await writeFile(temporary, bytes)
    }),
    scrcpy: {
      getRecordingSource: (id) => ({
        deviceId: id,
        runId: 'r1',
        streamId: 's1',
        serial: `emulator-${id}`,
        format: { codec: 'h264', width: 1080, height: 2400 },
        configuration: Uint8Array.of(1)
      }),
      subscribeRecordingSource: (identity, observer) => {
        observers.set(identity.deviceId, observer)
        return () => {
          observers.delete(identity.deviceId)
        }
      },
      requestRecordingKeyFrame: vi.fn(async (identity) => {
        observers.get(identity.deviceId)?.packet(
          {
            type: 'data',
            pts: BigInt(Date.now()) * 1000n,
            keyframe: true,
            data: Uint8Array.of(2)
          },
          { codec: 'h264', width: 1080, height: 2400 }
        )
      })
    },
    ...overrides
  }
  const manager = new RecordingManager(deps)
  managers.push(manager)
  await manager.ready()
  return { manager, observers, deps, root }
}
const readyTask = async (manager: RecordingManager, id: string): Promise<string> => {
  const snapshot = manager.start(id)
  const taskId = snapshot.tasks.at(-1)!.taskId
  await vi.waitFor(() =>
    expect(manager.snapshot().tasks.find((task) => task.taskId === taskId)?.state).toBe('recording')
  )
  return taskId
}
describe('main recording task ownership and lifecycle', () => {
  it('reserves before async preparation, caps admission, and keeps separate device subscriptions', async () => {
    const { manager, observers } = await setup()
    const a = await readyTask(manager, 'a')
    expect(() => manager.start('a')).toThrow()
    const b = await readyTask(manager, 'b')
    expect(() => manager.start('c')).toThrow()
    expect([...observers.keys()]).toEqual(['a', 'b'])
    await manager.command(a, 'pause')
    expect(manager.snapshot().tasks.find((task) => task.taskId === b)?.state).toBe('recording')
    expect(() => manager.start('c')).toThrow()
  })
  it('removes paused time, ignores late callbacks, and publishes one task per file', async () => {
    const { manager, observers, root } = await setup()
    const id = await readyTask(manager, 'a')
    const observer = observers.get('a')!
    await manager.command(id, 'pause')
    const paused = manager.snapshot().tasks[0].durationMs
    observer.packet(
      {
        type: 'data',
        pts: BigInt(Date.now()) * 1000n + 5_000_000n,
        keyframe: false,
        data: Uint8Array.of(3)
      },
      { codec: 'h264', width: 2400, height: 1080 }
    )
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(manager.snapshot().tasks[0].durationMs).toBe(paused)
    await manager.command(id, 'resume')
    await manager.command(id, 'stop')
    await vi.waitFor(() => expect(manager.snapshot().tasks[0].state).toBe('saved'))
    const saved = manager.snapshot().tasks[0]
    expect(await readFile(join(root, saved.fileName!))).toHaveLength(128)
    expect(saved.durationMs).toBeLessThan(100)
    await manager.command(id, 'stop')
    observer.ended('late')
    expect(manager.snapshot().tasks[0].state).toBe('saved')
    await manager.command(id, 'reveal')
  })
  it('asks for silent recording; cancelling never creates a successful output', async () => {
    const { manager, deps } = await setup({ confirm: vi.fn(async () => false) })
    manager.start('a')
    await vi.waitFor(() => expect(manager.snapshot().tasks[0].state).toBe('cancelled'))
    expect(deps.confirm).toHaveBeenCalledWith(
      'silent',
      expect.anything(),
      expect.objectContaining({ key: expect.any(String), valid: expect.any(Function) })
    )
    expect(deps.generate).not.toHaveBeenCalled()
  })
  it('seals on disconnect, retains interruption notice and permits a new stream task', async () => {
    const { manager, observers } = await setup()
    const id = await readyTask(manager, 'a')
    observers.get('a')!.ended('source ended')
    await vi.waitFor(() => expect(manager.snapshot().tasks[0].state).toBe('saved'))
    expect(manager.snapshot().tasks[0].interruption).toBeTruthy()
    const next = await readyTask(manager, 'a')
    expect(next).not.toBe(id)
  })
  it('keeps sealed material for retry after a generation failure and rejects arbitrary commands', async () => {
    const { manager, deps } = await setup({
      generate: vi.fn(async () => {
        throw new Error('disk full')
      })
    })
    const id = await readyTask(manager, 'a')
    await expect(manager.command(id, 'resume')).rejects.toThrow()
    await manager.command(id, 'stop')
    await vi.waitFor(() => expect(manager.snapshot().tasks[0].state).toBe('error'))
    const manifest = JSON.parse(await readFile(join(deps.directory, id, 'manifest.json'), 'utf8'))
    expect(manifest.sealed).toBe(true)
    expect(manifest.segments).toHaveLength(1)
    const packets: import('../segments').MediaRecord[] = []
    for await (const record of mediaRecords(join(deps.directory, id, 'video.bin')))
      packets.push(record)
    expect(packets).toHaveLength(2)
    manager.dispose()
    const recovered = new RecordingManager(deps)
    managers.push(recovered)
    await recovered.ready()
    expect(recovered.snapshot().tasks[0]).toMatchObject({
      taskId: id,
      state: 'error',
      canRetry: true
    })
    // 已封存的正常停止材料只是生成失败，重启不能把它改写成采集中断。
    expect(recovered.snapshot().tasks[0].interruption).toBeUndefined()
    expect(deps.generate).toHaveBeenCalledTimes(1)
    deps.generate = async ({ temporary }) => {
      const bytes = Buffer.alloc(128)
      bytes.write('ftyp', 4)
      await writeFile(temporary, bytes)
    }
    await recovered.command(id, 'retry')
    await vi.waitFor(() => expect(recovered.snapshot().tasks[0].state).toBe('saved'))
    expect(recovered.snapshot().tasks[0].interruption).toBeUndefined()
    await expect(recovered.command('../outside', 'dismiss')).rejects.toThrow()
  })
  it('cancels preparation before an asynchronous device lookup completes', async () => {
    let resolve!: RecordingDeps['device'] extends (...args: never[]) => Promise<infer R>
      ? (value: R) => void
      : never
    const { manager, deps } = await setup({
      device: () =>
        new Promise((accept) => {
          resolve = accept
        })
    })
    const id = manager.start('a').tasks[0].taskId
    await new Promise((accept) => setTimeout(accept, 0))
    const stopped = manager.command(id, 'stop')
    resolve({ name: 'old', serial: 'emulator-a' })
    await stopped
    expect(manager.snapshot().tasks[0].state).toBe('cancelled')
    expect(deps.generate).not.toHaveBeenCalled()
  })
})

describe('recording physical identity and cancelled setup', () => {
  it('rejects USB and wireless aliases of the same physical device', async () => {
    const { manager, deps } = await setup({
      device: async (id) => ({ name: id, serial: id }),
      run: vi.fn(async (_path, args) => ({
        code: 0,
        stdout: args.includes('ro.serialno')
          ? 'one-physical-device'
          : args.includes('ro.build.version.sdk')
            ? '31'
            : '',
        stderr: ''
      }))
    })
    const observers = new Map<string, RecordingObserver>()
    deps.scrcpy.getRecordingSource = (id) => ({
      deviceId: id,
      serial: id,
      runId: 'run',
      streamId: id,
      format: { codec: 'h264', width: 1080, height: 2400 },
      configuration: Uint8Array.of(1)
    })
    deps.scrcpy.subscribeRecordingSource = (source, observer) => {
      observers.set(source.deviceId, observer)
      return () => {
        observers.delete(source.deviceId)
      }
    }
    deps.scrcpy.requestRecordingKeyFrame = async (source) => {
      observers
        .get(source.deviceId)
        ?.packet(
          { type: 'data', pts: 1_000_000n, keyframe: true, data: Uint8Array.of(2) },
          { codec: 'h264', width: 1080, height: 2400 }
        )
    }
    await readyTask(manager, 'USB')
    manager.start('192.168.1.10:5555')
    await vi.waitFor(() => expect(manager.snapshot().tasks[1].state).toBe('error'))
    expect(manager.snapshot().tasks[1].error).toContain('同一台设备')
    expect(manager.snapshot().tasks[0].state).toBe('recording')
  })
  it('stops a pending silent-choice dialog without waiting for its response', async () => {
    const { manager, deps } = await setup({ confirm: () => new Promise(() => undefined) })
    const id = manager.start('a').tasks[0].taskId
    await vi.waitFor(() => expect(manager.snapshot().tasks[0].state).toBe('awaiting-silent-choice'))
    await manager.command(id, 'stop')
    expect(manager.snapshot().tasks[0].state).toBe('cancelled')
    expect(deps.generate).not.toHaveBeenCalled()
  })
})
