import { connect as tcpConnect } from 'node:net'

/** 官方约定：偶数 console 端口 5554 起、每实例占一对（+1 是 adb 侧），共 64 对 */
export const EMULATOR_PORT_FIRST = 5554
export const EMULATOR_PORT_PAIRS = 64

export const serialForPort = (port: number): string => `emulator-${port}`

export interface PortDeps {
  /** TCP 可连 = 端口被占（外部 emulator console / adbd 在听） */
  probeTcp: (port: number) => Promise<boolean>
  /** 共享 adb server 已登记 serial 集——覆盖 console 已关但 adb 侧仍登记的窗口 */
  adbSerials: () => Promise<Set<string>>
}

export const tcpProbe = (port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const socket = tcpConnect({ host: '127.0.0.1', port })
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => resolve(false))
  })

/**
 * 进程内端口预留 + 本机真实占用双重检查：
 * reservation 防自家并发抢同一对；TCP/serial 探测防外部实例。
 * 进程组退出前不释放 reservation。
 */
export class PortAllocator {
  readonly #reserved = new Map<number, string>()

  constructor(private readonly deps: PortDeps) {}

  async acquire(deviceId: string): Promise<number> {
    const serials = await this.deps.adbSerials()
    for (let index = 0; index < EMULATOR_PORT_PAIRS; index += 1) {
      const port = EMULATOR_PORT_FIRST + index * 2
      // 先同步占坑再探测：并发 acquire 不会拿到同一对（探测在外部抢占时会退让换对）
      if (this.#reserved.has(port)) continue
      this.#reserved.set(port, deviceId)
      if (serials.has(serialForPort(port))) {
        this.#reserved.delete(port)
        continue
      }
      if (await this.deps.probeTcp(port)) {
        this.#reserved.delete(port)
        continue
      }
      if (await this.deps.probeTcp(port + 1)) {
        this.#reserved.delete(port)
        continue
      }
      return port
    }
    throw new Error(
      `没有可用的模拟器端口（${EMULATOR_PORT_FIRST}-${EMULATOR_PORT_FIRST + EMULATOR_PORT_PAIRS * 2 - 1} 已占满）`
    )
  }

  release(deviceId: string): void {
    for (const [port, owner] of this.#reserved) {
      if (owner === deviceId) this.#reserved.delete(port)
    }
  }

  releasePort(port: number): void {
    this.#reserved.delete(port)
  }

  reservedOf(deviceId: string): number | undefined {
    for (const [port, owner] of this.#reserved) {
      if (owner === deviceId) return port
    }
    return undefined
  }
}
