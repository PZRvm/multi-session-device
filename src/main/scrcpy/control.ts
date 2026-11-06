import {
  AndroidKeyCode,
  AndroidKeyEventAction,
  AndroidMotionEventAction,
  type ScrcpyControlMessageWriter
} from '@yume-chan/scrcpy'
import type { ScreenInputRequest, ScreenKeycodeName, ScreenToolbarButton } from '@shared/types'

/** renderer 声明尺寸的合法域（scrcpy 控制协议 u16 上限） */
export const MAX_VIDEO_DIMENSION = 65_535
/** 每次提交的 UTF-8 字节预算（剪贴板粘贴路径） */
export const TEXT_MAX_BYTES = 4 * 1024
/** injectText 官方 reader 的单条文本预算（字节） */
export const INJECT_TEXT_CHUNK_BYTES = 300
/** 剪贴板粘贴 ACK 等待 */
export const CLIPBOARD_ACK_TIMEOUT_MS = 2_000

/** main 白名单：逻辑键 → Android keycode（闭集，renderer 不可传原始 keycode） */
export const KEYCODE_MAP: Record<ScreenKeycodeName, AndroidKeyCode> = {
  enter: AndroidKeyCode.Enter,
  backspace: AndroidKeyCode.Backspace,
  tab: AndroidKeyCode.Tab,
  'arrow-up': AndroidKeyCode.ArrowUp,
  'arrow-down': AndroidKeyCode.ArrowDown,
  'arrow-left': AndroidKeyCode.ArrowLeft,
  'arrow-right': AndroidKeyCode.ArrowRight,
  escape: AndroidKeyCode.Escape
}

export const BUTTON_KEYCODE_MAP: Record<ScreenToolbarButton, AndroidKeyCode> = {
  back: AndroidKeyCode.AndroidBack,
  home: AndroidKeyCode.AndroidHome,
  overview: AndroidKeyCode.AndroidAppSwitch,
  'volume-up': AndroidKeyCode.VolumeUp,
  'volume-down': AndroidKeyCode.VolumeDown
} as const

const isValidEnvelope = (value: Record<string, unknown>): boolean =>
  typeof value['deviceId'] === 'string' &&
  value['deviceId'].length > 0 &&
  typeof value['runId'] === 'string' &&
  value['runId'].length > 0 &&
  typeof value['streamId'] === 'string' &&
  value['streamId'].length > 0 &&
  Number.isInteger(value['generation']) &&
  (value['generation'] as number) >= 0 &&
  typeof value['viewToken'] === 'string' &&
  value['viewToken'].length > 0

/** renderer payload 不可信：形状与数值域全部过一遍，非法直接拒绝 */
export function validateInputRequest(raw: unknown): ScreenInputRequest | null {
  if (typeof raw !== 'object' || raw === null) return null
  const value = raw as Record<string, unknown>
  if (!isValidEnvelope(value)) return null
  const width = value['width']
  const height = value['height']
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    (width as number) <= 0 ||
    (width as number) > MAX_VIDEO_DIMENSION ||
    (height as number) <= 0 ||
    (height as number) > MAX_VIDEO_DIMENSION
  ) {
    return null
  }
  const input = value['input']
  if (typeof input !== 'object' || input === null) return null
  const entry = input as Record<string, unknown>
  switch (entry['kind']) {
    case 'touch': {
      const action = entry['action']
      if (action !== 'down' && action !== 'move' && action !== 'up' && action !== 'cancel')
        return null
      const pointerId = entry['pointerId']
      if (!Number.isInteger(pointerId) || (pointerId as number) < 0 || (pointerId as number) > 9) {
        return null
      }
      for (const key of ['x', 'y', 'pressure'] as const) {
        if (typeof entry[key] !== 'number' || !Number.isFinite(entry[key])) return null
      }
      const pressure = entry['pressure'] as number
      if (pressure < 0 || pressure > 1) return null
      return value as unknown as ScreenInputRequest
    }
    case 'button': {
      if (typeof entry['button'] !== 'string' || !(entry['button'] in BUTTON_KEYCODE_MAP))
        return null
      return value as unknown as ScreenInputRequest
    }
    case 'keycode': {
      if (typeof entry['key'] !== 'string' || !(entry['key'] in KEYCODE_MAP)) return null
      if (typeof entry['down'] !== 'boolean') return null
      return value as unknown as ScreenInputRequest
    }
    case 'text': {
      if (typeof entry['text'] !== 'string' || typeof entry['ime'] !== 'boolean') return null
      if (
        entry['source'] !== undefined &&
        (!entry['ime'] || (entry['source'] !== 'paste' && entry['source'] !== 'composition'))
      )
        return null
      const bytes = new TextEncoder().encode(entry['text'])
      if (bytes.length === 0 || bytes.length > TEXT_MAX_BYTES) return null
      return value as unknown as ScreenInputRequest
    }
    case 'rotate':
    case 'release-all':
      return value as unknown as ScreenInputRequest
    default:
      return null
  }
}

