---
description: CDP 驱动 Electron 页面时窗口在 evaluate 应答前关闭——WebSocket 无响应也不报错，pending promise 永不 settle，脚本静默悬挂
tags: [electron, cdp, smoke-test, websocket, gotcha]
---

# CDP evaluate 撞上页面销毁——pending 永不 settle

- **Scenario**: CDP 冒烟驱动 Electron 页面，某次 `Runtime.evaluate` 触发了窗口自毁（如向导页 dispatch Escape → IPC 关窗）：evaluate 的响应永远不回来，脚本卡死在该 await，无任何报错。
- **Why**: 页面销毁后调试 WebSocket 直接断开，既不来响应也不触发 `onmessage`；若驱动层只在 `onmessage` 里 resolve pending，断线时 pending Map 里的 promise 全部悬挂——脚本体现在没有超时兜底就会无限等。
- **How to apply**: 驱动封装里挂 `ws.onclose`/`ws.onerror`，把所有 pending 一并 reject（页面关了 = 操作「失败」，往往正是预期结果，catch 后继续断言 target 消失即可）；所有 waitFor 带超时。本轮向导冒烟即靠 `json/list` 里 target 消失确认 Esc 关闭成功，脚本悬挂属驱动缺陷而非应用行为。
