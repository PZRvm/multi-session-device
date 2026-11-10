// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { emuConsoleExec, type ConsoleSocket } from '../emuConsole'

/** 伪 console socket：脚本化回放数据块，记录写出 */
const fakeSocket = (script: string[]): { socket: ConsoleSocket; writes: string[] } => {
  const writes: string[] = []
  const listeners = {
    data: [] as Array<(chunk: string) => void>,
    close: [] as Array<() => void>,
    error: [] as Array<(e: Error) => void>
  }
  const socket: ConsoleSocket = {
    write: (data) => {
      writes.push(data)
      // 写入 auth 后自动播放下一段（贴近真实往返）
      queueMicrotask(() => {
        const next = script.shift()
        if (next !== undefined) for (const l of listeners.data) l(next)
      })
    },
    destroy: () => undefined,
    onData: (listener) => {
      listeners.data.push(listener)
      // 连接建立即推 greeting
      queueMicrotask(() => {
        const first = script.shift()
        if (first !== undefined) for (const l of listeners.data) l(first)
      })
    },
    onClose: (listener) => {
      listeners.close.push(listener)
    },
    onError: (listener) => {
      listeners.error.push(listener)
    }
  }
  return { socket, writes }
}

const GREETING =
  'Android Console: Authentication required\r\n' +
  "Android Console: type 'auth <auth_token>' to authenticate\r\n" +
  'Android Console: you can find your <auth_token> in \r\n' +
  "'/Users/test/.emulator_console_auth_token'\r\nOK\r\n"
const AUTH_OK = "Android Console: type 'help' for a list of commands\r\nOK\r\n"
const TOKEN = 'token-123'

describe('emuConsoleExec（休眠 console 客户端）', () => {
  it('完整往返：greeting → auth → 命令回执，正文只含命令之后的数据', async () => {
    const { socket, writes } = fakeSocket([GREETING, AUTH_OK, 'Save snapshot\r\nOK\r\n'])
    const result = await emuConsoleExec(5710, 'avd snapshot save msd-hib-x', 5_000, {
      connect: () => socket,
      readFile: async (path) => {
        expect(path).toBe('/Users/test/.emulator_console_auth_token')
        return TOKEN
      },
      retryCount: 1
    })
    expect(writes[0]).toBe(`auth ${TOKEN}\n`)
    expect(writes[1]).toBe('avd snapshot save msd-hib-x\n')
    // 认证 OK 不得混入正文；保存命令回执为正文
    expect(result).toBe('Save snapshot')
  })

  it('kill 断连：返回已收内容（PoC 实测：bye bye 后仍有一个尾随 OK）', async () => {
    const { socket } = fakeSocket([GREETING, AUTH_OK, 'OK: killing emulator, bye bye\r\nOK\r\n'])
    const result = await emuConsoleExec(5710, 'kill', 5_000, {
      connect: () => socket,
      readFile: async () => TOKEN,
      retryCount: 1
    })
    expect(result).toBe('OK: killing emulator, bye bye')
  })

  it('token 惰性落盘：首次读失败经重试后成功；裸 OK 回执正文为空', async () => {
    let reads = 0
    const { socket } = fakeSocket([GREETING, AUTH_OK, 'OK\r\n'])
    const result = await emuConsoleExec(5710, 'avd name', 5_000, {
      connect: () => socket,
      readFile: async () => {
        reads += 1
        if (reads === 1) throw new Error('ENOENT')
        return TOKEN
      },
      retryDelayMs: 1,
      retryCount: 3
    })
    expect(reads).toBe(2)
    expect(result).toBe('')
  })

  it('超时抛错（不静默）', async () => {
    const { socket } = fakeSocket([GREETING])
    await expect(
      emuConsoleExec(5710, 'avd snapshot save x', 60, {
        connect: () => socket,
        readFile: async () => TOKEN,
        retryCount: 1
      })
    ).rejects.toThrow(/timeout/)
  })

  it('连接错误抛错', async () => {
    const failing: ConsoleSocket = {
      write: vi.fn(),
      destroy: vi.fn(),
      onData: () => undefined,
      onClose: () => undefined,
      onError: (listener) => listener(new Error('ECONNREFUSED'))
    }
    await expect(
      emuConsoleExec(5710, 'kill', 1_000, {
        connect: () => failing,
        readFile: async () => TOKEN,
        retryCount: 1
      })
    ).rejects.toThrow('ECONNREFUSED')
  })
})
