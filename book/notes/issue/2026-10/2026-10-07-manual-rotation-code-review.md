---
status: resolved
description: 旋转 review 的两项 P2 已修复；电源按用户要求改为停止模拟器并只从左侧启动
tags: [review, scrcpy, rotation, race, input, error]
---

# 手动旋转修复 code review

范围：2026-10-07 当前未提交的旋转修复，生产修改为 src/main/scrcpy/control.ts、index.ts，相关测试为同级 `__tests__/control.test.ts`、`index.test.ts`。依据 [plan](../../../plans/2026-10-07-manual-screen-rotation.md) 和八项 review 检查单。只记录，不修改源码或正式测试。

## P2 — 等待锁定期间的新触点没有在旋转前释放

- 位置：[control.ts:230](../../../../src/main/scrcpy/control.ts)，结合 index.ts 的 screen:input handler。原触点释放发生在 await lockRotation 之前；等待 adb 的期间没有旋转中守卫，其他 touch 请求仍可通过归属和尺寸校验。
- 复现：让 runAdb 的锁定 Promise 暂停，提交 rotate；锁定期间向同一会话提交 touch down；完成锁定。真实控制序列化器写出的消息为 `touch:0 → type:11`（Down → Rotate），中间没有 Up。断言要求 Down → Up → Rotate，失败。
- 影响：手动旋转等待最长 10 秒，用户此时开始的新手势会带着按下触点跨越方向变化；违背旋转前释放触点的约定，手势可能中断或在变更后的坐标中继续。后续 renderer 的 generation 清理不能补齐“旋转前释放”的顺序。
- 建议：旋转期间拒绝/暂停新触摸，或锁定完成后复核并释放当前触点，再发送 Rotate；正式回归补锁定等待期间的新 Down。若使用会话队列，确保等待期间切设备/停机后的取消仍有效。

## P2 — 新增的锁定失败不会显示给用户

- 位置：[index.ts:567](../../../../src/main/scrcpy/index.ts) 新增错误分支；调用端 [DeviceCanvas.ts:122](../../../../src/renderer/src/components/DeviceCanvas.tsx) 的 sendInput 把所有 reject 变为 undefined。工具条旋转不经过 useDeviceInput 的 onInputError。
- 复现：真实 DeviceCanvas 和 DeviceToolbar 组件挂载，screen.input 返回 `锁定屏幕旋转失败：permission denied` 的拒绝；点击“旋转屏幕”。请求确实发出，但 DOM 中无该错误信息，测试断言失败。
- 影响：新增的 adb 进程错误、锁定失败和超时会使按钮无动作也无原因；现有 main 回归只能证明 Promise 拒绝，不能证明用户收到诊断。catch 是既有实现，此次增加必需的 adb 操作和错误分支后仍沿用了静默路径。
- 建议：旋转的真实失败接入现有 showInputError；切换视图/停机产生的预期过期拒绝可单独静默。补工具条失败呈现的组件回归。

## 另记既有 P2 — 电源按钮被输入守卫拒绝

- 位置：[control.ts:88](../../../../src/main/scrcpy/control.ts)。BUTTON_KEYCODE_MAP 特意排除 power，但 validateInputRequest 的 button 分支只允许该 map 的键；后面的 power 注入分支因此不可达。
- 证据：合法归属、尺寸加 `{ kind: 'button', button: 'power' }` 返回 null，要求非空的临时断言失败。git show HEAD:src/main/scrcpy/control.ts 核对同一逻辑已经在提交版本中，不能归因于本次修复。
- 影响：工具条电源点击被 main 拒绝，且同样会被 renderer 静默吞掉。
- 建议：单独修复按钮闭集验证，增加 power 通过与未知按钮拒绝的测试。
- 原先拟验证“旋转结束覆盖并发电源状态”时，请求先被此守卫挡住，因此该电源交错风险没有成为本次新增缺陷。

## 验证与其余核对

- 正式相关测试复跑：2 文件、26 项通过；源文件未修改，未重新跑前轮已通过的全量 413 项。
- 临时探针复用了现有 fake transport、真实 writer 和真实组件，触点顺序、错误呈现、power 守卫三项断言失败。探针运行后删除，未留入正式测试或工作树。
- serial 来自已绑定会话，adb 参数以数组传递，端点环境仍经 scrubAdbEnv；未新增任意命令或 renderer 参数注入面。
- 锁定完成后会话删除、abort、视图 token 和 generation 的守卫成立；已有测试覆盖切换为无活动视图与停机。
- 手动旋转关闭 Android 自动旋转已在 plan 和用户说明中写明，属于已披露行为。前轮 API 34 设置页横竖各保持 10 秒的实测仍有效，此次没有重启用户模拟器。
- 全仓格式检查的既有资料问题已有 [独立 issue](2026-10-07-fixture-readme-format-baseline.md)，不重复计入新增代码缺陷。

结论：本次修复有两项 P2 待处理；另有一项既有 P2 单独记录。未发现本轮新增 P0/P1、依赖变化或越界源码修改。

## 2026-10-07 后续处理

用户授权修复前两项 P2，并明确电源关机应停止模拟器，只从左侧再次启动。两项旋转缺陷已修复：会话 rotating 守卫阻止等待期间的新触点和重复旋转；renderer 暂停输入并呈现当前归属的失败。正式回归覆盖锁定成功/失败、可继续操作、旧代次和旧设备失败静默。

电源不再作为 screen.input 的 button：独立调用 App.handleStop，沿用 devices.stop/runner 的进程回收和 stopped 快照；删除不可达的屏状态切换。关机后的占位、重复点击保护、左侧重新启动及停止失败提示都有组件回归。上述三项记录均已关闭，方案与完整验收见 [plan](../../../plans/2026-10-07-rotation-review-and-power-stop.md)。
