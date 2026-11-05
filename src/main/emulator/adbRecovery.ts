import { AsyncLocalStorage } from 'node:async_hooks'
import { getLocaleState } from '../locale/store'
import { WIRELESS_RECOVERY_COPY } from '@shared/wirelessRecovery'

/** Only explicit wireless repair owns this gate; ordinary ensure never restarts the server. */
export class AdbRecoveryGate {
  private reserved = false
  private locked = false
  private commands = 0
  private activities = new Map<string, number>()
  get blockers(): string[] {
    return [...this.activities.keys()]
  }
  async activity<T>(name: string, work: () => Promise<T>): Promise<T> {
    this.assertOpen()
    this.activities.set(name, (this.activities.get(name) ?? 0) + 1)
    try {
      return await work()
    } finally {
      const count = this.activities.get(name)! - 1
      if (count) this.activities.set(name, count)
      else this.activities.delete(name)
    }
  }
  private readonly owner = new AsyncLocalStorage<boolean>()
  get active(): boolean {
    return this.locked
  }
  get pending(): number {
    return this.commands
  }
  assertOpen(): void {
    if (this.locked && !this.owner.getStore())
      throw new Error(WIRELESS_RECOVERY_COPY[getLocaleState()].busy)
  }
  command(): () => void {
    this.assertOpen()
    this.commands++
    let finished = false
    return () => {
      if (!finished) {
        finished = true
        this.commands--
      }
    }
  }
  reserve(): () => void {
    if (this.reserved) throw new Error(WIRELESS_RECOVERY_COPY[getLocaleState()].busy)
    this.reserved = true
    return () => {
      this.locked = false
      this.reserved = false
    }
  }
  unlock(): void {
    this.locked = false
  }
  lock(): void {
    this.locked = true
  }
  asOwner<T>(work: () => Promise<T>): Promise<T> {
    return this.owner.run(true, work)
  }
}
export const adbRecovery = new AdbRecoveryGate()
