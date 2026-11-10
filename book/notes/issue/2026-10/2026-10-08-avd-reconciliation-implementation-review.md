---
status: open
description: 持久化对账实现轮的自查记录——三项观察（重扫放弃时 availability 陈旧、root 环境下 EACCES 用例降级、弹窗前关窗会重弹一次），均按只记录不修复处理
created: 2026-10-08
---

# 对账实现轮自查记录

> 前两项 P3 的维持原案/缓解状态已并入 [待修问题清单](../../task/2026-10-09-待修问题清单.md)追踪；本文仅作证据存档。

分支 `feat/avd-reconciliation`，基线为同分支实现完成态（全量 502 项通过、typecheck/lint/build 通过）。以下为 Phase 5 自查发现，按工作流纪律**只记录，不顺手修**。

## P3 — 高频事务下人工重查可能连续放弃

- **观察**：`performReconcile` 的扫描在 `metaRevision`/`avdEpoch` 变化时整轮重查（上限 3 次），仍变化则保留旧 availability 并置 `scanError` 提示「请再次重新检查」。create/delete 收尾会自动触发后台重查，事务极高频时人工重查窗口内代次可能一直在变。
- **影响**：用户手动点「重新检查」偶发拿到 scanError（需要再点一次）；availability 停留在上一轮结果，行内提示可能短暂陈旧，但不会误报 missing/valid 之外的破坏性结论。
- **建议方向**：把「重查受影响目标」细化为按 id 增量合并（plan 设计 3 的字面语义），或把后台收尾重查合并进进行中的人工重查代次。

## P3 — EACCES 类用例在 root/特权环境下降级

- **观察**：`store.test.ts` 与 `reconcile.test.ts` 用 `chmod 000` 触发 EACCES；root 运行时 chmod 不生效，用例写成「生效则严格断言，否则仅断言不冒充空库/missing」。errno 分类的纯函数（`classifyReadError`）已单独直测。
- **影响**：容器/CI 以 root 跑测试时权限路径的覆盖是弱断言。
- **建议方向**：权限语义改为注入 `readFile`/`readdir` 依赖的确定性错误，不依赖真实 chmod。

## P3 — 弹窗展示前关闭主窗，重开后会再弹一次同签名汇总

- **观察**：提示流程是 renderer 弹 dialog 成功后才 `acknowledge`；窗口在 dialog 展示前被关闭则 main 侧 `pendingNotification` 仍为 true，主窗重开重新拉报告再弹一次（本窗 seen 集合随窗口销毁丢弃）。
- **影响**：同签名最多多弹一次；不影响 ack 后的静默（`acknowledgedSignature` 在 main 进程内存）。
- **建议方向**：main 在 dialog 请求发出（而非确认）时先记 `notifiedSignature`，确认只负责消费；需要区分「已提示未确认」两态。
