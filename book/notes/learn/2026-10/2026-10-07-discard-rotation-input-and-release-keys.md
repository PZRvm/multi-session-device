---
description: 丢弃旋转期间的新输入时，main 必须释放旧键；renderer 清掉移动 RAF 和跨暂停 IME
tags: [scrcpy, rotation, keyboard, input, raf, ime]
---

# 暂停新输入，也要释放旧输入

旋转暂停时，renderer 的 send 守卫会阻止 release-all，却仍清空按下键登记；后续松键也找不到登记，Android 收不到配对 Up。用户要求禁用期间完全不执行新输入，清理应由 main 内部完成。

- main 在首次 await 前标记 rotating，先释放已接受的旧键和触点，再锁定方向；期间所有合法 screen.input 直接结束。保留权限、归属、尺寸和入参校验。
- Down 在写控制通道前登记，待写入的旧 Down 也能被旋转清理看到。键盘与工具条用同一配对逻辑，rotate/release-all 共用释放函数。
- renderer 清空按下状态时，也取消移动 RAF、清空移动集合。跨暂停的 IME 组合以及禁用期间开始的组合都标记丢弃，恢复后的 compositionend 不提交旧文本；新组合仍可输入。
- 回归使用真实 Canvas、真实输入 hook 和控制注入；只 mock hook 的 enabled 参数无法发现旧键未释放。main 使用真实 writer 覆盖每个输入种类，在旋转成功与失败后检查无补发且可继续操作。

本规则丢弃旋转开始后到达的新请求，不撤销已写入设备的历史文本。实现、验证和设备验收限制见 [plan](../../../plans/2026-10-07-discard-input-during-rotation.md)。
