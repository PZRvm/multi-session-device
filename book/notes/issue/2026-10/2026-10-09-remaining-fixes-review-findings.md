---
description: 五项修复 review 新发现：布局归零漏释放已有按下状态，控制写失败后关闭 parser 触发未观察 ACK rejection
status: open
priority: P2
tags: [review, device-canvas, input, scrcpy, clipboard, lifecycle]
---

# 五项修复的 review 留项

> 开放项已并入 [待修问题清单](../../task/2026-10-09-待修问题清单.md)追踪；本文仅作证据存档。

发现于 2026-10-09，范围为 [五项修复计划](../../../plans/2026-10-09-remaining-issue-fixes.md) 相对本轮开始时源码快照的改动。两项均在 review 阶段确认，按仓库工作流只记录，未继续修代码；原问题的正常路径已通过，完整计划保留 in_progress，等待独立修复与重新验收。

## P2：布局归零时已有按下状态漏释放

- 触发：画布可用时按住 Enter 或触点，再使容器尺寸变成 0，然后恢复并松开。
- 原因：DeviceCanvas 的新布局门控将 useDeviceInput.enabled 置 false；hook 先更新 enabledRef，随后 releaseAll 调 send，被 disabled 守卫拒绝。本地集合却被清空。布局变化不会触发 main 的旋转/代次释放，远端可能持续按下。
- 证据：临时组件测试运行生产组件和输入 hook：key-down → resize(0,0) → resize(600,800) → key-up，main 只收到一个 down，没有 release-all 或 up。现有零尺寸测试只验证新输入不发送，漏掉已按下状态。
- 建议：在原 envelope 仍有效时单独释放已接受的输入，再禁用新输入；保留旋转、切换和旧代次守卫。增加键盘及触点“按下→归零→恢复”回归，验收不补发禁用期间的新操作。

## P2：控制写失败后 ACK Promise 未被观察

- 触发：writer.setClipboard 已注册非零序列号 ACK resolver，但底层 socket.write callback 返回错误；随后 session cleanup 调 deviceMessageParsers.close()。
- 原因：已安装库先创建 ACK Promise，再 await write。write 失败使 setClipboard 提前 reject，没有等待 ACK Promise；parser close 再拒绝这个无人观察的 Promise，形成未处理 rejection。
- 证据：安装库原样对照，synthetic socket write failed 后不 close parser，只有既有 Consumable write 路径的 Error；close parser 后额外出现 unhandledRejection(undefined)，对应 ACK resolver。当前断开回归的 write callback 均已成功，因此未覆盖此窗口。库底层既有 write rejection 与本轮新增 ACK rejection 要分开归因。
- 建议：在 ACK 注册时保证拒绝已被消费，或使用能完整结算 ACK 与 write 的发送接缝；不能仅靠外层 catch。增加 socket.write callback 失败、失败后 close、停止和迟到 ACK 的回归，断言没有未处理 rejection，且 pending 与资源均清理。

## 复现与证据位置

本轮诊断目录：`/var/folders/r8/m81f7g6102x8s3fg8fjrpbv00000gn/T/msd-five-fixes-9_m7z6j9`。B3：`b3-release-evidence.test.tsx`、`b3-review-vitest.config.mjs`；B5：`b5-write-failure-evidence.mjs`，有/无 `--close-parsers` 对照。临时证据不入库；测试会创建自己的窗口或流，不操作用户 AVD。

八项 review 已检查正确性、权限、竞态、边界、兼容、资源清理、测试有效性和范围。B1、B2、B4 未发现新增明确缺陷；上述两项需要独立修复后再做最终关闭判断。
