---
description: Electron dev 终端看不到 renderer 控制台——ELECTRON_ENABLE_LOGGING=1 让 console 进 stdout，是无测试框架时验证 preload/renderer 的主要手段
tags: [electron, logging, preload, sandbox, smoke-test, devtools]
---

# renderer 的 console 默认不进终端——ELECTRON_ENABLE_LOGGING=1 打开

- **场景**：`npm run dev` 想确认 preload 是否加载成功、renderer 有没有报错（比如翻 sandbox 后验证），终端默认一片安静。
- **原因**：Electron 的 renderer 控制台只进 DevTools，主进程不转发。
- **怎么用**：`ELECTRON_ENABLE_LOGGING=1 npm run dev`——Chromium 日志（`CONSOLE:ERROR`、"Unable to load preload script"、vite connected 等）直接进 stdout，`grep` 一下就是无测试框架时的启动冒烟。2026-10-03 翻 sandbox: true 验证即用此法。
