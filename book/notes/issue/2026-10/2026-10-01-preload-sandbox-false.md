---
description: preload 沿用模板的 sandbox: false；白名单 api 已就绪，具备评估开启 sandbox 的条件
status: resolved
---

> 2026-10-12 核销（fix/issue-audit 批）：主窗/向导/设置/日志窗 webPreferences 全部 sandbox: true，白名单 api 运行正常。
# preload webPreferences.sandbox 沿用模板默认 false

- **Observed**: 2026-10-01 stage 01 改造时，`src/main/window/index.ts` 保留了 electron-vite 模板的 `sandbox: false`。当前 preload 只用 `contextBridge` + `ipcRenderer`（经白名单 api），两者均兼容 sandbox。
- **Reproduction**: 查看 `src/main/window/index.ts` 的 webPreferences。
- **Suggested direction**: Electron 安全基线建议渲染进程开 sandbox。待 preload 白名单 api 稳定（stage 03 之后）评估翻 `true`，回归验证 `window.api` 全通道。属于加固项，非缺陷。

## 跟进（2026-10-03）——已翻 true

提前于 stage 03 落地（用户 2026-10-03 下令）：preload 复核只用 `contextBridge` + `ipcRenderer`（均在沙箱白名单内、无 Node 模块依赖），`window/index.ts` 翻 `sandbox: true`。验证边界如实记录：`ELECTRON_ENABLE_LOGGING=1 npm run dev` 启动冒烟——应用稳定运行、日志零 preload/sandbox/renderer 错误（vite connected、React 挂载正常；沙箱不兼容的 preload 必报 "Unable to load preload script"，未见）。`dialog:show` 的 invoke 链路按 Electron 文档在沙箱 preload 受支持；点验级对话框回归留给 stage 03 真实业务调用（本自检壳届时被替换）。
