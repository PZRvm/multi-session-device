// @vitest-environment node
import { connect as netConnect, createServer, type Server, type Socket } from 'node:net'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  candidateAdbPaths,
  encodeAdbRequest,
  ensureSharedServer,
  listAdbSerials,
  parseAdbVersionPayload,
  probeServer,
  resolveAdbExecutable,
  runAdb,
  scrubAdbEnv,
  type ProbeDeps
} from '../adb'

/** 起一个一次性 smart-socket 假 server，把 probeServer 的连接定向到它 */
const withFakeServer = async (
  reply: Buffer | null,
  handler: (deps: ProbeDeps, port: number) => Promise<void>
): Promise<void> => {
  const server: Server = createServer((socket) => {
    socket.once('data', () => {
      if (reply) socket.write(reply)
      // 不回也不关：由客户端超时收口
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0
  const deps: ProbeDeps = {
    connect: ((options: { port: number }, callback?: () => void) =>
      netConnect({ ...options, port }, callback)) as unknown as ProbeDeps['connect']
  }
  try {
    await handler(deps, port)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

const OKAY_41 = Buffer.concat([Buffer.from('OKAY'), Buffer.from('0004'), Buffer.from('0029')])
const OKAY_42 = Buffer.concat([Buffer.from('OKAY'), Buffer.from('0004'), Buffer.from('002a')])

afterEach(() => {
  vi.restoreAllMocks()
})

describe('adb 帧编解码', () => {
  it('请求 = 4 位十六进制长度 + 载荷', () => {
    expect(encodeAdbRequest('host:version').toString('utf8')).toBe('000chost:version')
  })

  it('版本载荷 hex 解析（41 → 0x29）', () => {
    expect(parseAdbVersionPayload('0029')).toBe(41)
    expect(parseAdbVersionPayload('')).toBeNull()
  })
})

describe('probeServer（只读探测）', () => {
  it('server 在跑：解析协议版本', async () => {
    await withFakeServer(OKAY_41, async (deps) => {
      expect(await probeServer(deps)).toEqual({ running: true, protocolVersion: 41 })
    })
  })

  it('server 应答 FAIL：按未运行处理', async () => {
    await withFakeServer(Buffer.from('FAIL0004oops'), async (deps) => {
      expect(await probeServer(deps)).toEqual({ running: false })
    })
  })

  it('端口无人听：running false，不抛错', async () => {
    const server: Server = createServer()
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    const deadPort = typeof address === 'object' && address !== null ? address.port : 0
    await new Promise<void>((resolve) => server.close(() => resolve()))
    const deps: ProbeDeps = {
      connect: ((options: { port: number }, callback?: () => void) =>
        netConnect({ ...options, port: deadPort }, callback)) as unknown as ProbeDeps['connect']
    }
    expect(await probeServer(deps)).toEqual({ running: false })
  })
})

describe('scrubAdbEnv', () => {
  it('筛掉远端 endpoint 变量，其余保留', () => {
    const scrubbed = scrubAdbEnv({
      PATH: '/usr/bin',
      ADB_SERVER_SOCKET: 'tcp:192.168.1.5:5037',
      ANDROID_ADB_SERVER_PORT: '5038',
      ANDROID_ADB_SERVER_ADDRESS: 'host:1'
    })
    expect(scrubbed['PATH']).toBe('/usr/bin')
    expect(scrubbed['ADB_SERVER_SOCKET']).toBeUndefined()
    expect(scrubbed['ANDROID_ADB_SERVER_PORT']).toBeUndefined()
    expect(scrubbed['ANDROID_ADB_SERVER_ADDRESS']).toBeUndefined()
  })
})

describe('resolveAdbExecutable', () => {
  it('全部候选失败：抛可操作错误', async () => {
    await expect(
      resolveAdbExecutable([{ path: '/nonexistent/adb', source: 'path' }])
    ).rejects.toThrow('找不到可用的 adb')
  })

  it('候选表：PATH 在前、标准 SDK 次之、应用自有兜底', () => {
    const originalPath = process.env['PATH']
    process.env['PATH'] = '/usr/bin:/usr/local/bin'
    try {
      const candidates = candidateAdbPaths('/app/sdk')
      expect(candidates[0]).toEqual({ path: '/usr/bin/adb', source: 'path' })
      expect(candidates.at(-1)).toEqual({ path: '/app/sdk/platform-tools/adb', source: 'app-sdk' })
      expect(candidates.some((entry) => entry.source === 'standard-sdk')).toBe(true)
    } finally {
      process.env['PATH'] = originalPath
    }
  })
})

describe('ensureSharedServer（不重启策略）', () => {
  const exec = { path: '/adb', source: 'app-sdk' as const, protocolVersion: 41 }

  it('server 在跑且协议相容 → 复用，绝不执行 start-server', async () => {
    const run = vi.fn()
    await withFakeServer(OKAY_41, async (deps) => {
      const descriptor = await ensureSharedServer(exec, { run: run as never, ...deps })
      expect(descriptor).toEqual({ reused: true, protocolVersion: 41 })
      expect(run).not.toHaveBeenCalled()
    })
  })

  it('server 在跑但协议不相容 → 拦截报错，不 kill 不 start', async () => {
    const run = vi.fn()
    await withFakeServer(OKAY_42, async (deps) => {
      await expect(ensureSharedServer(exec, { run: run as never, ...deps })).rejects.toThrow(
        '不会自动重启共享 server'
      )
      expect(run).not.toHaveBeenCalled()
    })
  })

  it('server 不在 → 用选定 adb start-server，随后复验通过', async () => {
    // 首次探测定向无人听的端口，start-server 后的复验改连真 server
    const server: Server = createServer((socket: Socket) => {
      socket.once('data', (chunk) => {
        if (chunk.toString('utf8').includes('host:version')) socket.write(OKAY_41)
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    const port = typeof address === 'object' && address !== null ? address.port : 0
    const deadServer: Server = createServer()
    await new Promise<void>((resolve) => deadServer.listen(0, '127.0.0.1', resolve))
    const deadAddress = deadServer.address()
    const deadPort = typeof deadAddress === 'object' && deadAddress !== null ? deadAddress.port : 0
    await new Promise<void>((resolve) => deadServer.close(() => resolve()))

    let calls = 0
    const deps: ProbeDeps = {
      connect: ((options: { port: number }, callback?: () => void) => {
        calls += 1
        // 第一次（探测）连无人听端口；start-server 后的复验连真 server
        return netConnect({ ...options, port: calls === 1 ? deadPort : port }, callback)
      }) as unknown as ProbeDeps['connect']
    }
    const run = vi.fn(async () => ({ code: 0, stdout: '', stderr: '' }))
    try {
      const descriptor = await ensureSharedServer(exec, { run: run as never, ...deps })
      expect(descriptor).toEqual({ reused: false, protocolVersion: 41 })
      expect(run).toHaveBeenCalledWith('/adb', ['start-server'], { timeoutMs: 30_000 })
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
})

describe('listAdbSerials', () => {
  it('解析 device 态行，忽略 offline/unauthorized 与表头', async () => {
    // 用真实可执行脚本走完整 runAdb 路径（ESM 内部绑定 spy 不可靠）
    const dir = await mkdtemp(join(tmpdir(), 'msd-adb-'))
    const script = join(dir, 'adb')
    await writeFile(
      script,
      '#!/bin/sh\nprintf "List of devices attached\\nemulator-5554\\tdevice\\nemulator-5556\\toffline\\n1A2B3C\\tdevice\\r\\n"\n',
      { mode: 0o755 }
    )
    const serials = await listAdbSerials(script)
    expect([...serials].sort()).toEqual(['1A2B3C', 'emulator-5554'])
    await rm(dirname(script), { recursive: true, force: true })
  })
})

describe('runAdb', () => {
  it('可执行文件不存在 → reject（不留悬挂 Promise）', async () => {
    await expect(runAdb('/nonexistent/adb', ['version'])).rejects.toThrow()
  })
})
