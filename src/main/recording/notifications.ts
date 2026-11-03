import type { RecordingCommand, RecordingSnapshot, RecordingTask } from '@shared/recording'

type ResultAction = 'reveal' | 'retry' | 'later' | 'close'
interface NotificationDeps {
  canShow: () => boolean
  present: (task: RecordingTask) => Promise<ResultAction | undefined>
  command: (id: string, command: RecordingCommand) => Promise<unknown>
  failed: (error: unknown) => Promise<void>
}
const signature = (task: RecordingTask): string =>
  JSON.stringify([task.taskId, task.state, task.fileName, task.error])

/** 原生结果一次一项；主窗关闭时保留队列，不把已封存媒体归属给 renderer。 */
export class RecordingNotifications {
  private tasks = new Map<string, RecordingTask>()
  private pending = new Set<string>()
  private seen = new Map<string, string>()
  private running = false
  private paused = false
  private disposed = false
  private timer?: ReturnType<typeof setTimeout>
  constructor(private readonly deps: NotificationDeps) {}
  update(snapshot: RecordingSnapshot): void {
    this.tasks = new Map(snapshot.tasks.map((task) => [task.taskId, task]))
    for (const id of this.seen.keys()) if (!this.tasks.has(id)) this.seen.delete(id)
    for (const task of snapshot.tasks) {
      if (!['saved', 'error'].includes(task.state)) {
        this.seen.delete(task.taskId)
        this.pending.delete(task.taskId)
      } else if (this.seen.get(task.taskId) !== signature(task)) this.pending.add(task.taskId)
    }
    this.wake()
  }
  pause(value: boolean): void {
    this.paused = value
    if (!value) this.wake()
  }
  private wake(delay = 100): void {
    if (this.disposed || this.paused || this.running || this.timer || !this.pending.size) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.drain()
    }, delay)
    this.timer.unref()
  }
  private async drain(): Promise<void> {
    if (this.disposed || this.paused || this.running) return
    this.running = true
    try {
      while (this.pending.size && !this.paused && !this.disposed) {
        if (!this.deps.canShow()) break
        const id = this.pending.values().next().value!
        this.pending.delete(id)
        const task = this.tasks.get(id)
        if (!task || !['saved', 'error'].includes(task.state)) continue
        const version = signature(task)
        this.seen.set(id, version)
        try {
          const action = await this.deps.present(task)
          if (this.disposed) return
          if (!action || this.paused) {
            this.seen.delete(id)
            if (this.tasks.has(id)) this.pending.add(id)
            break
          }
          if (!this.tasks.has(id) || signature(this.tasks.get(id)!) !== version) continue
          if (action === 'retry') await this.deps.command(id, 'retry')
          if (action === 'reveal') await this.deps.command(id, 'reveal')
          if (task.state === 'saved' && ['reveal', 'close'].includes(action))
            await this.deps.command(id, 'dismiss')
        } catch (error) {
          if (!this.disposed && !this.deps.canShow()) {
            this.seen.delete(id)
            if (this.tasks.has(id)) this.pending.add(id)
            break
          }
          if (!this.disposed) await this.deps.failed(error).catch(() => undefined)
        }
      }
    } finally {
      this.running = false
      this.wake(this.deps.canShow() ? 100 : 1000)
    }
  }
  dispose(): void {
    this.disposed = true
    clearTimeout(this.timer)
    this.pending.clear()
  }
}
