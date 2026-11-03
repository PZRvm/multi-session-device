---
description: ADB 探测只读首段且漏掉 close 会让启动 Promise 挂起；Electron 的丢回复错误需沿等待链追踪
tags: [adb, tcp, fragmentation, ipc, pending-promise, startup, investigation]
---

# IPC 丢回复时，要检查启动前探测是否收口

场景：设备进入启动中却没有模拟器进程，Electron 提示 reply was never sent。普通启动两次成功；临时本地 server 将版本应答分两段后关闭，实际窗口复现同一症状。

已确认的原因：probeServer 使用 once('data')；首段不足完整帧便 return，后续段无人解析。连接先关闭时，该 socket 的 3 秒 timeout 不会结束 Promise。组件验证在 4200ms 后仍 pending；同样分段但保持连接则超时误判，完整一段则正常。

启动状态在等待前已写为 starting，runner entry 在探测后才创建，因此取消会找不到运行 entry 并留下 stopping。只观察 IPC 的外层错误或 UI 状态，无法分清等待卡在哪一步。

调查方法：使用生产函数的 connect 接缝对照完整帧、分段帧、半帧断开、保持连接；实际窗口用进程范围内的临时注入复验，再以完整应答对照。记录具体收包、close/timeout、Promise 结果与设备进程。结束旧实例时核对 PID，避免同名窗口误绑到上一个诊断进程。

结论边界：缺陷代码与 HEAD 相同，已证明可产生相同症状；上次自然异常未捕获收包，不能据此断言同一触发原因或发生率。报告与复现命令见 [issue](../../issue/2026-10/2026-10-07-api32-start-smoke-blocked.md)。本轮未修复。
