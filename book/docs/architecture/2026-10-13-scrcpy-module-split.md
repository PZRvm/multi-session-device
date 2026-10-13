---
description: scrcpy 域拆分快照——758 行工厂 index.ts 拆为 19 行装配 + 8 个域文件；闭包状态显式化为 ManagerContext 首参传递，分层 DAG 与错误路径向下调 destroySession 的规则
created: 2026-10-13
---

# scrcpy 域拆分（工厂闭包 → 薄 index + 域模块）

源码依据为 dev 的拆分提交（plan [2026-10-13-scrcpy-module-split](../../plans/2026-10-13-scrcpy-module-split.md)）。纯机械搬移 + 闭包显式化：IPC 契约、行为、文案、测试断言零变化，1139 项测试保持通过。与 [2026-10-13 main 模块拆分](2026-10-13-main-module-split.md) 的差异在于：devices/emulator 是模块级单例状态（`state.ts` 访问器），scrcpy 是 `createScrcpyManager` 工厂——状态挂在**每次调用创建的 `ManagerContext`** 上，域函数以 `(ctx, ...)` 显式传参。

## 目标布局（原 index.ts 758 行 → 19 行装配 + 8 文件）

```text
types / proc            →  预算常量 + 全部接口（含 ManagerContext）；runAdb/spawnProc/connectTcp 真实进程工具
        ↓
context                 →  createManagerContext：sessions/active 载体 + serverPathFor/状态推送助手
        ↓
lifecycle               →  cleanupSession/destroySession/destroyAll（幂等清理，active 清空点）
        ↓
media / controlChannel / clipboard   →  发送与重同步（GOP/预算/outbox）；控制通道 writer 包装+读循环；剪贴板粘贴
        ↓
session                 →  runSession/ensureSession 编排（建流、停滞检测、代次幂等）
        ↓
ipc → index.ts          →  5 个 handler（activate/retry/ack/input）；createScrcpyManager 装配 + re-export
```

规则（后续在 scrcpy 加东西沿用）：

- **`ctx.active` 是唯一跨域可变共享位**：写点仅 screenActivate（ipc.ts）、cleanupSession/destroyAll（lifecycle.ts）；其余地方只读。
- **错误路径一律向下调 `destroySession(ctx, ...)`**（lifecycle 层），中层模块（media/controlChannel/clipboard）不得互相 import——这是 DAG 不成环的关键。
- **wrapWriter/proc 工具不进 ctx**：只依赖入参的纯函数保持独立导出。

## 公共契约（消费方零改动）

`src/main/ipc/index.ts`（`createScrcpyManager`）、`__tests__/index.test.ts`（+`MAX_UNACKED_PACKETS`）、`__tests__/smoke.real.stream.test.ts`（`ScrcpyManager` 类型）import 路径不变；index.ts re-export 6 个符号（含 3 个预算常量）。renderer 侧 `DeviceCanvas.input.test.tsx` 跨界引用的 `main/scrcpy/control` 未动。

## 测试

`__tests__/` 零改动。mock（`vi.mock('electron')`、`vi.mock('../../emulator/adb')`）按模块 ID 对新文件全图生效；工厂语义反而比 devices 更稳——新文件里没有任何模块级可变状态，`import('../index')` 每次都是干净图。
