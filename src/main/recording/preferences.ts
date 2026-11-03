import { createHash } from 'node:crypto'
import { readFile, rename, writeFile } from 'node:fs/promises'

export interface RecordingPromptContext {
  key: string
  valid: () => boolean
}
export const recordingPromptKey = (device: string, kind: string, condition: string): string =>
  createHash('sha256')
    .update(JSON.stringify([device, kind, condition]))
    .digest('hex')

/** 未知临时故障不永久记忆；不把易变的整段日志当作条件。 */
export const audioPromptCondition = (sdk: string, reason: string): string | undefined => {
  if (!sdk || !Number.isInteger(Number(sdk)) || Number(sdk) <= 0) return undefined
  if (Number(sdk) < 33) return `sdk:${sdk || 'unknown'}`
  const category = /permission|denied|SecurityException/i.test(reason)
    ? 'permission'
    : /timed out/i.test(reason)
      ? 'timeout'
      : /Only AAC|Unsupported AAC/i.test(reason)
        ? 'codec'
        : /Device audio disabled/i.test(reason)
          ? 'disabled'
          : /Device audio errored/i.test(reason)
            ? 'device-error'
            : undefined
  return category ? `sdk:${sdk}:${category}` : undefined
}

export class RecordingPreferences {
  private keys = new Set<string>()
  private generation = 0
  private loading: Promise<void>
  private writes: Promise<void> = Promise.resolve()
  constructor(readonly path: string) {
    this.loading = this.load()
  }
  get epoch(): number {
    return this.generation
  }
  ready(): Promise<void> {
    return this.loading
  }
  private async load(): Promise<void> {
    try {
      const raw = JSON.parse(await readFile(this.path, 'utf8')) as {
        version?: unknown
        keys?: unknown
      }
      if (raw.version !== 1 || !Array.isArray(raw.keys)) return
      this.keys = new Set(
        raw.keys
          .filter((key): key is string => typeof key === 'string' && /^[a-f0-9]{64}$/.test(key))
          .slice(-1000)
      )
    } catch {
      // 缺文件、损坏或不可读时重新询问；不触碰任务与原始材料。
    }
  }
  async has(key: string): Promise<boolean> {
    await this.loading
    return this.keys.has(key)
  }
  private persist(): Promise<void> {
    const payload = JSON.stringify({ version: 1, keys: [...this.keys] })
    const write = this.writes.then(async () => {
      await writeFile(`${this.path}.tmp`, `${payload}\n`, 'utf8')
      await rename(`${this.path}.tmp`, this.path)
    })
    this.writes = write.catch(() => undefined)
    return write
  }
  async remember(key: string, epoch: number): Promise<void> {
    await this.loading
    if (epoch !== this.generation) return
    this.keys.add(key)
    if (this.keys.size > 1000) this.keys.delete(this.keys.values().next().value!)
    await this.persist()
  }
  async reset(): Promise<void> {
    await this.loading
    this.generation++
    this.keys.clear()
    await this.persist()
  }
}
