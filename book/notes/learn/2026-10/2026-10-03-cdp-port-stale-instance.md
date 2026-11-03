---
description: electron-vite dev 的 CDP 端口被残留 Electron 实例占用时，CDP 会静默连到旧 app——「新代码不生效」先查 9222 被谁占
tags: [electron, cdp, electron-vite, debugging, port-conflict, smoke-test]
---

# CDP 调试端口被残留实例占用——冒烟连到旧 app

- **Scenario**: `npm run dev -- --remote-debugging-port=9222` 起 Electron 后，CDP 冒烟全部走通但行为「是旧代码」：新注册的 IPC handler 报 `No handler registered for 'devices:list'`，新界面死活不出现。
- **Why**: 上一次冒烟的 Electron 没杀干净，仍占着 9222。新实例的 devtools http server `bind() failed: Address already in use` **启动失败但不崩**，窗口照常起；CDP 端点却由旧实例服务——你连的是上一个进程。报错只在 dev server 日志里一行，极易漏看。
- **How to apply**: ① 冒烟前先 `lsof -ti :9222` 确认为空，不为空 `xargs kill -9`；② 连上 CDP 先打一针探针（如 `window.api.devices.list()`）确认行为符合当前代码，再跑长流程；③ 每轮冒烟收尾用 TaskStop 杀 dev 后再 `lsof -ti :9222 | xargs kill -9` 补刀（npm 被杀不必然带走 electron 子进程）。
