---
description: 修复无线恢复复审的三项 P2，补截图门、日志会话与诊断上下文回归，验证提交后合并 dev
status: completed
created: 2026-11-05
---

# 无线修复复审问题修复 — plan

依据：[复审 issue](../notes/issue/2026-11/2026-11-05-wireless-recovery-code-review.md)。用户明确要求修复这三项并合并进 dev，包含必要的提交与本地默认 merge；不推送、不清理 worktree。

## Requirements brief — Step 0

- Background：复审隔离复现三项 P2，当前工作树的功能与修复需一起形成可合并提交。
- Affects：截图二进制 ADB 执行器；日志会话创建；无线诊断上下文保留；相邻回归测试与 book 返写。
- Does NOT affect：USB 通用入口扩展、自动重启策略、单实例约束、SDK/设备持久化、依赖与已安装应用。
- Boundaries：不更改既有超时/取消语义；进程实际关闭后才减少截图在途计数；日志门拒绝发生在会话写入之前；诊断上下文沿用 32 项/10 分钟与关窗释放限制。
- Requirement：三项原复现场景转为失败回归测试，最小修复后通过；完整门禁通过，提交并在干净的 dev 检出执行默认 merge，合并后复验。

## Impact range — Phase 1

1. 截图独立 runAdbBinary 绕开普通 runAdb，因此必须单独接门和在途计数；不能直接换成 UTF-8 版命令执行器。
2. 日志 startSession 把锁内拒绝转成持久错误壳；将恢复门检查移到创建会话之前，保留真正 spawn 失败的原有处理。
3. 完成时 forget(owner) 会按完成顺序覆盖上下文；保留每个 attempt 至既有容量/TTL/关窗清理，无须新增请求代次协议。

## Design — Phase 2

- 截图：同步取得 adbRecovery.command 的完成回调；spawn 同步异常、error、close 均释放且幂等。超时/体积超限可以提前返回结果，在途计数保留到子进程真正 close。
- 日志：startSession 首行检查恢复门，拒绝时不创建 session；解锁后 restore/ensure/subscribe 可重新建会并恢复原订阅。
- 诊断：移除每次失败完成时按 owner 批量清理；forget(owner) 仍仅用于窗口销毁，TTL 与容量限制照旧。
- 权限/通知：沿用现有 sender、窗口绑定、原生确认和结果文案，无新 IPC。
- 合并：主仓库 dev 里仅有本会话先前生成的计划副本与索引，先按明确路径备份收起，保留副本，不触碰其他改动；最新文档随工作分支合入。

## Build order

- [x] Step 0 / Phase 1 / Phase 2：明确三项范围、根因与最小设计。
- [x] Phase 3：原代码上的 4 个失败断言覆盖三项 P2；三处最小修复后转绿。
- [x] Phase 4：相关 71 项通过，全仓 1597 项通过/6 项跳过；build/typecheck、lint、Prettier 通过。
- [x] Phase 5：复审三项最小修复和回归，未发现新增阻塞问题；评审后只写文档。
- [x] Phase 6：三项 issue 销账、summary/计划/索引返写；提交 c2469d5 已以 fast-forward 合并 dev，目标检出 typecheck/lint 与 book 检查通过。

## Test plan

- 门关闭时截图不 spawn；已有截图登记 pending；超时提前返回到 close 之间仍在途；error/同步 spawn 异常后不泄漏计数。
- 修复期间订阅日志被拒绝，解锁后相同 runId 的 restore/ensure/subscribe 成功；原订阅继续收到数据。
- 同窗口 A 慢 B 快完成时，A 不能使 B 的修复/复制失效；关窗仍能统一清理两个上下文。

## Done criteria

三项回归通过且原测试未削弱；修复 issue 销账、文档检查通过；工作树形成提交并本地合并 dev，dev typecheck/lint 复验通过；无远端推送。原功能未完成的专项人工验收仍单独记录，不据此宣称全部覆盖。

## 合并结果（2026-11-05）

功能及三项修复合成提交 `c2469d5`，从 feature/wireless-diagnostics-recovery 以默认 fast-forward 合并 dev，共并入 1 个实现提交。合并前 worktree typecheck/lint 通过，合并后主仓库 dev typecheck/lint 与 book:release-check 通过。此前完整构建与 1597 项通过/6 项跳过的测试证据保持有效，合并过程未改实现。

主仓库原有的三个本轮计划副本已按明确路径备份到 stash `0907e2c43ac88d3b96aa2b7f752b2fb3afdcb7e5`，最新版本随功能合入；备份未删除，不自动覆盖已合入的新文档。worktree 与分支保留，不推送远端。
