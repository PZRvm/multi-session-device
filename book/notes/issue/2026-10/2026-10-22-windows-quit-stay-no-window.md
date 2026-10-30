---
description: Windows 关窗确认选「留在应用」后 app 无窗口且无唤回入口——需 second-instance 处理，真机验收前修复
---

# Windows「留在应用」折返后无窗口可唤回

- **问题**：win32 上关最后一个窗口触发退出确认，选「留在应用」后 app 存活，但主窗已在 `window-all-closed` 之前销毁——无托盘（已拍板不做）、`activate` 仅 macOS dock 触发、未处理 `second-instance`，用户失去回到界面的全部入口，只能任务管理器结束进程再重开。
- **复现**（真机剧本推演，来自 P3 验收清单梳理；待 Windows 真机实证）：Windows 上启动一台模拟器 → 关闭主窗 → 弹「退出将停止运行中的设备」→ 选「留在应用」→ 应用无窗口驻留；再点快捷方式二次启动也不会唤回（无 `second-instance` 处理，新进程独立起来）。
- **建议方向**：`app.requestSingleInstanceLock()` + `second-instance` 事件里 `if (!getMainWindow()) createMainWindow()`——用户再点快捷方式即唤回界面；mac 路径零影响（本就不走关窗退出）。修复归属：P3 修复轮（建议真机集成验证前完成，否则「留在应用」剧本验不了后半段）。
- **修复批（2026-10-30，Windows 真机，feature/windows-settings-finish）**：已落地——`index.ts` 顶部 `requestSingleInstanceLock()`（无锁即退，其 before-quit 直行不走清理链），`second-instance` 调 `reviveMainWindow`（quit-confirm 模块新增，结构性接缝可单测）：主窗在则还原最小化并聚焦，不在则重建；whenReady 体加锁守卫防被拒实例闪窗。单测 +3（在场最小化还原聚焦 / 在场未最小化只聚焦 / 不在重建）。真机剧本（关窗 → 留在应用 → 再点快捷方式唤回）归统一集成验证执行。
