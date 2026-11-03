---
description: 荣耀 30 Pro（EBG_AN00）USB serial 在会话内漂移——DSLDU20B12002637 与 DSLU20B12002637 两种形态出现，设备身份按 serial 键控会闪断重建；只记录不修
created: 2026-10-15
status: open
---

# 荣耀 30 Pro 的 USB serial 漂移

## 问题

2026-10-15 无线调试调试会话中，同一台荣耀 30 Pro（EBG_AN00）的 USB serial 出现过两
种形态：`DSLDU20B12002637` 与 `DSLU20B12002637`（少一个 D）。跨 `adb kill-server`
与多次 USB 重枚举后复现，非单次输入错误——两条形态都在 `adb devices` 输出里出现过。

## 影响

- external.ts 的设备身份与会话代次（epochs）按 serial 键控：serial 漂移等价于「旧设
  备消失 + 新设备出现」，投屏会话销毁重建（一帧闪断，功能自愈）。
- 转无线后身份变为 `ip:5555`，整个无线生命周期稳定——漂移只影响纯 USB 使用场景。
- 无持久化设计（2026-10-15 裁定）下无脏记录风险。

## 复现

USB 连接荣耀 30 Pro → `adb kill-server` → 观察 `adb devices` 的 serial；或多次插拔。
当日观察到两种形态交替。

## 建议方向

- 不修（影响轻微、自愈；用户已裁定无状态哲学）。
- 若未来要稳定身份：可在 device 态经 `adb shell getprop ro.serialno` 取硬件序号作
  聚合键——但与无持久化裁定冲突，需先重新裁定。
- 无线批 plan（2026-10-15-real-device-wireless）已在「风险与兜底」挂此条。
