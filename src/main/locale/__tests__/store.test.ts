// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  rename: vi.fn()
}))
vi.mock('electron', () => ({ app: { getPath: vi.fn(() => '/userdata') } }))
vi.mock('node:fs/promises', () => mocks)

import { getLocaleState, loadLocaleState, persistLocaleState, updateLocaleState } from '../store'

describe('locale store（locale.json）', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    // 模块级内存态无法直接重置：先以「无文件」load 回到缺省
    mocks.readFile.mockRejectedValue(new Error('ENOENT'))
    await loadLocaleState()
  })

  it('无文件 = 首启缺省 zh-CN', () => {
    expect(getLocaleState()).toBe('zh-CN')
  })

  it('合法文件恢复语言', async () => {
    mocks.readFile.mockResolvedValueOnce('{"version":1,"locale":"en-US"}')
    await loadLocaleState()
    expect(getLocaleState()).toBe('en-US')
  })

  it('损坏 JSON 按缺省起步且不覆写原文件', async () => {
    mocks.readFile.mockResolvedValueOnce('not-json{{{')
    await loadLocaleState()
    expect(getLocaleState()).toBe('zh-CN')
    expect(mocks.writeFile).not.toHaveBeenCalled()
  })

  it('闭集外 locale 回落缺省', async () => {
    mocks.readFile.mockResolvedValueOnce('{"version":1,"locale":"fr-FR"}')
    await loadLocaleState()
    expect(getLocaleState()).toBe('zh-CN')
  })

  it('updateLocaleState 内存先行：立即生效、不落盘', () => {
    updateLocaleState('zh-TW')
    expect(getLocaleState()).toBe('zh-TW')
    expect(mocks.writeFile).not.toHaveBeenCalled()
  })

  it('persistLocaleState 原子写：先 tmp 后 rename，内容带版本号', async () => {
    updateLocaleState('en-US')
    mocks.writeFile.mockResolvedValue(undefined)
    mocks.rename.mockResolvedValue(undefined)
    await persistLocaleState()
    expect(mocks.writeFile).toHaveBeenCalledWith(
      '/userdata/locale.json.tmp',
      `${JSON.stringify({ version: 1, locale: 'en-US' }, null, 2)}\n`,
      'utf8'
    )
    expect(mocks.rename).toHaveBeenCalledWith('/userdata/locale.json.tmp', '/userdata/locale.json')
  })

  it('落盘失败向调用方抛出但不断写队列（下一次写仍执行）', async () => {
    mocks.writeFile.mockRejectedValueOnce(new Error('磁盘满'))
    mocks.writeFile.mockResolvedValue(undefined)
    mocks.rename.mockResolvedValue(undefined)
    await expect(persistLocaleState()).rejects.toThrow('磁盘满')
    await persistLocaleState()
    expect(mocks.writeFile).toHaveBeenCalledTimes(2)
    expect(mocks.rename).toHaveBeenCalledTimes(1)
  })
})
