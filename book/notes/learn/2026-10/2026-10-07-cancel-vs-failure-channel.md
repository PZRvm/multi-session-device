---
description: 用户主动取消要走可空返回值契约，不走错误通道——字符串匹配取消文案会碎，catch-all 会把取消当失败警示
tags: [ipc, contract, cancel, ux]
---

# 取消是契约不是错误

- 场景：向导里取消文件选择器、取消来源同意框，renderer 的 catch-all 把 main 抛的「已取消…」文案当失败置 skinError，红色 alert 噪声稀释真实失败。
- 原因：取消是用户意图的正常路径，语义上不是 error；用 throw 携带它，调用方只能靠匹配中文文案区分，一改文案就碎。
- 怎么用：IPC 返回类型带 null 哨兵（`DeviceSkinSummary | null`），null = 用户取消、静默早退；真实失败继续 throw 走错误通道。测试锚定行为差异（取消不解锁字段、不弹 alert），不锚定文案。
- 同族问题：错误包装时先看底层消息是否已含建议从句（含「请」），有就别再叠第二条——「请检查 A，请检查 B」读感是拼贴。两处都出自 [review P3 修复](../../../plans/2026-10-07-review-p3-fixes.md)。
