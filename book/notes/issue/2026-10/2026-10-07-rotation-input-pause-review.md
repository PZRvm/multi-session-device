---
description: 旋转暂停丢失 KeyUp 的 P2 已修复：main 释放旧键，暂停期间新输入直接丢弃
tags: [review, rotation, keyboard, input, keyup, regression]
---

# 旋转暂停会丢掉已有按键的 KeyUp

范围：当前未提交的旋转与电源改动，包括 App、DeviceCanvas、DeviceToolbar、shared/types 和 main/scrcpy。按八项 [review 检查单](../../../guidelines/review-checklist.md) 审查；只记录，未修改源码或正式测试。

## P2 — 禁用输入前没有释放已有键盘按键

- 位置：[DeviceCanvas.tsx:197](../../../../src/renderer/src/components/DeviceCanvas.tsx)。新 enabled 条件把 rotating/stopping 也视为禁用；对应 useDeviceInput.ts 的 enabledRef 更新（60—62）、send 守卫（67）、releaseAll（85—91）和禁用清理（332—334）。
- 触发：画布代理收到 ArrowDown 的 KeyDown；按住键点击旋转；锁定失败后恢复输入，重新聚焦画布并松开键。失败路径没有旋转或 generation 变化，仍会丢掉 KeyUp。
- 原因：禁用先令 enabledRef=false，再调用 releaseAll。releaseAll 的 send 被禁用守卫挡住，却仍清空 pressedKeysRef；后续 KeyUp 因找不到登记直接返回。main 的 rotate/release-all 只释放 pressedPointers，没有按键登记或 KeyUp 兜底。
- 影响：已发送到 Android 的按键失去配对释放，可能维持按下状态或重复动作；成功旋转也经过同一清理路径。仅暂停新输入不能代替释放原来的输入。
- 证据：临时测试挂载真实 DeviceCanvas、DeviceToolbar 和 useDeviceInput，仅 mock 投屏引用与 IPC。当前请求序列为 `keycode(arrow-down, down=true) → rotate`；松开后仍无 `down=false`，要求 KeyUp 的断言失败。将 DeviceCanvas 换为 git show HEAD 的版本、保留同一真实 hook 和同一事件序列，断言通过；因此不是只凭既有 hook 的缺陷推断新增回归。
- 建议：暂停时的清理必须能发送已有按键的 KeyUp，再清登记；可让清理绕过“禁止新输入”门，或由 main 登记按下键并统一释放。补真实 hook 的“按住键 → 旋转失败/成功 → 松开”回归。

## 其他核对与验证

- 前轮两项 P2 的触点守卫与工具条失败提示现已成立；rotating 在第一个 await 前置位，finally 在成功/失败/取消后解除。等待期间仍允许 release-all，旧归属、serial 绑定、窗口权限和尺寸校验保持有效。
- 电源走既有 App.handleStop → store.stop → devices.stop → runner；运行/停止快照与失败提示沿用原链路，关闭后无工具条，左侧才可启动。未发现该改动新增的停止状态或权限问题。
- 当前组件回归 mock 了 useDeviceInput，只断言 enabled=false；因此不会检测本条按键清理问题。
- 正式相关测试复跑：main/scrcpy 两文件、devices/index、renderer DeviceCanvas 两文件及 deviceStore，共 6 文件、87 项通过。临时对照探针 1 失败、1 通过，运行后删除。
- 重复代码、事务边界、错误归属、输入闭集、复杂度和范围均已核对；没有新增 IPC 或依赖。未发现本轮新增 P0/P1。
- 上轮全量 421 项、typecheck、lint、build 的通过结果未重新跑全套；源码未改。既有 fixtures/README.md 格式问题仍见 [原记录](2026-10-07-fixture-readme-format-baseline.md)。本轮没有启动或停止用户模拟器。

本条为后续 review 新发现，不重新打开前轮已修复的三项记录。实现计划见 [plan](../../../plans/2026-10-07-rotation-review-and-power-stop.md)。

## 2026-10-07 后续处理

用户要求禁用期间不执行输入，并直接丢弃旋转期间的操作。main 登记已接受的键盘和工具条按键，在旋转入口关闭后内部释放旧按键与触点，再锁定方向；期间全部合法外部输入（含 KeyUp 和 release-all）直接丢弃。renderer 不再依赖恢复后补发，清掉移动 RAF 与跨暂停的 IME 组合。

真实 DeviceCanvas、useDeviceInput 和控制注入回归覆盖“按住 ArrowDown → 旋转成功/失败 → 松开”，证明锁定前已配对 Up，暂停期间无新增请求，恢复后新按键正常；main IPC 使用真实 writer 检查全部输入种类被丢弃。全量 428 项通过、5 项跳过，build/typecheck、lint 和变更文件格式通过。本 P2 关闭，完整结果与实际设备验收阻碍见 [本次 plan](../../../plans/2026-10-07-discard-input-during-rotation.md)。
