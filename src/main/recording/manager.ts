import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { readdir, rm, lstat } from 'node:fs/promises'
import type { RecordingCommand, RecordingSnapshot, RecordingTask } from '@shared/recording'
import { isRecordingActive } from '@shared/recording'
import type { ScrcpyManager } from '../scrcpy'
import type { RecordingSource } from '../scrcpy/recording'
import { runAdb } from '../scrcpy/proc'
import { openAudioTransport, type AudioDeps, type AudioTransport } from './audioTransport'
import { RecordingCapture } from './capture'
import { SegmentStore, readManifest, saveManifest, type Manifest } from './segments'
import { generateMp4, type GenerateOptions } from './output'
import { assertSavedFile, publishRecording, recordingBaseName } from './publish'
import { MAX_CONCURRENT_RECORDINGS } from './limits'
import { cancelProcessor } from './processor'
import { recordingMsg as msg } from './copy'
import {
  audioPromptCondition,
  recordingPromptKey,
  type RecordingPromptContext
} from './preferences'

export interface RecordingDeps extends AudioDeps {
  scrcpy: Pick<
    ScrcpyManager,
    'getRecordingSource' | 'subscribeRecordingSource' | 'requestRecordingKeyFrame'
  >
  device: (id: string) => Promise<{ name: string; serial: string } | null>
  directory: string
  downloads: () => string
  changed: (snapshot: RecordingSnapshot) => void
  confirm: (
    kind: 'silent' | 'capture-size' | 'resize' | 'discard',
    values?: Record<string, string>,
    context?: RecordingPromptContext
  ) => Promise<boolean>
  reveal: (path: string) => void
  generate?: (options: GenerateOptions) => Promise<void>
  audio?: typeof openAudioTransport
  run?: typeof runAdb
}
interface Task {
  view: RecordingTask
  directory: string
  source?: RecordingSource
  physical?: string
  capture?: RecordingCapture
  store?: SegmentStore
  unsubscribe?: () => void
  audio?: AudioTransport
  abort: AbortController
  processAbort: AbortController
  preparing?: Promise<void>
  stopping?: Promise<void>
  commands: Promise<unknown>
  persist: Promise<void>
  manifest?: Manifest
  saved?: string
}
const terminal = (task: Task): boolean => !isRecordingActive(task.view.state)
const detailOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
export class RecordingManager {
  private tasks = new Map<string, Task>()
  private revision = 0
  private queue: string[] = []
  private generating = false
  private timer: ReturnType<typeof setInterval>
  private frozen = false
  private loading: Promise<void>
  constructor(private readonly deps: RecordingDeps) {
    this.loading = this.recover()
    this.timer = setInterval(() => {
      let changed = false
      for (const task of this.tasks.values()) {
        if (!isRecordingActive(task.view.state) || !task.capture) continue
        task.capture.checkAudio()
        task.view.durationMs = task.capture.durationMs()
        task.view.bytes = task.capture.store.bytes
        changed = true
        if (task.view.state === 'recording') this.persist(task, false)
      }
      if (changed) this.emit()
    }, 1000)
    this.timer.unref()
  }
  ready(): Promise<void> {
    return this.loading
  }
  snapshot(): RecordingSnapshot {
    return {
      revision: this.revision,
      limit: MAX_CONCURRENT_RECORDINGS,
      tasks: [...this.tasks.values()].map((task) => ({ ...task.view }))
    }
  }
  private emit(): void {
    this.revision++
    this.deps.changed(this.snapshot())
  }
  private require(id: string): Task {
    const task = this.tasks.get(id)
    if (!task) throw new Error(msg('missing'))
    return task
  }
  private live(task: Task): boolean {
    return (
      this.tasks.get(task.view.taskId) === task &&
      !task.abort.signal.aborted &&
      isRecordingActive(task.view.state) &&
      task.view.state !== 'stopping'
    )
  }
  start(deviceId: string): RecordingSnapshot {
    if (this.frozen) throw new Error(msg('invalidState'))
    const active = [...this.tasks.values()].filter((task) => isRecordingActive(task.view.state))
    if (active.some((task) => task.view.deviceId === deviceId)) throw new Error(msg('busy'))
    if (active.length >= MAX_CONCURRENT_RECORDINGS)
      throw new Error(msg('limit', { count: MAX_CONCURRENT_RECORDINGS }))
    const taskId = randomUUID()
    const task: Task = {
      view: {
        taskId,
        deviceId,
        deviceName: deviceId,
        state: 'starting',
        audio: 'preparing',
        durationMs: 0,
        bytes: 0,
        width: 0,
        height: 0,
        progress: 0
      },
      directory: join(this.deps.directory, taskId),
      abort: new AbortController(),
      processAbort: new AbortController(),
      commands: Promise.resolve(),
      persist: Promise.resolve()
    }
    this.tasks.set(taskId, task)
    this.emit()
    task.preparing = this.prepare(task).catch((error) => {
      if (this.live(task)) {
        task.view.error = detailOf(error)
        void this.stop(task).catch(() => undefined)
      }
    })
    return this.snapshot()
  }
  private async confirm(
    task: Task,
    kind: Parameters<RecordingDeps['confirm']>[0],
    values?: Record<string, string>,
    condition?: string
  ): Promise<boolean> {
    if (task.abort.signal.aborted) return false
    let listener!: () => void
    const cancelled = new Promise<boolean>((resolve) => {
      listener = () => resolve(false)
      task.abort.signal.addEventListener('abort', listener, { once: true })
    })
    try {
      const device =
        task.physical && task.physical !== 'unknown'
          ? `physical:${task.physical}`
          : task.source?.serial.startsWith('emulator-')
            ? `avd:${task.view.deviceId}`
            : `transport:${task.source?.serial ?? task.view.deviceId}`
      const context = condition
        ? {
            key: recordingPromptKey(device, kind, condition),
            valid: () => this.live(task)
          }
        : undefined
      return await Promise.race([this.deps.confirm(kind, values, context), cancelled])
    } finally {
      task.abort.signal.removeEventListener('abort', listener)
    }
  }
  private async prepare(task: Task): Promise<void> {
    await this.loading
    if (!this.live(task)) return
    const device = await this.deps.device(task.view.deviceId)
    const source = this.deps.scrcpy.getRecordingSource(task.view.deviceId)
    if (!device || !source || device.serial !== source.serial) throw new Error(msg('notReady'))
    if (!this.live(task)) return
    task.source = source
    task.view.deviceName = device.name
    const run = this.deps.run ?? runAdb
    const property = async (name: string): Promise<string> => {
      const result = await run(
        this.deps.adbPath(),
        ['-s', source.serial, 'shell', 'getprop', name],
        5000
      )
      return result.code === 0 ? result.stdout.trim() : ''
    }
    const [sdk, physical] = await Promise.all([
      property('ro.build.version.sdk'),
      source.serial.startsWith('emulator-') ? Promise.resolve('') : property('ro.serialno')
    ])
    if (!this.live(task)) return
    if (!source.serial.startsWith('emulator-')) {
      task.physical = physical || 'unknown'
      const other = [...this.tasks.values()].find(
        (entry) =>
          entry !== task &&
          !terminal(entry) &&
          entry.physical &&
          (entry.physical === task.physical ||
            task.physical === 'unknown' ||
            entry.physical === 'unknown')
      )
      if (other) throw new Error(msg(physical ? 'duplicate' : 'unknownIdentity'))
    }
    const screen = await run(
      this.deps.adbPath(),
      ['-s', source.serial, 'shell', 'wm', 'size'],
      5000
    )
    const matches = [...screen.stdout.matchAll(/(?:Physical|Override) size:\s*(\d+)x(\d+)/g)]
    const size = matches.at(-1)
    if (size && source.format.width > 0) {
      const original = [Number(size[1]), Number(size[2])].sort((a, b) => a - b)
      const captured = [source.format.width, source.format.height].sort((a, b) => a - b)
      if (
        (original[0] !== captured[0] || original[1] !== captured[1]) &&
        !(await this.confirm(
          task,
          'capture-size',
          {
            original: `${size[1]}×${size[2]}`,
            size: `${source.format.width}×${source.format.height}`
          },
          JSON.stringify([original, captured])
        ))
      ) {
        task.view.state = 'cancelled'
        this.emit()
        return
      }
    }
    if (!this.live(task)) return
    task.store = await SegmentStore.create(task.directory, (error) =>
      this.interrupt(task, `${msg('diskFailed')}: ${error.message}`)
    )
    if (!this.live(task)) return
    const capture = new RecordingCapture(
      task.store,
      task.view,
      source.configuration,
      () => {
        this.persist(task, false)
        this.emit()
      },
      (reason) => this.interrupt(task, reason)
    )
    task.capture = capture
    let audioError: unknown
    if (Number(sdk) >= 33) {
      try {
        task.audio = await (this.deps.audio ?? openAudioTransport)(
          this.deps,
          source.serial,
          task.abort.signal
        )
        if (!this.live(task)) return
        const reader = task.audio.stream.getReader()
        void (async () => {
          try {
            while (!task.abort.signal.aborted) {
              const next = await reader.read()
              if (next.done) {
                if (this.live(task)) capture.audioEnded()
                break
              }
              capture.audio(next.value)
            }
          } catch (error) {
            if (this.live(task)) capture.audioEnded(error as Error)
          } finally {
            reader.releaseLock()
          }
        })()
        let timeout!: ReturnType<typeof setTimeout>
        try {
          await Promise.race([
            capture.audioReady,
            new Promise<never>((_, reject) => {
              timeout = setTimeout(() => reject(new Error('AAC start timed out')), 15_000)
            })
          ])
        } finally {
          clearTimeout(timeout)
        }
        task.view.audio = 'available'
      } catch (error) {
        audioError = error
        await task.audio?.close()
        task.audio = undefined
      }
    } else audioError = new Error(`Android SDK ${sdk || '?'}`)
    if (!this.live(task)) return
    if (audioError) {
      task.view.state = 'awaiting-silent-choice'
      this.emit()
      if (
        !(await this.confirm(
          task,
          'silent',
          { reason: detailOf(audioError) },
          audioPromptCondition(sdk, detailOf(audioError))
        ))
      ) {
        if (this.live(task)) {
          task.view.state = 'cancelled'
          task.abort.abort()
          await capture.seal()
          await rm(task.directory, { recursive: true, force: true })
          this.emit()
        }
        return
      }
      if (!this.live(task)) return
      task.view.audio = 'silent'
    }
    task.view.state = 'starting'
    task.unsubscribe = this.deps.scrcpy.subscribeRecordingSource(source, {
      packet: (packet) => capture.video(packet),
      ended: () => this.interrupt(task, msg('sourceEnded'))
    })
    capture.arm()
    this.emit()
    this.persist(task, false)
    await this.requestKey(source)
  }
  private async requestKey(source: RecordingSource): Promise<void> {
    let timer!: ReturnType<typeof setTimeout>
    try {
      await Promise.race([
        this.deps.scrcpy.requestRecordingKeyFrame(source),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(msg('timeout'))), 15_000)
        })
      ])
    } finally {
      clearTimeout(timer)
    }
  }
  private persist(task: Task, sealed: boolean): Promise<void> {
    if (!task.capture) return task.persist
    // 快照后串行落盘；manifest 的 end 仅代表已接受数据，不把定时器推测当崩溃后的完整尾帧。
    const manifest: Manifest = {
      version: 1,
      task: { ...task.view },
      segments: task.capture.segments.map((entry) => ({ ...entry })),
      sealed
    }
    task.manifest = manifest
    task.persist = task.persist
      .then(() => saveManifest(task.directory, manifest))
      .catch((error) => {
        if (this.live(task)) this.interrupt(task, `${msg('diskFailed')}: ${detailOf(error)}`)
        else if (sealed) throw error
      })
    void task.persist.catch(() => undefined)
    return task.persist
  }
  private interrupt(task: Task, reason: string): void {
    if (!this.live(task)) return
    task.view.interruption = reason
    void this.stop(task).catch((error) => {
      task.view.error = detailOf(error)
      task.view.state = 'error'
      this.emit()
    })
  }
  async command(taskId: string, command: RecordingCommand): Promise<RecordingSnapshot> {
    const task = this.require(taskId)
    const execute = async (): Promise<RecordingSnapshot> => {
      switch (command) {
        case 'pause':
          if (task.view.state !== 'recording') throw new Error(msg('invalidState'))
          task.view.state = 'pausing'
          task.capture!.pause()
          task.view.durationMs = task.capture!.durationMs()
          task.view.state = 'paused'
          await task.store!.flush()
          await this.persist(task, false)
          break
        case 'resume':
          if (task.view.state !== 'paused' || !task.source) throw new Error(msg('invalidState'))
          task.view.state = 'resuming'
          task.capture!.arm()
          this.emit()
          try {
            await this.requestKey(task.source)
          } catch {
            this.interrupt(task, msg('sourceEnded'))
          }
          break
        case 'stop':
          await this.stop(task)
          break
        case 'retry':
          if (task.view.state !== 'error' || !task.view.canRetry || !task.manifest?.segments.length)
            throw new Error(msg('invalidState'))
          task.view.error = undefined
          task.view.progress = 0
          task.processAbort = new AbortController()
          this.enqueue(task)
          break
        case 'reveal':
          if (task.view.state !== 'saved' || !task.saved) throw new Error(msg('invalidState'))
          try {
            await assertSavedFile(task.saved)
          } catch {
            throw new Error(msg('missingFile'))
          }
          this.deps.reveal(task.saved)
          break
        case 'dismiss':
          if (!['saved', 'cancelled', 'error'].includes(task.view.state))
            throw new Error(msg('invalidState'))
          if (task.view.state === 'error' && !(await this.deps.confirm('discard'))) break
          await task.persist.catch(() => undefined)
          await rm(task.directory, { recursive: true, force: true })
          this.tasks.delete(taskId)
          break
      }
      this.emit()
      return this.snapshot()
    }
    const result = task.commands.then(execute)
    task.commands = result.catch(() => undefined)
    return result
  }
  private stop(task: Task): Promise<void> {
    if (task.stopping) return task.stopping
    if (!isRecordingActive(task.view.state)) return Promise.resolve()
    task.view.state = 'stopping'
    task.abort.abort()
    task.unsubscribe?.()
    task.unsubscribe = undefined
    task.capture?.pause()
    this.emit()
    task.stopping = (async () => {
      await task.preparing
      await task.audio?.close()
      task.audio = undefined
      try {
        await task.capture?.seal()
        if (!task.capture) await task.store?.close()
        task.view.durationMs = task.capture?.durationMs() ?? 0
        task.view.bytes = task.store?.bytes ?? 0
        await this.persist(task, true)
        if (!task.capture?.segments.length) {
          task.view.state = task.view.error || task.view.interruption ? 'error' : 'cancelled'
          if (task.view.state === 'error')
            task.view.error ??= task.view.interruption ?? msg('noFrames')
          else await rm(task.directory, { recursive: true, force: true })
        } else {
          task.view.canRetry = true
          this.enqueue(task)
        }
      } catch (error) {
        task.view.state = 'error'
        task.view.error = detailOf(error)
      }
      this.emit()
    })()
    return task.stopping
  }
  private enqueue(task: Task): void {
    task.view.state = 'queued'
    this.queue.push(task.view.taskId)
    this.emit()
    void this.drain()
  }
  private async drain(): Promise<void> {
    if (this.generating) return
    this.generating = true
    try {
      while (this.queue.length) {
        const id = this.queue.shift()!
        const task = this.tasks.get(id)
        if (!task || task.view.state !== 'queued' || !task.manifest) continue
        const temporary = join(this.deps.downloads(), `.msd-recording-${id}.part`)
        task.view.state = 'processing'
        this.emit()
        try {
          await (this.deps.generate ?? generateMp4)({
            directory: task.directory,
            temporary,
            manifest: task.manifest,
            signal: task.processAbort.signal,
            progress: (value) => {
              const rounded = Math.floor(value * 100) / 100
              if (task.view.progress !== rounded) {
                task.view.progress = rounded
                this.emit()
              }
            },
            resized: async (width, height) => {
              const approved =
                width >= task.view.width && height >= task.view.height
                  ? true
                  : await this.deps.confirm('resize', {
                      original: `${task.view.width}×${task.view.height}`,
                      size: `${width}×${height}`
                    })
              if (approved) {
                task.view.width = width
                task.view.height = height
                this.emit()
              }
              return approved
            }
          })
          if (task.processAbort.signal.aborted) throw new Error('Generation cancelled')
          task.view.fileName = await publishRecording(
            temporary,
            this.deps.downloads(),
            recordingBaseName(task.view.deviceName)
          )
          task.saved = join(this.deps.downloads(), task.view.fileName)
          task.view.state = 'saved'
          task.view.progress = 1
          task.view.canRetry = false
          await rm(task.directory, { recursive: true, force: true }).catch((error) =>
            console.warn('[recording] temporary cleanup failed', error)
          )
        } catch (error) {
          await rm(temporary, { force: true }).catch(() => undefined)
          task.view.state = 'error'
          task.view.error = `${msg('failed')}: ${detailOf(error)}`
        }
        this.emit()
      }
    } finally {
      this.generating = false
    }
  }
  private async recover(): Promise<void> {
    let names: string[]
    try {
      names = await readdir(this.deps.directory)
    } catch {
      return
    }
    for (const id of names) {
      if (!UUID.test(id)) continue
      const directory = join(this.deps.directory, id)
      try {
        if (!(await lstat(directory)).isDirectory()) continue
        const manifest = await readManifest(directory)
        if (
          manifest.version !== 1 ||
          manifest.task?.taskId !== id ||
          !Array.isArray(manifest.segments)
        )
          continue
        if (!manifest.segments.length) {
          await rm(directory, { recursive: true, force: true })
          continue
        }
        // 崩溃材料按最后持久化的有效边界生成，明确标作中断，禁止恢复采集。
        const view: RecordingTask = {
          ...manifest.task,
          state: 'error',
          canRetry: true,
          error: msg('recovered'),
          interruption:
            manifest.task.interruption ?? (manifest.sealed ? undefined : msg('recovered'))
        }
        this.tasks.set(id, {
          view,
          directory,
          manifest,
          abort: new AbortController(),
          processAbort: new AbortController(),
          commands: Promise.resolve(),
          persist: Promise.resolve()
        })
      } catch {
        const view: RecordingTask = {
          taskId: id,
          deviceId: '',
          deviceName: msg('recovered'),
          state: 'error',
          audio: 'silent',
          durationMs: 0,
          bytes: 0,
          width: 0,
          height: 0,
          progress: 0,
          error: msg('noFrames'),
          canRetry: false
        }
        this.tasks.set(id, {
          view,
          directory,
          abort: new AbortController(),
          processAbort: new AbortController(),
          commands: Promise.resolve(),
          persist: Promise.resolve()
        })
      }
    }
    this.emit()
  }
  hasPending(): boolean {
    return [...this.tasks.values()].some(
      (task) =>
        isRecordingActive(task.view.state) || ['queued', 'processing'].includes(task.view.state)
    )
  }
  setFrozen(value: boolean): void {
    this.frozen = value
  }
  async saveForQuit(): Promise<boolean> {
    this.frozen = true
    await Promise.all([...this.tasks.values()].map((task) => this.stop(task)))
    while (this.generating || this.queue.length)
      await new Promise((resolve) => setTimeout(resolve, 100))
    return ![...this.tasks.values()].some((task) => task.view.state === 'error')
  }
  async discardForQuit(): Promise<void> {
    this.frozen = true
    for (const task of this.tasks.values()) {
      task.processAbort.abort()
    }
    cancelProcessor()
    this.queue = []
    await Promise.all([...this.tasks.values()].map((task) => this.stop(task)))
    this.queue = []
    while (this.generating) await new Promise((resolve) => setTimeout(resolve, 100))
    for (const task of this.tasks.values())
      if (task.view.state !== 'saved')
        await rm(task.directory, { recursive: true, force: true }).catch(() => undefined)
  }
  async stopDevice(deviceId: string): Promise<void> {
    await Promise.all(
      [...this.tasks.values()]
        .filter((task) => task.view.deviceId === deviceId && isRecordingActive(task.view.state))
        .map((task) => {
          task.view.interruption = msg('sourceEnded')
          return this.stop(task)
        })
    )
  }
  dispose(): void {
    clearInterval(this.timer)
  }
}
