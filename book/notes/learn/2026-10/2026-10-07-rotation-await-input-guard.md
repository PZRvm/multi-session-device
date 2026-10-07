---
description: 异步旋转须在首次 await 前阻止新触点；失败提示须按信封副本核对当前归属
tags: [scrcpy, rotation, race, input, silent-fail, react]
---

# 旋转的等待窗口也要守住输入

- 场景：旋转先释放触点，再等待 adb 锁定方向。临时探针提交等待期间的新 Down，控制序列只有 Down → Rotate，没有 Up；工具条的 catch 又吞掉锁定失败。
- 原因：释放现有触点只能处理当时的集合，异步等待给新手势留下窗口。只测试 main 的 reject 也不能证明 renderer 呈现了错误。
- 前轮做法：会话在首次 await 前登记 rotating，拒绝新 touch 和重复 rotate，仍允许 release-all；finally 在成功、失败或取消后解除。renderer 同时暂停画布和普通工具条，真实失败接入提示，电源停止保持可用。
- 归属：等待前复制 envelope，再按 deviceId/runId/streamId/generation/viewToken 与当前值核对；hook 会原地更新 generation，捕获原对象会把旧请求误认成新代次。卸载后的旧请求也不显示。
- 验证：main 使用真实 writer 检查 Down → Up → Rotate，组件补失败可见、代次原地变化和切设备后旧失败静默。关机复用 devices.stop，停止占位和左侧重新启动由 App/store 的真实组件回归覆盖。

实现与验收见 [plan](../../../plans/2026-10-07-rotation-review-and-power-stop.md)。

同日后续按用户要求收紧：旋转期间所有合法外部输入直接丢弃，由 main 内部释放旧触点和旧键。旧做法会让 renderer 清掉按下键登记后丢失 KeyUp，修复与 RAF/IME 丢弃规则见 [新 learn](2026-10-07-discard-rotation-input-and-release-keys.md)。
