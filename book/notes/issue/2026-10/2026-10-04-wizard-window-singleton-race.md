---
description: openWizardWindow 单例判断无互斥——极窄窗口内两次 wizard:open 可开两扇模态窗且第一扇引用被覆盖
---

# 向导窗单例 open 竞态

- **Observed**: 2026-10-04 优化轮 Phase 5 review 发现：`main/window/wizard.ts` 的 `openWizardWindow` 用模块级 `wizardWindow` 引用做单例判断，无互斥。同一次事件循环内（如程序化连发）两个 `wizard:open` 都会看到引用为空并各自建窗，第二扇覆盖引用，第一扇变成无主窗口（仍随父窗销毁，但不再受「重复点击=聚焦」治理）。
- **Reproduction**: 与 ensureLoaded 竞态同类，单窗口 + 人手速下窗口趋近于零；理论路径为程序化并发调用。
- **Suggested direction**: 与 `devices` 域的 ensureLoaded 一并处理——单例 promise / 简单 mutex 家族化收口（见 2026-10-03-devices-ensure-loaded-concurrent-double-read）。

严重级：P3（人手触发几乎不可能；与 ensureLoaded 同族，建议同轮修）。

## 跟进（2026-10-04）——已修

按建议方向落地：`openWizardWindow` 增 `opening` 互斥标记——已存在则 focus、正在开（new 与 ready-to-show 之间）则静默返回（窗随本轮一起 show+focus）；`ready-to-show` 与 `closed` 双点复位（加载失败无 ready-to-show 时靠关闭兜底解锁）。同族的 devices 域 ensureLoaded 竞态（2026-10-03 条目）仍挂账，留待 stage 04 一并家族化收口。
