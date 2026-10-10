---
description: 日志域 adb 进程 spawn 同步失败时保留空会话，订阅者只见「暂无日志」空态，无任何错误提示
created: 2026-10-10
status: closed
---

# 日志会话 spawn 失败静默为空态

## 问题

`src/main/logcat/index.ts` 的 `startSession`：`spawn` 抛同步异常（如 adb 二进制缺失、权限问题）时 catch 后保留空壳会话并正常返回。订阅者收到空回放后面板永远显示「暂无日志」空态——与「设备安静无日志」不可区分，用户无从得知 logcat 根本没跑起来。

## 复现

模拟 adb 不可用（如临时改 PATH 指向空目录后启动设备），打开日志面板：无错误条、无日志行、空态文案。

## 建议

- 会话增加 `error` 状态；spawn 失败时订阅回放改为错误反馈（镜像投屏域 screenState 的 error 分支），面板渲染重试入口。
- 或至少在订阅 reject（`logcatDeviceNotRunning` 之外补 `logcatSpawnFailed` 词条）。

## 备注

- 概率低：adb 路径由 SDK bootstrap 域管理，正常流程下存在；但「用户手动删 SDK 目录后设备仍在 running」等场景可触达。
- review（plan 2026-10-10-logcat-panel Phase 5）发现，按 workflow 只记录不修复。

## 处置记录 — 2026-10-10

按建议第二条实现：会话记录 `spawnError`（`logcatSpawnFailed` 词条 + 原始错误附详情，三语），`spawn` 同步失败不再静默——订阅即 reject，面板经既有错误条渲染（订阅失败通路此前已就绪）。补单测「spawn 同步失败：订阅显式报错」；重试入口未加（切设备/重开 dock 即重订，天然重试）。
