---
description: 向导窗创建按钮无创建中禁用/防连击——双击可建出两台同名设备，stage 04 真实创建变慢后会被放大
status: resolved
---

> 2026-10-12 核销（fix/issue-audit 批）：DeviceWizard 已有 creatingRef/downloadingRef 同步防连击守卫（冒烟实测同 tick 双击拦截）。
# 向导创建按钮无防连击

- **Observed**: 2026-10-04 优化轮 Phase 5 review 发现：`DeviceWizard` 的「创建」按钮点击后不进入禁用态，`WizardApp.handleCreate` 是异步 IPC——连点两下会在窗口关闭前发出两次 `devices:create`，建出两台同名设备（id 不同）。stage 03 mock 下 IPC 瞬回影响小；stage 04 接真实 avdmanager 创建（秒级~十秒级）后会放大成重复建 AVD。
- **Reproduction**: 向导第三步连点「创建」两次 → 列表出现两台同名设备。
- **Suggested direction**: 创建中置 `creating` 状态禁用按钮（最简）；或 main 侧对 create 做节流/幂等键。前者属组件内 3 行改动，建议 stage 04 前顺手轮处理。

严重级：P3（现 mock）/ stage 04 升 P2（真实创建慢 + 不可逆磁盘开销）。

## 跟进（2026-10-04）——已修

按建议方向落地并加了一层：`DeviceWizard` 防连击三层——`creatingRef`（同步守卫，关键层）+ 按钮 `disabled` + `creating` state（视觉层）。**冒烟抓到 state-only 方案的穿透**：同一 tick 内两次原生 click（React 批处理不刷新闭包 state）实测同毫秒建了两台设备；ref 跨批处理时序立即可见，修复后同 tick 连点实测仅建 1 台。回归测试 2 条：跨 tick 连点（fireEvent）与同 tick 原生连点（单 act 内两次 `.click()`）。onCreate 签名放宽为 `void | Promise<void>`。
