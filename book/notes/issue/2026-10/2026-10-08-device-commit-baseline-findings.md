---
description: commitMetas 会投影其他创建中的临时行并遗漏 startedAt，可能留下无 AVD 记录及跳过 Quick 停止核验
created: 2026-10-08
---

# 元数据提交中的临时行与运行字段遗漏

基线 `dev a32374e`。更新 [对账草案](../../../plans/2026-10-05-avd-reconciliation.md) 时静态核查 `src/main/devices/index.ts`；以下为代码推导，未用实际设备复现，本轮未修复。

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
