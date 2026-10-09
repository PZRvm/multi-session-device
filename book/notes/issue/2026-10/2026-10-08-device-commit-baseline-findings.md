---
description: 创建临时行被无关提交持久化与 startedAt 遗漏均已修复，2026-10-09 关闭
status: resolved
created: 2026-10-08
---

# 元数据提交中的临时行与运行字段遗漏

基线 `dev a32374e`。更新 [对账草案](../../../plans/2026-10-05-avd-reconciliation.md) 时静态核查 `src/main/devices/index.ts`；以下为代码推导，未用实际设备复现，本轮未修复。

2026-10-09 复查：P2 用“创建 A 等待 → 保存 B → A 创建失败”的隔离测试确认仍存在；P3 已由 `rebuildDevices` 保留 `startedAt` 修复，相关回归通过。详见 [补充复查](2026-10-09-config-safety-followup-audit.md)。下文保留初次观察。

## P2 — 其他命令可能把创建中的临时行写进 JSON

- **观察**：createDeviceTransaction 在 await createAvd 前把 creating 行加入 devices；commitMetas 总以 `devices.map(toMeta)` 构造 draft，没有区分已提交元数据和创建临时行。创建失败时只撤回内存行并回滚 AVD，未撤回可能已被其他命令提交的 JSON 记录。
- **触发顺序**：A 创建进入 creating 并等待 avdmanager → B 的重命名/创建完成等触发 commitMetas，draft 包含 A → A 创建失败，撤回内存并回滚目录 → 重启后 JSON 仍可能含 A，实际 AVD 已不存在。
- **影响**：writeQueue 保证提交串行，不保证创建事务隔离；对账可报告缺失行，不能据此宣称事务已修复。
- **建议方向**：独立任务区分已提交元数据与 transient 行，各事务只提交自己完成的变化；用受控 deferred createAvd 与另一命令提交验证顺序，不操作用户 AVD。

## P3 — commitMetas 重建设备时丢失 startedAt

- **观察**：runtimeById 合并保留 frameKind/status/lastError/serial/runId，遗漏 startedAt。startDevice 设置 startedAt；stopDevice 仅在 Quick 且 startedAt 存在时核验快照。
- **触发顺序**：设备运行中 → 重命名自身或另一设备完成元数据提交 → 重建后的设备没有 startedAt → Quick 正常 stop 跳过 verifySnapshotSaved。
- **影响**：运行态字段被无关元数据写入改变；Quick 选择器目前保持禁用，此核验后果针对已有或测试中的 Quick 配置，未宣称正式开放路径已受损。
- **建议方向**：集中保留完整 runtime 字段；后续新增 availability 合并时同时防止这些字段丢失，补运行中提交→停止的回归锚。

## 2026-10-09 关闭

两项均已修复。P3 由 `rebuildDevices` 保留 `startedAt`（上文复查已记）。P2 随 [配置安全跟进修复](../../../plans/2026-10-09-config-safety-followup-fixes.md) 落地：`commitMetas`/`commitMetasWithConfig` 的写盘草稿基线改为最后接纳的元数据（`src/main/devices/index.ts` 的 `acceptedMetas`，671 行起有注释），创建中的临时行只在内存展示、不进 devices.json。回归在案：他设备提交不带创建临时行、创建失败后无幽灵记录（`src/main/devices/__tests__/index.test.ts:401`）。全量 689 项通过、6 项跳过，typecheck/lint/build 通过；详见 [补充复查](2026-10-09-config-safety-followup-audit.md) 修复收尾。上文复查是修复前的确认记录。
