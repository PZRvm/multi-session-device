---
description: 三项无线修复 P2 已修正，1597 项测试通过，c2469d5 已 fast-forward 合并 dev 且合并前后门禁通过
---

# 无线修复的三项并发问题已修正

## 背景

用户要求修复 [code review 的三项 P2](../../issue/2026-11/2026-11-05-wireless-recovery-code-review.md)，然后合并进 dev。USB 通用入口继续暂缓。

## 做了什么

截图二进制执行器接入恢复门与在途计数，覆盖 spawn 异常、error/close、超时提前返回的收尾。日志在创建会话壳前检查门，修复期间订阅不会污染解锁后的同 runId 会话。诊断 attempt 独立保留至 TTL/容量/关窗清理，旧请求晚完成不能删除新结果。

## 为什么这样选

保留截图的二进制通路和原来的超时结果；只移动日志检查位置，不改变真正 spawn 失败的处理；复用既有诊断容量和 TTL，避免增加跨进程请求代次协议。

## 结果

先加回归，原代码出现 4 个失败断言，覆盖三项 P2；修复后相关 71 项通过。最终全仓 1597 项通过、6 项跳过；build（含 typecheck）、lint、Prettier 通过。修复 diff 复审未发现新增阻塞问题，评审后未改实现。

## 后续

按 [修复计划](../../../plans/2026-11-05-wireless-recovery-review-fixes.md) 完成提交与本地合并：`c2469d5`，fast-forward 并入 dev 的 1 个实现提交，合并前后 typecheck/lint 通过，book 检查通过。worktree/分支与原始文档备份保留，未 push。原功能的正式签名权限、TLS 真机及其他专项人工验收仍保留在独立 issue，不扩展解释为本轮已验证。
