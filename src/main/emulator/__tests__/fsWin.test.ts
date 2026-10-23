// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { RETRY_INTERVAL_MS, RETRY_MAX, makeResilientRename } from '../fsWin'

const errno = (code: string): NodeJS.ErrnoException =>
  Object.assign(new Error(`${code}: simulated`), { code })

/** 按序抛出给定错误、耗尽后成功的 renameFn；记录调用序列 */
const renameFailingWith = (
  failures: NodeJS.ErrnoException[]
): { fn: (from: string, to: string) => Promise<void>; calls: Array<[string, string]> } => {
  const calls: Array<[string, string]> = []
  const queue = [...failures]
  return {
    calls,
    fn: async (from, to) => {
      calls.push([from, to])
      const next = queue.shift()
      if (next) throw next
    }
  }
}

const makeDeps = (
  rename: (from: string, to: string) => Promise<void>
): {
  deps: Parameters<typeof makeResilientRename>[1]
  sleeps: number[]
  copies: Array<[string, string]>
  removes: string[]
} => {
  const sleeps: number[] = []
  const copies: Array<[string, string]> = []
  const removes: string[] = []
  return {
    sleeps,
    copies,
    removes,
    deps: {
      renameFn: rename,
      sleep: async (ms) => {
        sleeps.push(ms)
      },
      copyDir: async (from, to) => {
        copies.push([from, to])
      },
      removePath: async (path) => {
        removes.push(path)
      }
    }
  }
}

describe('fsWin.makeResilientRename（win32 锁重试 + EXDEV 回退）', () => {
  it('EPERM 两次后成功：重试两次、每次退避 100ms，不走复制', async () => {
    const rename = renameFailingWith([errno('EPERM'), errno('EPERM')])
    const env = makeDeps(rename.fn)
    await expect(makeResilientRename('win32', env.deps)('/a', '/b')).resolves.toBeUndefined()
    expect(rename.calls).toHaveLength(3)
    expect(env.sleeps).toEqual([RETRY_INTERVAL_MS, RETRY_INTERVAL_MS])
    expect(env.copies).toHaveLength(0)
    expect(env.removes).toHaveLength(0)
  })

  it.each(['EACCES', 'EBUSY'])('%s 同属可重试锁错误：一次重试后恢复', async (code) => {
    const rename = renameFailingWith([errno(code)])
    const env = makeDeps(rename.fn)
    await makeResilientRename('win32', env.deps)('/a', '/b')
    expect(rename.calls).toHaveLength(2)
    expect(env.sleeps).toEqual([RETRY_INTERVAL_MS])
  })

  it('重试耗尽：共尝试 1+RETRY_MAX 次、退避 RETRY_MAX 次，抛出原错误对象', async () => {
    const last = errno('EBUSY')
    const failures = [...Array.from({ length: RETRY_MAX }, () => errno('EPERM')), last]
    const rename = renameFailingWith(failures)
    const env = makeDeps(rename.fn)
    await expect(makeResilientRename('win32', env.deps)('/a', '/b')).rejects.toBe(last)
    expect(rename.calls).toHaveLength(RETRY_MAX + 1)
    expect(env.sleeps).toHaveLength(RETRY_MAX)
    expect(env.copies).toHaveLength(0)
  })

  it('非重试码（ENOENT）直接抛出：不退避、不复制', async () => {
    const error = errno('ENOENT')
    const rename = renameFailingWith([error])
    const env = makeDeps(rename.fn)
    await expect(makeResilientRename('win32', env.deps)('/a', '/b')).rejects.toBe(error)
    expect(rename.calls).toHaveLength(1)
    expect(env.sleeps).toHaveLength(0)
    expect(env.copies).toHaveLength(0)
  })

  it('EXDEV 跨卷：回退 copyDir(from,to) → removePath(from)，顺序固定，不重试', async () => {
    const rename = renameFailingWith([errno('EXDEV')])
    const env = makeDeps(rename.fn)
    await expect(
      makeResilientRename('win32', env.deps)('/c/src', '/d/dest')
    ).resolves.toBeUndefined()
    expect(rename.calls).toHaveLength(1)
    expect(env.sleeps).toHaveLength(0)
    expect(env.copies).toEqual([['/c/src', '/d/dest']])
    expect(env.removes).toEqual(['/c/src'])
  })

  it('EXDEV 回退时 copyDir 失败：错误原样上抛，不删源', async () => {
    const rename = renameFailingWith([errno('EXDEV')])
    const env = makeDeps(rename.fn)
    const copyError = new Error('disk full')
    env.deps!.copyDir = async () => {
      throw copyError
    }
    await expect(makeResilientRename('win32', env.deps)('/c/src', '/d/dest')).rejects.toBe(
      copyError
    )
    expect(env.removes).toHaveLength(0)
  })

  it('EXDEV 回退时 removePath 失败：错误原样上抛（目标已复制，源残留由调用方回滚路径收口）', async () => {
    const rename = renameFailingWith([errno('EXDEV')])
    const env = makeDeps(rename.fn)
    const removeError = errno('EPERM')
    env.deps!.removePath = async () => {
      throw removeError
    }
    await expect(makeResilientRename('win32', env.deps)('/c/src', '/d/dest')).rejects.toBe(
      removeError
    )
    expect(env.copies).toHaveLength(1)
  })

  it('非 win32（darwin）：直通裸 rename——调用一次、错误原样、零退避零复制', async () => {
    const error = errno('EPERM')
    const rename = renameFailingWith([error])
    const env = makeDeps(rename.fn)
    await expect(makeResilientRename('darwin', env.deps)('/a', '/b')).rejects.toBe(error)
    expect(rename.calls).toEqual([['/a', '/b']])
    expect(env.sleeps).toHaveLength(0)
    expect(env.copies).toHaveLength(0)
    expect(env.removes).toHaveLength(0)
  })

  it('非 win32 成功路径同样只调一次 rename', async () => {
    const rename = vi.fn(async () => {})
    await makeResilientRename('linux', { renameFn: rename })('/a', '/b')
    expect(rename).toHaveBeenCalledTimes(1)
    expect(rename).toHaveBeenCalledWith('/a', '/b')
  })
})
