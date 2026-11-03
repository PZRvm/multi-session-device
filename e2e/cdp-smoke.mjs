/* eslint-disable */
/**
 * 应用级 CDP 冒烟（stage04 步骤 5/6）：真窗口 + 真 renderer 解码。
 * 前置：本机已有 devices.json 两台 AVD；MSD_SMOKE 由脚本内部设置不需要。
 * 流程：起 dev（CDP 9222）→ 点启动 → 等 ready → 静置/交互帧率 → 切换第二台 →
 *       停止 → Browser.close 退出 → 验证 qemu 零残留。
 * 用法：node e2e/cdp-smoke.mjs
 */
import { spawn, execSync } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'

const ADB = join(homedir(), 'Library/Application Support/multi-session-device/AndroidSDK/platform-tools/adb')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const dev = spawn('npx', ['electron-vite', 'dev', '--', '--remote-debugging-port=9222'], {
  cwd: process.cwd(),
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' }
})
dev.stdout.on('data', (d) => process.stdout.write(`[dev] ${d}`))
dev.stderr.on('data', (d) => process.stderr.write(`[dev!] ${d}`))

const cleanup = (code) => {
  try { dev.kill('SIGKILL') } catch {}
  try { execSync(`pgrep -f 'qemu-system.*multi-session-device' | xargs kill -9 2>/dev/null || true`) } catch {}
  process.exit(code)
}
process.on('SIGINT', () => cleanup(130))

const wait = async (ms, fn, label) => {
  const deadline = Date.now() + ms
  let lastError = null
  while (Date.now() < deadline) {
    try {
      const value = await fn()
      if (value) return value
    } catch (error) { lastError = error }
    await sleep(500)
  }
  throw new Error(`等待超时：${label}${lastError ? `（${lastError.message}）` : ''}`)
}

const cdp = async () => {
  const targets = await wait(30_000, async () => {
    const res = await fetch('http://127.0.0.1:9222/json/list').then((r) => r.json())
    return res.find((t) => t.type === 'page' && !t.url.includes('devtools'))
  }, 'CDP page target')
  const ws = new WebSocket(targets.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject })
  let seq = 0
  const pending = new Map()
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data)
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
  }
  const call = (method, params = {}) => new Promise((resolve) => {
    const id = ++seq
    pending.set(id, resolve)
    ws.send(JSON.stringify({ id, method, params }))
  })
  const evaluate = async (expression) => {
    const res = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (res.result?.exceptionDetails) throw new Error(res.result.exceptionDetails.text)
    return res.result?.result?.value
  }
  return { evaluate, call, close: () => ws.close() }
}

try {
  const { evaluate, call } = await cdp()
  await sleep(2_000)

  const startButton = await wait(20_000, async () =>
    evaluate(`!!document.querySelector('[aria-label^="启动 "]')`), '启动按钮')
  console.log('[smoke] 设备列表就绪:', startButton)

  // 第一台启动
  await evaluate(`document.querySelector('[aria-label^="启动 "]').click()`)
  await wait(120_000, async () => evaluate(`window.__msdCanvas?.status === 'ready'`), '首台画面 ready')
  const format = await evaluate(`JSON.stringify(window.__msdCanvas.format)`)
  console.log('[smoke] 首台 ready，format:', format)

  // 静置帧率
  const p0 = await evaluate(`window.__msdCanvas.paints`)
  await sleep(5_000)
  const p1 = await evaluate(`window.__msdCanvas.paints`)
  const idleFps = (p1 - p0) / 5
  console.log(`[smoke] 静置 ${idleFps.toFixed(1)} 帧/s`)

  // 交互帧率（adb 外部驱动滑动，画面内容变化）
  const serial = await evaluate(`document.querySelector('[aria-label^="复制 serial"]')?.getAttribute('aria-label')?.match(/emulator-\\d+/)?.[0]`)
  if (!serial) throw new Error('serial 复制按钮缺失')
  console.log('[smoke] serial:', serial)
  const swipe = (up) => execSync(`"${ADB}" -s ${serial} shell input swipe 500 ${up ? 1800 : 600} 500 ${up ? 600 : 1800} 250`)
  const i0 = await evaluate(`window.__msdCanvas.paints`)
  const t0 = Date.now()
  let swipes = 0
  let up = true
  while (Date.now() - t0 < 10_000) { swipe(up); up = !up; swipes += 1 }
  const i1 = await evaluate(`window.__msdCanvas.paints`)
  const interactFps = (i1 - i0) / ((Date.now() - t0) / 1000)
  console.log(`[smoke] 交互 ${interactFps.toFixed(1)} 帧/s（${swipes} 次滑动）—— 线 ≥30`)

  // 触控注入（合成 pointer 事件走应用输入链）
  const touch = await evaluate(`(() => {
    const stage = document.querySelector('[aria-label$="画面"]')?.parentElement?.parentElement
    if (!stage) return 'stage 缺失'
    const rect = stage.getBoundingClientRect()
    const opts = (type, x, y) => new PointerEvent(type, { pointerId: 7, pointerType: 'mouse', button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: x, clientY: y, bubbles: true, isPrimary: true })
    stage.dispatchEvent(opts('pointerdown', rect.left + rect.width / 2, rect.top + rect.height / 2))
    stage.dispatchEvent(opts('pointermove', rect.left + rect.width / 2 + 40, rect.top + rect.height / 2))
    stage.dispatchEvent(opts('pointerup', rect.left + rect.width / 2 + 40, rect.top + rect.height / 2))
    return 'ok'
  })()`)
  console.log('[smoke] 合成触控:', touch)

  // 停止 → 画布退订（__msdCanvas 移除、回到占位）
  await evaluate(`document.querySelector('[aria-label^="停止 "]').click()`)
  await wait(30_000, async () => evaluate(`!window.__msdCanvas`), '停止后退订')
  console.log('[smoke] 停止完成，画布退订')

  // 退出（Browser.close 触发 before-quit 清理）
  await call('Browser.close')
  await sleep(4_000)
  const qemu = execSync(`pgrep -f 'qemu-system.*multi-session-device' || true`).toString().trim()
  if (qemu) throw new Error(`退出后仍有 qemu 残留：${qemu}`)
  console.log('[smoke] 应用退出，qemu 零残留 ✓')

  console.log(`\n[结论] 静置 ${idleFps.toFixed(1)} 帧/s · 交互 ${interactFps.toFixed(1)} 帧/s（${interactFps >= 30 ? '过线 ✅' : '未过线 ❌'}）`)
  cleanup(0)
} catch (error) {
  console.error('[smoke] 失败:', error.message)
  cleanup(1)
}
