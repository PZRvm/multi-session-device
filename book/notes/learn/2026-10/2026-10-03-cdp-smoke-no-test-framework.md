---
description: 无测试框架时验证 Electron renderer 交互——dev 带 --remote-debugging-port，Node 内建 WebSocket 直连 CDP 点按钮/读状态/截屏
tags: [electron, cdp, smoke-test, react, screenshot, no-test-framework]
---

# renderer 交互冒烟不用测试框架——CDP + Node 内建 WebSocket

- **Scenario**: 要验证"点这个按钮界面变没变"（如 stage 02 亮暗切换），但 vitest 未接入、人不在屏幕前。
- **Why**: `npm run dev -- --remote-debugging-port=9222` 起 CDP 端点；`http://127.0.0.1:9222/json/list` 拿页面的 `webSocketDebuggerUrl`；Node 22 内建全局 `WebSocket` 可直连，`Runtime.evaluate` 点按钮/读 `getComputedStyle`/读 localStorage，`Page.captureScreenshot` 拿 base64 PNG——零依赖完成交互冒烟。
- **怎么用**: 脚本骨架在 stage 02 冒烟会话里写过（连接 → send 封装 → click → screenshot）。注意三点：① 首次连 CDP 会触发 vite 依赖优化 → 整页重载，点按前先 `Page.reload` + 等待，否则截到半程帧；② 原生对话框（dialog.showMessageBox）无法经 CDP 收场，别点；③ 截屏后用 Read 看图，别只信 computed style——learn 2026-10-01 的教训。
