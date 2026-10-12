---
description: window.api 对话框调用在守卫拒绝时会 reject，调用方不接住就是 unhandled rejection——调用约定要成文
status: resolved
---

> 2026-10-12 resolved（fix/issue-audit 批）：调用约定成文进 guidelines/coding-style.md（invoke 拒绝必须有归宿）；排查全部 `dialog.show` 调用点——App/Wizard 经 toApiResult、PaneEmulator 外层 runAction 已接，唯一裸点（DeviceWizard 卸载确认框段）补 try/catch 与执行段同口径展示。

# window.api.dialog.show 的 rejection 需要调用方接住

- **Observed**: 2026-10-01 code review 发现：main 侧守卫对非法入参抛错，invoke 在 renderer 侧变成 promise rejection；自检壳 App.tsx 的按钮 handler 未 catch，守卫拒绝时会成 unhandled rejection。当前调用方只有自检壳（stage 03 会被替换），影响面小。
- **Reproduction**: DevTools console 里执行 `window.api.dialog.show({ title: 1 })`。
- **Suggested direction**: 在 coding-style 的 IPC 纪律里已写明"调用要处理 reject"；stage 03 起真正的业务调用方应统一 catch 或封装一层带错误形态的调用助手。

## 跟进（2026-10-03）——已修

按"封装一层带错误形态的调用助手"落地：`renderer/src/api/index.ts` 新增 `toApiResult`——泛型包装，invoke 的 reject 变成 `{ ok: false, error }` 判别联合，调用方免 try/catch；自检壳 App.tsx 两个 handler 已迁移为判定 `result.ok`；coding-style 错误处理一节同步改为"统一经 toApiResult 包装"。边界如实记录：裸 `window.api.dialog.show({ title: 1 })` 在 DevTools 直调仍会 reject（window.api 契约不变，守卫照旧抛错），业务代码走助手即无 unhandled rejection——typecheck / 全仓 lint 全绿。