const utf8Encode = new TextEncoder()

/** injectText 分段：每段 ≤300 UTF-8 字节，边界不拆字符（代理对/组合字符整体挪下一段） */
export function chunkUtf8(text: string, limit = INJECT_TEXT_CHUNK_BYTES): string[] {
  const chunks: string[] = []
  let current = ''
  let currentBytes = 0
  for (const char of text) {
    const charBytes = utf8Encode.encode(char).length
    if (currentBytes + charBytes > limit && current.length > 0) {
      chunks.push(current)
      current = ''
      currentBytes = 0
    }
    current += char
    currentBytes += charBytes
  }
  if (current.length > 0) chunks.push(current)
  return chunks
}

const MOTION_ACTIONS = {
  down: AndroidMotionEventAction.Down,
  move: AndroidMotionEventAction.Move,
  up: AndroidMotionEventAction.Up,
  cancel: AndroidMotionEventAction.Cancel
} as const

export interface InjectContext {
  writer: ScrcpyControlMessageWriter
  width: number
  height: number
  /** 会话登记的按下指针（0/1）——rotate/release-all 与失焦兜底释放用 */
  pressedPointers: Set<number>
  /** 已接受的按下键；暂停时由 main 配对释放，不依赖 renderer 补发 Up */
  pressedKeys: Set<AndroidKeyCode>
  clipboardPaste: (content: string) => Promise<void>
  /** 手动旋转前锁定自动旋转，避免传感器立即恢复旧方向 */
  lockRotation: () => Promise<void>
}

async function injectKey(
  context: InjectContext,
  keyCode: AndroidKeyCode,
  down: boolean
): Promise<void> {
  // 写入前登记，旋转开始时也能看到尚在等待写入的 Down。
  if (down) context.pressedKeys.add(keyCode)
  else context.pressedKeys.delete(keyCode)
  await context.writer.injectKeyCode({
    action: down ? AndroidKeyEventAction.Down : AndroidKeyEventAction.Up,
    keyCode,
    repeat: 0,
    metaState: 0
  })
}

/** 释放会话登记的全部按下指针与按键（休眠保存前调用，避免按住状态进快照） */
export async function releaseInput(context: InjectContext): Promise<void> {
  for (const pointerId of [...context.pressedPointers]) {
    context.pressedPointers.delete(pointerId)
    await context.writer.injectTouch({
      action: AndroidMotionEventAction.Up,
      pointerId: BigInt(pointerId),
      pointerX: 0,
      pointerY: 0,
      videoWidth: context.width,
      videoHeight: context.height,
      pressure: 0,
      actionButton: 0,
      buttons: 0
    })
  }
  for (const keyCode of [...context.pressedKeys]) {
    await injectKey(context, keyCode, false)
  }
}

/** 单条输入 → scrcpy 控制消息（坐标像素夹取在调用方保证域内） */
export async function injectInput(
  request: ScreenInputRequest,
  context: InjectContext
): Promise<void> {
  const { writer, width, height } = context
  const input = request.input
  switch (input.kind) {
    case 'touch': {
      const px = Math.min(width - 1, Math.max(0, Math.round(input.x * width)))
      const py = Math.min(height - 1, Math.max(0, Math.round(input.y * height)))
      const pointerId = BigInt(input.pointerId)
      const action = MOTION_ACTIONS[input.action]
      if (input.action === 'down') context.pressedPointers.add(input.pointerId)
      if (input.action === 'up' || input.action === 'cancel')
        context.pressedPointers.delete(input.pointerId)
      await writer.injectTouch({
        action,
        pointerId,
        pointerX: px,
        pointerY: py,
        videoWidth: width,
        videoHeight: height,
        pressure: input.action === 'up' || input.action === 'cancel' ? 0 : input.pressure,
        actionButton: 0,
        buttons: 0
      })
      return
    }
    case 'button': {
      const keycode = BUTTON_KEYCODE_MAP[input.button]
      await injectKey(context, keycode, true)
      await injectKey(context, keycode, false)
      return
    }
    case 'keycode': {
      await injectKey(context, KEYCODE_MAP[input.key], input.down)
      return
    }
    case 'rotate': {
      // 会话已关闭外部输入入口；内部释放旧触点和按键后再锁定方向。
      await releaseInput(context)
      await context.lockRotation()
      await writer.rotateDevice()
      return
    }
    case 'release-all': {
      await releaseInput(context)
      return
    }
  }
}

// clipboardPaste 由会话层实现（setClipboard + 设备 ACK 等待）
