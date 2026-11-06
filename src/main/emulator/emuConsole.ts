import net from 'node:net'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * emulator console 客户端（TCP + token 认证）——休眠「保存命名快照」与「优雅退出」
 * 的唯一通道（plan 2026-11-06-emulator-hibernation 设计 B）。
 *
 * 协议（36.1.9 实测，PoC timed 探针）：greeting（含 token 路径，以 OK 结尾）→
 * `auth <token>` → OK → 命令 → 响应以 OK 结尾。`avd snapshot save` 的 OK 在写盘
 * 完成后返回（同步语义）；`kill` 返回 OK 后断连。
 *
 * token 路径以 greeting 原文为准：本机实测 ANDROID_EMULATOR_HOME/ANDROID_USER_HOME
 * 隔离环境下 emulator 36.1.9 仍指向 $HOME/.emulator_console_auth_token——不猜路径。
 */

/** 连接/读写接缝（单测注入伪 socket） */
export interface ConsoleSocket {
  write(data: string): void
  destroy(): void
  onData(listener: (chunk: string) => void): void
  onClose(listener: () => void): void
  onError(listener: (error: Error) => void): void
}

export interface EmuConsoleDeps {
  connect?: (port: number) => ConsoleSocket
  readFile?: (path: string) => Promise<string>
  /** token 文件可能随连接惰性落盘：等它出现的重试间隔 */
  retryDelayMs?: number
  retryCount?: number
}

const defaultConnect = (port: number): ConsoleSocket => {
  const socket = net.connect({ host: '127.0.0.1', port })
  return {
    write: (data) => socket.write(data),
    destroy: () => socket.destroy(),
    onData: (listener) => socket.on('data', (chunk: Buffer) => listener(chunk.toString('utf8'))),
    onClose: (listener) => socket.on('close', listener),
    onError: (listener) => socket.on('error', (error: Error) => listener(error))
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const readTokenWithRetry = async (path: string, deps: EmuConsoleDeps): Promise<string | null> => {
  const read = deps.readFile ?? ((p: string) => readFile(p, 'utf8'))
  const count = deps.retryCount ?? 10
  for (let index = 0; index < count; index += 1) {
    try {
      return (await read(path)).trim()
    } catch {
      await sleep(deps.retryDelayMs ?? 200)
    }
  }
  return null
}

/**
 * 认证并执行一条 console 命令，返回去掉结尾 OK 的响应正文。
 * 连接失败/认证失败/超时均抛错——调用侧保留真实状态，不静默降级。
 */
export const emuConsoleExec = async (
  port: number,
  command: string,
  timeoutMs: number,
  deps: EmuConsoleDeps = {}
): Promise<string> => {
  const socket = (deps.connect ?? defaultConnect)(port)
  let buffer = ''
  let state: 'greeting' | 'authed' | 'command' = 'greeting'
  // 命令发出点的 buffer 长度：响应正文只取该点之后的数据——认证 OK 不会被误当命令回执
  let commandStart = -1
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.destroy()
      reject(new Error(`emulator console timeout (state=${state}, port=${port}): ${command}`))
    }, timeoutMs)
    const finish = (value: string): void => {
      clearTimeout(timer)
      socket.destroy()
      resolve(value)
    }
    const fail = (error: Error): void => {
      clearTimeout(timer)
      socket.destroy()
      reject(error)
    }
    socket.onError((error) => fail(error))
    socket.onClose(() => {
      clearTimeout(timer)
      // kill 命令的合法结局是服务端断连：返回已收内容
      resolve(buffer.trim())
    })
    socket.onData(async (chunk) => {
      buffer += chunk
      if (state === 'greeting') {
        if (!buffer.includes("'") || !/\r?\nOK\r?\n\s*$/.test(buffer)) return
        const tokenPath =
          buffer.match(/'([^']*emulator_console_auth_token)'/)?.[1] ??
          join(homedir(), '.emulator_console_auth_token')
        const token = await readTokenWithRetry(tokenPath, deps)
        if (token === null) {
          finish(`console auth token unavailable at ${tokenPath}`)
          return
        }
        socket.write(`auth ${token}\n`)
        state = 'authed'
        return
      }
      if (state === 'authed') {
        if (!/\r?\nOK\r?\n\s*$/.test(buffer)) return
        commandStart = buffer.length
        socket.write(`${command}\n`)
        state = 'command'
        return
      }
      // 命令回执：正文 + 结尾 OK；正文只看命令发出之后到达的数据（裸 OK = 无正文回执）
      const received = buffer.slice(commandStart)
      if (/\r?\nOK\r?\n\s*$/.test(received) || received.trim() === 'OK') {
        finish(received.replace(/(\r?\n)?OK\r?\n\s*$/, '').trim())
      }
    })
  })
}

/** console save 的 OK 语义为「已写盘」（36.1.9 PoC 实测）；KO/报错由调用侧判别 */
export const CONSOLE_RESPONSE_OK = 'OK'
