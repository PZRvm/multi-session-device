---
description: 无线连接把 macOS Local network prohibited 引发的 No route to host 统一提示为确认手机 Wi-Fi，原始 ADB 错误未传给用户
---

# 无线连接失败提示缺少电脑端权限原因

- **观察**：2026-11-03，手机 Wi-Fi 和 5555 监听正常，macOS 日志明确显示共享 ADB 服务 `Local network prohibited`，应用却提示「连不上 {host}：确认手机 Wi-Fi 在线、地址正确」。本次手工重启共享服务后恢复。
- **位置**：`src/main/devices/external.ts` 的 `connectWirelessDevice` 在连接输出不匹配成功时，重试后只按网段返回 `unreachable` / `cross-subnet`；没有把 `result.stderr` 中的 `No route to host` 留给用户。对应文案在 `src/shared/i18n/mainWindow.ts`。
- **复现条件**：共享 5037 ADB 服务的实际 macOS 权限归属被禁止本地网络访问，手机与电脑同网段，点击「转为无线」。应同时核对系统日志；仅凭 `No route to host` 不能断定是权限问题。
- **建议方向**：单独设计电脑端连接诊断与错误详情展示，包含 macOS 本地网络检查指引。不要把所有路由错误直接归为权限，也不要自动 kill 共享 ADB 服务。
- **状态**：只记录，未改代码。
