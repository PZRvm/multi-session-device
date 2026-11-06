---
status: resolved
description: store v2 已保护坏 JSON 和未知版本，IO 错误、坏条目过滤及副作用前守卫仍缺，后续写入可能丢失原记录
---

# 设备库读取失败被当作正常空库

> 开放项已并入 [待修问题清单](../../task/2026-10-09-待修问题清单.md)追踪；本文仅作证据存档。

- **观察**：2026-10-05 对账设计时静态检查 `src/main/store.ts`：文件读取 catch 无条件返回 `[]`，JSON 解析失败或顶层 devices 非数组也返回 `[]`；version 未校验，坏条目直接过滤。`devices.ensureLoaded` 随后把结果当作正常已加载库，create/rename/delete 没有读取健康状态守卫。
- **复现条件**：原 `devices.json` 存在但 JSON 损坏，或首次读取遇到可恢复 IO/权限错误时，list 显示空库。若之后写入权限恢复并发起创建，`writeDeviceMetas` 会用新列表替换原文件。此路径由代码确认，本会话未对真实设备库执行破坏性复现。
- **影响**：用户无法区分首次启动与读库失败；后续写操作可能覆盖原记录。坏条目被过滤后也可能在下一次写入中永久丢失。与既有 [内存/磁盘落盘分叉](2026-10-03-devices-persist-failure-divergence.md) 不同，本问题发生在读取与解释阶段。
- **建议方向**：只有 ENOENT 可视为空库；损坏、未知版本、坏条目及 IO 错误返回结构化诊断并冻结元数据写入，原文件保留，人工重新检查成功后解除。详见 [对账设计草案](../../../plans/2026-10-05-avd-reconciliation.md)。stage 对账步骤仍 suggested，本次仅记录，未修复。

严重级：P2（读取失败后继续写入可能丢失原设备记录）。

## 跟进（2026-10-08）——部分保护已实现，剩余问题仍在

基线 `dev a32374e`，本次为对账草案更新做静态核查，未改源码、未操作实际设备库。

- **已实现**：store 写入版本为 v2，显式兼容 v1 派生；坏 JSON、缺 devices 数组、未知版本会设置模块级 writeProtection，`writeDeviceMetas` 拒绝覆盖。已有 store 测试覆盖坏 JSON/未知版本保护和 v1 备份，不应再表述为这些路径毫无保护。
- **仍缺读取诊断**：readFile 的 catch 仍无条件返回 `[]`，不区分 ENOENT 与 EACCES/EIO；v1/v2 坏条目仍直接过滤，不检查重复 id，v2 未完整校验嵌套设置等字段。顶层 `null` 会在访问 parsed.devices 时抛错，尚无受控健康结果和写保护。正常读取没有生产解除保护入口；resetStoreProtection 只供测试。
- **仍缺界面错误态**：devices 首载只得到数组，renderer 首次 list 失败也仅置 loaded=true；损坏文件的空数组或读失败仍可能显示为普通空库，无法从列表区分故障。
- **仍缺副作用前守卫**：create 可先创建/patch AVD，再在 JSON 提交时被写保护拒绝并进入回滚；delete 可先停止并删除 AVD，再被 JSON 写保护拒绝。保护了 JSON 不等于已经保护所有设备数据。

后续按 [更新后的对账草案](../../../plans/2026-10-05-avd-reconciliation.md) 补齐 typed 读取、条目诊断、受控重查恢复及 create/delete 前置保护。本问题未整体关闭；本轮只补记录。
