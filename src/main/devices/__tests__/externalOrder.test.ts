// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  rename: vi.fn()
}))
vi.mock('electron', () => ({ app: { getPath: vi.fn(() => '/userdata') } }))
vi.mock('node:fs/promises', () => mocks)

import {
  applyOrder,
  commitOrder,
  EXTERNAL_ORDER_CAP,
  loadExternalOrder,
  orderNow
} from '../externalOrder'

const ORDER_JSON = '/userdata/external-order.json'

describe('真机用户序偏好存储（external-order.json）', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    mocks.readFile.mockRejectedValue(new Error('ENOENT'))
    await loadExternalOrder()
  })

  it('无文件 = 首启空序；load 先清零（重载即重新初始化）', async () => {
    await commitOrder(['a', 'b'])
    mocks.readFile.mockRejectedValue(new Error('ENOENT'))
    await loadExternalOrder()
    expect(orderNow()).toEqual([])
  })

  it('合法文件恢复序；非串与空串条目过滤', async () => {
    mocks.readFile.mockResolvedValueOnce(
      `${JSON.stringify({ version: 1, order: ['serial-2', 42, '', 'serial-1'] })}\n`
    )
    await loadExternalOrder()
    expect(orderNow()).toEqual(['serial-2', 'serial-1'])
  })

  it('损坏 JSON / 版本不符 / order 非数组：按缺省起步且不覆写原文件', async () => {
    for (const bad of ['not-json{{{', '{"version":2,"order":["a"]}', '{"version":1,"order":"a"}']) {
      mocks.readFile.mockResolvedValueOnce(bad)
      await loadExternalOrder()
      expect(orderNow()).toEqual([])
    }
    expect(mocks.writeFile).not.toHaveBeenCalled()
  })

  it('超上限截断头部 64 条（尾部丢弃）', async () => {
    const many = Array.from({ length: 80 }, (_, i) => `s${i}`)
    mocks.readFile.mockResolvedValueOnce(`${JSON.stringify({ version: 1, order: many })}`)
    await loadExternalOrder()
    expect(orderNow()).toEqual(many.slice(0, EXTERNAL_ORDER_CAP))
  })

  it('commitOrder 内存先行：立即生效并截断上限', async () => {
    const many = Array.from({ length: 80 }, (_, i) => `s${i}`)
    await commitOrder(many)
    expect(orderNow()).toEqual(many.slice(0, EXTERNAL_ORDER_CAP))
  })

  it('commitOrder 落盘走 tmp + rename 原子写，载荷含版本与全量序', async () => {
    await commitOrder(['x', 'y'])
    expect(mocks.writeFile).toHaveBeenCalledWith(
      `${ORDER_JSON}.tmp`,
      `${JSON.stringify({ version: 1, order: ['x', 'y'] }, null, 2)}\n`,
      'utf8'
    )
    expect(mocks.rename).toHaveBeenCalledWith(`${ORDER_JSON}.tmp`, ORDER_JSON)
  })

  it('落盘失败仅告警不回滚内存，队列不断：后续提交仍写', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    mocks.writeFile.mockRejectedValueOnce(new Error('磁盘忙'))
    await commitOrder(['a'])
    expect(orderNow()).toEqual(['a'])
    expect(warn).toHaveBeenCalledOnce()
    await commitOrder(['b'])
    expect(mocks.rename).toHaveBeenCalledWith(`${ORDER_JSON}.tmp`, ORDER_JSON)
    warn.mockRestore()
  })

  it('并发提交串行：上一次 rename 先于下一次 writeFile（tmp 不串写）', async () => {
    const steps: string[] = []
    mocks.writeFile.mockImplementation(async () => {
      steps.push('write')
      await new Promise((resolve) => setTimeout(resolve, 5))
    })
    mocks.rename.mockImplementation(async () => {
      steps.push('rename')
    })
    await Promise.all([commitOrder(['a']), commitOrder(['b']), commitOrder(['c'])])
    expect(steps).toEqual(['write', 'rename', 'write', 'rename', 'write', 'rename'])
  })
})

describe('applyOrder 稳定合并', () => {
  const item = (id: string): { id: string; tag: string } => ({ id, tag: `t-${id}` })

  it('空序原样返回（同一引用）', () => {
    const list = [item('a'), item('b')]
    expect(applyOrder(list, [])).toBe(list)
  })

  it('已知条目按记忆序排前，未知条目按载荷序追加尾部', () => {
    const list = [item('c'), item('a'), item('new-2'), item('b'), item('new-1')]
    const merged = applyOrder(list, ['b', 'a', 'c'])
    expect(merged.map((entry) => entry.id)).toEqual(['b', 'a', 'c', 'new-2', 'new-1'])
    // 对象引用原样移动（乐观渲染不换引用）
    expect(merged[0]).toBe(list[3])
    expect(merged[3]).toBe(list[2])
  })

  it('记忆含缺席条目不影响合并（拔线设备序位静默保留）', () => {
    const list = [item('a'), item('b')]
    const merged = applyOrder(list, ['gone', 'b', 'a'])
    expect(merged.map((entry) => entry.id)).toEqual(['b', 'a'])
  })

  it('全部未知（新机器无记忆）：保持载荷序', () => {
    const list = [item('x'), item('y')]
    expect(applyOrder(list, ['gone']).map((entry) => entry.id)).toEqual(['x', 'y'])
  })
})
