// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import {
  AndroidKeyCode,
  AndroidKeyEventAction,
  AndroidMotionEventAction,
  type ScrcpyControlMessageWriter
} from '@yume-chan/scrcpy'
import type { ScreenInputRequest } from '@shared/types'
import {
  BUTTON_KEYCODE_MAP,
  chunkUtf8,
  injectInput,
  KEYCODE_MAP,
  validateInputRequest,
  type InjectContext
} from '../control'

describe('手动旋转保持方向', () => {
  const request: ScreenInputRequest = {
    deviceId: 'd1',
    runId: 'r1',
    streamId: 's1',
    generation: 1,
    viewToken: 'vt',
    width: 1080,
    height: 2400,
    input: { kind: 'rotate' }
  }

  it('先释放触点，锁定完成后才发送一次旋转', async () => {
    const calls: string[] = []
    let unlock!: () => void
    const locked = new Promise<void>((resolve) => {
      unlock = resolve
    })
    const injectTouch = vi.fn(async () => {
      calls.push('up')
    })
    const rotateDevice = vi.fn(async () => {
      calls.push('rotate')
    })
    const injectKeyCode = vi.fn(async () => {
      calls.push('key-up')
    })
    const context: InjectContext = {
      writer: { injectTouch, injectKeyCode, rotateDevice } as unknown as ScrcpyControlMessageWriter,
      width: 1080,
      height: 2400,
      pressedPointers: new Set([0, 1]),
      pressedKeys: new Set([AndroidKeyCode.ArrowDown]),
      clipboardPaste: vi.fn(),
      lockRotation: vi.fn(async () => {
        calls.push('lock')
        await locked
      })
    }
    const pending = injectInput(request, context)
    await vi.waitFor(() => expect(context.lockRotation).toHaveBeenCalledOnce())
    expect(calls).toEqual(['up', 'up', 'key-up', 'lock'])
    expect(rotateDevice).not.toHaveBeenCalled()
    expect(context.pressedPointers.size).toBe(0)
    expect(context.pressedKeys.size).toBe(0)
    expect(injectKeyCode).toHaveBeenCalledWith({
      action: AndroidKeyEventAction.Up,
      keyCode: AndroidKeyCode.ArrowDown,
      repeat: 0,
      metaState: 0
    })
    expect(injectTouch).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AndroidMotionEventAction.Up,
        pressure: 0,
        videoWidth: 1080,
        videoHeight: 2400
      })
    )
    unlock()
    await pending
    expect(calls).toEqual(['up', 'up', 'key-up', 'lock', 'rotate'])
    expect(rotateDevice).toHaveBeenCalledOnce()
  })

  it('锁定失败时拒绝请求，不发送会被自动旋转覆盖的命令', async () => {
    const rotateDevice = vi.fn()
    const injectKeyCode = vi.fn(async () => {})
    const context: InjectContext = {
      writer: { injectKeyCode, rotateDevice } as unknown as ScrcpyControlMessageWriter,
      width: 1080,
      height: 2400,
      pressedPointers: new Set(),
      pressedKeys: new Set([AndroidKeyCode.Backspace]),
      clipboardPaste: vi.fn(),
      lockRotation: vi.fn().mockRejectedValue(new Error('lock failed'))
    }
    await expect(injectInput(request, context)).rejects.toThrow('lock failed')
    expect(rotateDevice).not.toHaveBeenCalled()
    expect(context.pressedKeys.size).toBe(0)
    expect(injectKeyCode).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AndroidKeyEventAction.Up,
        keyCode: AndroidKeyCode.Backspace
      })
    )
  })

  it('登记键盘与工具条按键，release-all 释放已按下键，配对 Up 清除登记', async () => {
    const injectKeyCode = vi.fn<(message: { action: AndroidKeyEventAction }) => Promise<void>>(
      async () => {}
    )
    const context: InjectContext = {
      writer: { injectKeyCode } as unknown as ScrcpyControlMessageWriter,
      width: 1080,
      height: 2400,
      pressedPointers: new Set(),
      pressedKeys: new Set(),
      clipboardPaste: vi.fn(),
      lockRotation: vi.fn()
    }
    await injectInput({ ...request, input: { kind: 'keycode', key: 'enter', down: true } }, context)
    expect(context.pressedKeys).toEqual(new Set([AndroidKeyCode.Enter]))
    await injectInput({ ...request, input: { kind: 'release-all' } }, context)
    expect(injectKeyCode.mock.calls.map(([message]) => message.action)).toEqual([
      AndroidKeyEventAction.Down,
      AndroidKeyEventAction.Up
    ])
    expect(context.pressedKeys.size).toBe(0)
    await injectInput({ ...request, input: { kind: 'keycode', key: 'enter', down: true } }, context)
    await injectInput(
      { ...request, input: { kind: 'keycode', key: 'enter', down: false } },
      context
    )
    expect(context.pressedKeys.size).toBe(0)
    injectKeyCode.mockImplementationOnce(async () => {
      expect(context.pressedKeys).toEqual(new Set([AndroidKeyCode.AndroidHome]))
    })
    await injectInput({ ...request, input: { kind: 'button', button: 'home' } }, context)
    expect(context.pressedKeys.size).toBe(0)
  })
})

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

  it('text 来源只接受 ime=true 的 paste/composition，保留无来源旧载荷', () => {
    for (const source of ['paste', 'composition']) {
      expect(
        validateInputRequest({ ...base, input: { kind: 'text', text: '中', ime: true, source } })
      ).not.toBeNull()
      expect(
        validateInputRequest({ ...base, input: { kind: 'text', text: '中', ime: false, source } })
      ).toBeNull()
    }
    expect(
      validateInputRequest({
        ...base,
        input: { kind: 'text', text: '中', ime: true, source: 'sync' }
      })
    ).toBeNull()
    expect(
      validateInputRequest({ ...base, input: { kind: 'text', text: '中', ime: true } })
    ).not.toBeNull()
  })

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
