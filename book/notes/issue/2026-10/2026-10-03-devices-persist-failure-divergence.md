---
description: devices 变更先改内存再落盘，写盘失败时内存与磁盘分叉且 renderer 无感知——零部分成功在该路径不成立
---

# devices 落盘失败时内存/磁盘分叉

- **Observed**: 2026-10-03 stage 03 Phase 5 review 发现：create/rename/delete 三个 handler 都是「先改内存 `devices` → `persistMetas()` → 广播」的顺序。`writeDeviceMetas` 抛错（磁盘满、权限等）时 handler 整体 reject：renderer 收不到 changed、命令返回 error 不动镜像，但主进程内存里这次变更已经发生。结果三份状态两两分叉：内存≠磁盘≠renderer，重启后内存变更凭空回滚，用户只看到一条报错。
- **Reproduction**: 手工让 `userData/` 只读后新建设备——handler 报错，此后 list 返回的内存列表仍含新设备，重启后消失。
- **Suggested direction**: 「写盘成功才改内存」或「写盘失败时回滚内存变更」二选一；tmp+rename 原子写只保证单文件不写半截，不保证内存/磁盘一致性。stage 04 接真实 AVD 前值得统一处理（届时还有 AVD 目录自身的对账语义）。

严重级：P3（dev 环境几乎不触发；数据一致性语义问题，修法涉及 handler 结构，不顺手修）。

## 跟进（2026-10-05）——已修

stage 04 步骤 4（commit 7099076）按「写盘成功才改内存」收口：`commitMetas` 先把 draft 落盘，成功后才重建内存并保留运行态字段；全局 `writeQueue` 串行提交，单次失败不断队列。失败路径处理齐全——rename 失败 renderer 收 invoke 拒绝并弹「重命名失败」，create 失败撤回临时行并回滚 AVD，delete 失败回 stopped + `delete-failed` 可重试（`deleteAvd` 对目录缺失幂等）。测试在案：create/rename 失败腿原有，本批（plan 2026-10-05-device-store-issue-batch）补删除腿「delete：AVD 已删但写盘失败 → 保留 delete-failed；写盘恢复后队列仍可用」。
