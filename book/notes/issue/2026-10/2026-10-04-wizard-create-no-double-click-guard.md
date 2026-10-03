---
description: 向导窗创建按钮无创建中禁用/防连击——双击可建出两台同名设备，stage 04 真实创建变慢后会被放大
---

# 向导创建按钮无防连击

- **Observed**: 2026-10-04 优化轮 Phase 5 review 发现：`DeviceWizard` 的「创建」按钮点击后不进入禁用态，`WizardApp.handleCreate` 是异步 IPC——连点两下会在窗口关闭前发出两次 `devices:create`，建出两台同名设备（id 不同）。stage 03 mock 下 IPC 瞬回影响小；stage 04 接真实 avdmanager 创建（秒级~十秒级）后会放大成重复建 AVD。
- **Reproduction**: 向导第三步连点「创建」两次 → 列表出现两台同名设备。
- **Suggested direction**: 创建中置 `creating` 状态禁用按钮（最简）；或 main 侧对 create 做节流/幂等键。前者属组件内 3 行改动，建议 stage 04 前顺手轮处理。

严重级：P3（现 mock）/ stage 04 升 P2（真实创建慢 + 不可逆磁盘开销）。
