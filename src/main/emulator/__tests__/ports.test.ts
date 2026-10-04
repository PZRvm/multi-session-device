// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { EMULATOR_PORT_FIRST, PortAllocator, serialForPort } from '../ports'

const makeDeps = ({
  occupied = [] as number[],
  serials = [] as string[]
}: { occupied?: number[]; serials?: string[] } = {}): {
  probeTcp: (port: number) => Promise<boolean>
  adbSerials: () => Promise<Set<string>>
} => ({
  probeTcp: vi.fn(async (port: number) => occupied.includes(port)),
  adbSerials: vi.fn(async () => new Set(serials))
})

describe('PortAllocator', () => {
  it('首台分配 5554，serial 规则 emulator-<偶数端口>', async () => {
    const deps = makeDeps()
    const allocator = new PortAllocator(deps)
    const port = await allocator.acquire('d1')
    expect(port).toBe(EMULATOR_PORT_FIRST)
    expect(serialForPort(port)).toBe('emulator-5554')
  })

  it('进程内 reservation：并发两台不拿同一对端口', async () => {
    const allocator = new PortAllocator(makeDeps())
    const first = await allocator.acquire('d1')
    const second = await allocator.acquire('d2')
    expect(second).toBe(first + 2)
  })

  it('跳过外部 TCP 占用：偶数 console 口被占直接换对', async () => {
    const deps = makeDeps({ occupied: [EMULATOR_PORT_FIRST] })
    const allocator = new PortAllocator(deps)
    const port = await allocator.acquire('d1')
    expect(port).toBe(EMULATOR_PORT_FIRST + 2)
    expect(deps.probeTcp).toHaveBeenCalledWith(EMULATOR_PORT_FIRST)
  })

  it('跳过外部 TCP 占用：奇数 adb 口被占也换对', async () => {
    const deps = makeDeps({ occupied: [EMULATOR_PORT_FIRST + 1] })
    const allocator = new PortAllocator(deps)
    const port = await allocator.acquire('d1')
    expect(port).toBe(EMULATOR_PORT_FIRST + 2)
    expect(deps.probeTcp).toHaveBeenCalledWith(EMULATOR_PORT_FIRST + 1)
  })

  it('跳过 adb server 已登记的 serial（console 已关的窗口）', async () => {
    const allocator = new PortAllocator(makeDeps({ serials: ['emulator-5554'] }))
    const port = await allocator.acquire('d1')
    expect(port).toBe(EMULATOR_PORT_FIRST + 2)
  })

  it('release(deviceId) 只释放该设备的预留', async () => {
    const allocator = new PortAllocator(makeDeps())
    await allocator.acquire('d1')
    await allocator.acquire('d2')
    allocator.release('d1')
    expect(await allocator.acquire('d3')).toBe(EMULATOR_PORT_FIRST)
  })

  it('释放被抢端口后重新分配：外部仍占用则跳过（runner 换端口路径）', async () => {
    const occupied = new Set<number>()
    const allocator = new PortAllocator({
      probeTcp: async (port) => occupied.has(port),
      adbSerials: async () => new Set()
    })
    const first = await allocator.acquire('d1')
    occupied.add(first) // 外部抢注
    allocator.releasePort(first)
    const again = await allocator.acquire('d1')
    expect(again).toBe(first + 2)
  })

  it('64 对耗尽抛可操作错误', async () => {
    const allocator = new PortAllocator(makeDeps())
    // 走满 64 对
    const ids = Array.from({ length: 64 }, (_, index) => `d${index}`)
    for (const id of ids) await allocator.acquire(id)
    await expect(allocator.acquire('overflow')).rejects.toThrow('没有可用的模拟器端口')
  })
})
