// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { BUTTON_KEYCODE_MAP, chunkUtf8, KEYCODE_MAP, validateInputRequest } from '../control'

describe('chunkUtf8（injectText 300 字节预算）', () => {
  it('短文本不分段', () => {
    expect(chunkUtf8('hello')).toEqual(['hello'])
  })

  it('ASCII 按预算切段', () => {
    const chunks = chunkUtf8('a'.repeat(650))
    expect(chunks).toEqual(['a'.repeat(300), 'a'.repeat(300), 'a'.repeat(50)])
  })

  it('CJK（每字 3 字节）边界不拆字', () => {
    const text = '测'.repeat(150) // 450 字节
    const chunks = chunkUtf8(text)
    expect(chunks).toHaveLength(2)
    for (const chunk of chunks) {
      expect(new TextEncoder().encode(chunk).length).toBeLessThanOrEqual(300)
      expect(chunk.length % 1).toBe(0)
    }
    expect(chunks.join('')).toBe(text)
  })

  it('代理对（emoji）整体挪段，不拆出孤代理', () => {
    const emoji = '😀' // 4 字节
    const text = emoji.repeat(80) // 320 字节
    const chunks = chunkUtf8(text)
    expect(chunks.join('')).toBe(text)
    for (const chunk of chunks) {
      // 每段都应是完整码点序列
      expect(new TextEncoder().encode(chunk).length).toBeLessThanOrEqual(300)
      expect(chunk).toMatch(/^(\ud83d\ude00)*$/)
    }
  })

  it('混合内容按字符累进', () => {
    const text = 'a测'.repeat(200) // 每组 4 字节 → 800 字节
    const chunks = chunkUtf8(text)
    expect(chunks.join('')).toBe(text)
    expect(new TextEncoder().encode(chunks[0]).length).toBeLessThanOrEqual(300)
  })
})

describe('validateInputRequest（renderer payload 不可信）', () => {
  const base = {
    deviceId: 'd1',
    runId: 'r1',
    streamId: 's1',
    generation: 2,
    viewToken: 'vt',
    width: 1080,
    height: 2400,
    input: { kind: 'touch', action: 'down', pointerId: 0, x: 0.5, y: 0.5, pressure: 1 }
  }

  it('合法 touch 通过', () => {
    expect(validateInputRequest(base)).not.toBeNull()
  })

  it('归属字段缺失/空 → 拒绝', () => {
    expect(validateInputRequest({ ...base, viewToken: '' })).toBeNull()
    expect(validateInputRequest({ ...base, generation: -1 })).toBeNull()
    expect(validateInputRequest({ ...base, generation: 1.5 })).toBeNull()
  })

  it('尺寸域：正整数且 ≤ u16', () => {
    expect(validateInputRequest({ ...base, width: 0 })).toBeNull()
    expect(validateInputRequest({ ...base, width: 65_536 })).toBeNull()
    expect(validateInputRequest({ ...base, height: 1.5 })).toBeNull()
  })

  it('touch 域：action 闭集、pointerId 整数、坐标有限、pressure ∈ [0,1]', () => {
    expect(validateInputRequest({ ...base, input: { ...base.input, action: 'hover' } })).toBeNull()
    expect(validateInputRequest({ ...base, input: { ...base.input, pointerId: 1.5 } })).toBeNull()
    expect(validateInputRequest({ ...base, input: { ...base.input, x: '0.5' } })).toBeNull()
    expect(validateInputRequest({ ...base, input: { ...base.input, pressure: 2 } })).toBeNull()
  })

  it('button 闭集（不含裸 keycode）', () => {
    expect(
      validateInputRequest({ ...base, input: { kind: 'button', button: 'home' } })
    ).not.toBeNull()
    expect(validateInputRequest({ ...base, input: { kind: 'button', button: 'hax' } })).toBeNull()
  })

  it('keycode 白名单', () => {
    expect(
      validateInputRequest({ ...base, input: { kind: 'keycode', key: 'enter', down: true } })
    ).not.toBeNull()
    expect(
      validateInputRequest({ ...base, input: { kind: 'keycode', key: 'F5', down: true } })
    ).toBeNull()
  })

  it('text：字节数 ≤ 4KiB 且非空，ime 必须是布尔', () => {
    expect(
      validateInputRequest({ ...base, input: { kind: 'text', text: '你好', ime: true } })
    ).not.toBeNull()
    expect(
      validateInputRequest({ ...base, input: { kind: 'text', text: '', ime: false } })
    ).toBeNull()
    expect(
      validateInputRequest({ ...base, input: { kind: 'text', text: 'x'.repeat(4097), ime: false } })
    ).toBeNull()
    expect(
      validateInputRequest({ ...base, input: { kind: 'text', text: 'x', ime: 'yes' } })
    ).toBeNull()
  })

  it('rotate / release-all 通过；未知 kind 拒绝', () => {
    expect(validateInputRequest({ ...base, input: { kind: 'rotate' } })).not.toBeNull()
    expect(validateInputRequest({ ...base, input: { kind: 'release-all' } })).not.toBeNull()
    expect(validateInputRequest({ ...base, input: { kind: 'shell', cmd: 'rm' } })).toBeNull()
  })
})

describe('键位映射（main 白名单）', () => {
  it('工具条按钮（除电源）与 keycode 都有映射', () => {
    expect(Object.keys(BUTTON_KEYCODE_MAP).sort()).toEqual(
      ['back', 'home', 'overview', 'volume-down', 'volume-up'].sort()
    )
    expect(KEYCODE_MAP['arrow-up']).toBeDefined()
    expect(KEYCODE_MAP.escape).toBeDefined()
  })
})
