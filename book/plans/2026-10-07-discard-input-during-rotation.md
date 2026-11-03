---
description: 旋转期间丢弃新输入、不排队补发，main 释放旧按键和触点，修复暂停后丢失 KeyUp
status: completed
created: 2026-10-07
---

# 旋转期间直接丢弃输入

## Brief 与分析

用户要求旋转期间的操作直接丢弃，禁用期间不执行这些外部输入。前轮 [review](../notes/issue/2026-10/2026-10-07-rotation-input-pause-review.md) 已证实暂停时 renderer 清空按下键登记，main 又只释放触点，导致旋转失败后 KeyUp 也丢失。

范围：旋转开始后到达的合法 screen.input 请求直接结束，不写控制通道、不排队、不在结束后补发；main 内部先释放已接受的旧按键和触点。renderer 清掉待发送移动帧和跨暂停的 IME 组合。保留归属、权限、尺寸和入参守卫，保持旋转锁定、失败提示与电源独立停止链路。

排除：历史上已发到设备的文本撤销、SDK/AVD/runner 改动、输入协议重做、剪贴板能力扩展、旧资料格式问题。不增加 IPC 或依赖。

## 设计

- main 的 rotating 在首次 await 前置位；旋转期间所有合法输入（包括 KeyUp、release-all、按钮、文本和重复 rotate）直接丢弃。非法/旧归属请求仍经现有守卫拒绝。
- StreamSession 与 InjectContext 增 pressedKeys，由实际 keycode 和工具条 Down/Up 维护；rotate/release-all 共用内部释放逻辑，发配对 Up 后清登记，再锁定方向和旋转。外部输入不能插入释放过程，finally 解封。
- useDeviceInput 保持禁用时不发请求；清理时取消待发送 RAF、清空移动集合，标记尚未结束或禁用期间开始的 IME 组合为丢弃，恢复后不提交旧内容。普通新输入恢复后仍可使用。
- 涉及 main/scrcpy/control.ts、index.ts、useDeviceInput.ts 和对应测试；补真实 DeviceCanvas/useDeviceInput/控制注入的键盘回归，避免 mock hook 掩盖清理问题。

## 验收

1. 先补回归：锁定等待期间各输入闭集都不写通道，成功/失败后无补发并可继续操作；已按下键和触点在锁定前释放；普通按键 Down/Up 与工具条释放登记正确。
2. 真实 hook 覆盖移动 RAF 与 IME 跨暂停丢弃；真实 Canvas 经过旋转成功/失败后不留按下键。
3. 相关和全量 test、typecheck、lint、build、变更文件格式检查；新鲜 dev 实测设置页旋转和电源停止。
4. review 只记录；关闭原 P2，写 learn、补 stage/plan 结果，刷新 book 索引。

## 结果与 review

main 在首次 await 前关闭输入入口，旋转期间的合法请求直接返回；旧归属、尺寸和非法入参仍拒绝。按下键与触点由会话登记，rotate/release-all 共用内部释放；旋转成功或失败都无需 renderer 补发旧 KeyUp。renderer 清空移动 RAF，并丢弃跨暂停的 IME 组合。电源仍走独立停止链路。

回归先在旧实现失败：main 未丢弃全部输入、未释放旧键，真实 Canvas 与 hook 留下按下键，RAF 未取消，IME 恢复后提交旧文本。实现后相关 4 文件、35 项通过；全量 36 文件通过、2 文件跳过，共 428 项通过、5 项跳过。build（含 typecheck）、lint、变更文件 prettier、git diff --check 通过；为测试补类型后又跑 typecheck、对应 2 文件 21 项，均通过。全仓格式的既有资料问题仍见 [原 issue](../notes/issue/2026-10/2026-10-07-fixture-readme-format-baseline.md)。

新鲜 dev 加载成功，但当前 Pixel 8 API 32 在左侧启动后停留“启动中”，弹出 `Error invoking remote method 'devices:start': reply was never sent`；未生成该 AVD 的 qemu 子进程，无法继续本轮设备旋转与电源实测。原因尚未定位，见 [启动阻碍](../notes/issue/2026-10/2026-10-07-api32-start-smoke-blocked.md)。结束该 dev 并重新启动后，界面已恢复停止占位与左侧启动入口。未改 devices.json、SDK 或 AVD，既有外部 API 34 进程未动。前轮 API 34 实测仅作为历史结果，不替代本轮设备验收。

review 按八项检查单核对：释放逻辑无重复，权限/归属/尺寸守卫保留，rotating 覆盖释放与锁定的 await，finally 解除；新请求不进队列，主进程在写入前登记 Down；真实失败提示和电源流程沿用前轮实现，IME 与 RAF 回归覆盖恢复边界；无新增 IPC、依赖或越界源码。未发现本轮新增可确认的代码缺陷。启动阻碍只记录。

原 [按键 P2](../notes/issue/2026-10/2026-10-07-rotation-input-pause-review.md) 已关闭；[learn](../notes/learn/2026-10/2026-10-07-discard-rotation-input-and-release-keys.md)、PRD 与 stage04 补充当前语义，前轮 plan 保留历史并链接本次变更。未提交 git。

同日用户要求复现启动异常并写报告：普通 API 32 启动两次成功，受控 ADB 版本应答分段后断开则复现原 IPC 错误和取消失败，完整应答对照成功。已确认共用探测的既有缺陷，代码与 HEAD 一致；上次自然异常没有收包证据，具体触发仍未确认。仅调查与记录，完整证据和命令见 [问题报告](../notes/issue/2026-10/2026-10-07-api32-start-smoke-blocked.md)。
