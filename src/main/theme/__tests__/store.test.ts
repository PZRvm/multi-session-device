// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  rename: vi.fn()
}))
vi.mock('electron', () => ({ app: { getPath: vi.fn(() => '/userdata') } }))
vi.mock('node:fs/promises', () => mocks)

import { getThemeState, loadThemeState, persistThemeState, updateThemeState } from '../store'

const THEME_JSON = '/userdata/theme.json'

describe('主题 store（theme.json）', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    // 模块级内存态无法直接重置：先以「无文件」load 回到缺省 + fresh
    mocks.readFile.mockRejectedValue(new Error('ENOENT'))
    await loadThemeState()
  })

  it('无文件 = 首启缺省（琥珀 + 跟随系统），fresh=true', () => {
    expect(getThemeState()).toEqual({ systemId: 'amber', mode: 'system', fresh: true })
  })

  it('合法文件恢复主题，fresh=false', async () => {
    mocks.readFile.mockResolvedValueOnce('{"version":1,"systemId":"moss","mode":"dark"}')
    await loadThemeState()
    expect(getThemeState()).toEqual({ systemId: 'moss', mode: 'dark', fresh: false })
  })

  it('损坏 JSON 按缺省起步且不覆写原文件', async () => {
    mocks.readFile.mockResolvedValueOnce('not-json{{{')
    await loadThemeState()
    expect(getThemeState()).toEqual({ systemId: 'amber', mode: 'system', fresh: false })
    expect(mocks.writeFile).not.toHaveBeenCalled()
  })

  it('非法字段逐条过滤回落缺省', async () => {
    mocks.readFile.mockResolvedValueOnce('{"version":1,"systemId":"nope","mode":"auto"}')
    await loadThemeState()
    expect(getThemeState()).toEqual({ systemId: 'amber', mode: 'system', fresh: false })
  })

  it('updateThemeState 内存先行：立即生效、fresh 翻 false、不落盘', () => {
    updateThemeState({ mode: 'dark' })
    expect(getThemeState()).toEqual({ systemId: 'amber', mode: 'dark', fresh: false })
    expect(mocks.writeFile).not.toHaveBeenCalled()
  })

  it('persistThemeState 走 tmp + rename 原子写，内容含版本与全量字段', async () => {
    updateThemeState({ systemId: 'mist', mode: 'dark' })
    await persistThemeState()
    expect(mocks.writeFile).toHaveBeenCalledWith(
      `${THEME_JSON}.tmp`,
      `${JSON.stringify({ version: 1, systemId: 'mist', mode: 'dark' }, null, 2)}\n`,
      'utf8'
    )
    expect(mocks.rename).toHaveBeenCalledWith(`${THEME_JSON}.tmp`, THEME_JSON)
  })

  it('并发 persist 串行执行：上一次 rename 先于下一次 writeFile（tmp 不串写）', async () => {
    const order: string[] = []
    mocks.writeFile.mockImplementation(async () => {
      order.push('write')
      await new Promise((resolve) => setTimeout(resolve, 5))
    })
    mocks.rename.mockImplementation(async () => {
      order.push('rename')
    })
    updateThemeState({ mode: 'dark' })
    const first = persistThemeState()
    updateThemeState({ mode: 'light' })
    const second = persistThemeState()
    await Promise.all([first, second])
    expect(order).toEqual(['write', 'rename', 'write', 'rename'])
    // 载荷在调用时快照：第一次写 dark、第二次写 light，最终盘上为后者
    expect(mocks.writeFile.mock.calls[0][1]).toContain('"mode": "dark"')
    expect(mocks.writeFile.mock.calls[1][1]).toContain('"mode": "light"')
  })

  it('单次 persist 失败不断队列：后续 persist 仍执行', async () => {
    mocks.writeFile.mockRejectedValueOnce(new Error('磁盘忙'))
    updateThemeState({ mode: 'dark' })
    await expect(persistThemeState()).rejects.toThrow('磁盘忙')
    updateThemeState({ mode: 'light' })
    await persistThemeState()
    expect(mocks.rename).toHaveBeenCalledTimes(1)
  })
})
