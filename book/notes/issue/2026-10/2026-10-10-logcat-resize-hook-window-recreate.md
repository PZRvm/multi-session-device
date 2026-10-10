---
description: 日志面板 review P2——主窗关闭后重开，dock 宽度钳制钩子不随新窗口挂载，will-resize 拦截失效
created: 2026-10-10
status: open
severity: P2
---

# 主窗重开后 dock 宽度钳制钩子丢失

## 问题

`src/main/window/logcat.ts` 的 `attachDockResizeHook` 用模块级 `resizeHookAttached` 布尔防重复挂载。macOS 上主窗被红灯关闭（应用不退出）后再 activate 重建时，`createMainWindow` 产生**新的 BrowserWindow 对象**，而 flag 仍是 `true`——`attachDockResizeHook` 直接 return，新主窗上没有 `will-resize`/`resize` 钩子。

## 后果

- 新主窗上 dock 展开态拖窄窗口不再被 will-resize 预阻止（用户可把窗口拖到比 dock 需求更窄）。
- renderer 的 `dockVisible` 派生隐藏兜底仍在（dock 会消失而非挤爆画布）、`setSize` 拉宽分支仍在——降级为钳制失效，无数据损坏。
- `resize` 事后回弹同样失效（程序化路径兜底丢失）。

## 复现

1. 启动应用，展开日志 dock（钳制生效：拖不小）
2. 红灯关闭主窗（macOS 应用驻留）
3. Dock 图标 / Cmd+Tab 重新激活 → `activate` 重建主窗
4. 展开日志 dock → 拖窄窗口 → 不再被拦

## 建议方向

- flag 改为记录已挂钩的窗口 id（或直接挂到窗口实例上，如 `window.once('closed')` 时复位）；
- 或把钩子挂载移进 `createMainWindow`（经 ipc 装配层注入钳制谓词，避免 window ↔ logcat 循环依赖）。

## 备注

- review（plan 2026-10-10-logcat-panel 正式 review 轮）发现，按 workflow 只记录不修复。
- 与第六批「弃用 setMinimumSize 改双层钳制」同源——那批引入的防重复 flag 未考虑主窗换代。
