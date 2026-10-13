---
description: 纯机械拆分 src/main/scrcpy/index.ts（758 行 → 薄 index 装配 + 8 个域文件）；工厂闭包状态（sessions/active/deps）显式化为 ManagerContext 传参，公共契约（createScrcpyManager + 3 常量 + 2 类型）与行为零变化
status: completed
created: 2026-10-13
---

# scrcpy 域拆分（工厂闭包 → 薄 index + 域模块）— plan

沿用 [2026-10-13-main-devices-emulator-split](2026-10-13-main-devices-emulator-split.md) 的样板与验证门。与 devices 拆分的关键差异：devices 是模块级单例状态（解法 `state.ts` 访问器），scrcpy 是 `createScrcpyManager` 工厂——`sessions`/`active`/`deps` 是工厂闭包变量，被全部内嵌函数引用；解法是把闭包状态显式化为 `ManagerContext` 对象，域函数改为 `(ctx, ...)` 显式传参。

## Requirements brief — Step 0

### Background

`src/main/scrcpy/index.ts` 758 行，混合了类型与预算常量、管理器上下文助手、控制通道读写（writer 包装 + 读循环，~130 行）、剪贴板粘贴、发送与重同步、媒体包处理、会话生命周期编排、5 个 IPC handler 和 3 个真实进程工具。目录其余四个文件（cache/control/controlWriter/transport）已是域模块，index.ts 是唯一大文件。

### Scope

- Affects：仅 `src/main/scrcpy/` 的文件组织；index.ts 拆为装配层 + 8 个域文件；`book/docs/architecture/` 新增拆分快照。
- Does NOT affect：IPC 通道名与契约（`@shared/*` 不动）；运行行为/错误文案/日志；`cache.ts`/`control.ts`/`controlWriter.ts`/`transport.ts` 四个既有文件；renderer 对 `main/scrcpy/control` 的跨界引用（DeviceCanvas.input.test.tsx）；`__tests__/` 全部测试的 import 路径与断言。
- Boundaries：纯机械搬移 + 闭包显式化，不重构逻辑、不改错误路径语义、不顺手修发现的问题（记录到 issue）。

### Requirement

| 约束 | 要求 |
| --- | --- |
| 公共契约 | index.ts 继续从同一路径导出 `createScrcpyManager`、`MAX_UNACKED_PACKETS`、`MAX_UNACKED_BYTES`、`ACK_STALL_MS`、`ScrcpyManager`、`ScrcpyManagerDeps` |
| 消费方零改动 | `src/main/ipc/index.ts`、`__tests__/index.test.ts`（`createScrcpyManager` + `MAX_UNACKED_PACKETS`）、`__tests__/smoke.real.stream.test.ts`（`ScrcpyManager` 类型）import 路径全部不变 |
| mock 兼容 | 测试的 `vi.mock('electron')`/`vi.mock('../../emulator/adb')` 继续覆盖全部新文件（vi.mock 按模块 ID 全图生效） |
| 验证门 | `npm run typecheck && npm run lint && npm test` 全绿 |

## Design — Phase 2

### 目标结构（分层 DAG，禁止经 index 中转）

| 文件 | 约行数 | 内容（原 index.ts 行号） |
| --- | --- | --- |
| index.ts | 35 | createScrcpyManager 装配（建 ctx → 五个方法转发）+ re-export 公共符号 |
| types.ts | 100 | 预算常量（29-34）、ScrcpyManagerDeps（36-45）、SessionState/StreamSession（47-84）、ActiveView、ManagerContext、ScrcpyManager（86-92） |
| proc.ts | 45 | runAdb、spawnProc、connectTcp（724-758，真实进程工具） |
| context.ts | 70 | createManagerContext：sessions/active 载体 + serverPathFor、mainWindowWebContents、viewTokenOf、buildState、sendState（95-124） |
| lifecycle.ts | 55 | cleanupSession、destroySession、destroyAll（490-517、561-564） |
| media.ts | 145 | sendPacket、sendResync（含预算助手 unackedBytes/overBudget）、handleMediaPacket（300-413） |
| controlChannel.ts | 140 | wrapWriter、startControlReader（126-253；控制通道 socket 读写） |
| clipboard.ts | 55 | clipboardPaste（255-296） |
| session.ts | 150 | runSession、ensureSession（415-488、519-559，会话编排） |
| ipc.ts | 150 | requireReadySession、registerIpc 5 handler（568-711） |

依赖方向（编译器兜底，出现环即分层错误）：

```text
types / proc（叶子：常量类型；进程工具）
   ↓
context（ManagerContext 工厂 + 状态推送）
   ↓
lifecycle（cleanup/destroy/destroyAll）
   ↓
media / controlChannel / clipboard（错误路径只向下调 destroySession）
   ↓
session（runSession/ensureSession 编排）
   ↓
ipc → index.ts（装配）
```

### 闭包显式化规则（机械改写约定）

- `ManagerContext = { deps, sessions, active, serverPathFor, mainWindowWebContents, viewTokenOf, buildState, sendState }`，`active` 是可变属性（原 `let active` 的赋值点：cleanupSession/destroyAll/screenActivate，全部改 `ctx.active = ...`）。
- 域函数签名一律 `(ctx: ManagerContext, 原参数...)`；函数体内 `deps` → `ctx.deps`、`sessions` → `ctx.sessions`、`active` → `ctx.active`、`sendState(s)` → `ctx.sendState(s)`、`viewTokenOf` → `ctx.viewTokenOf`、跨文件调用补 `ctx` 首参。函数体逐行保持原样（含注释）。
- `wrapWriter(transport)` 只依赖 transport，保持无 ctx 签名。
- 预算常量落 types.ts（出口契约的一部分），media/session 从 types 取用，index re-export。

### 风险

- `ctx.active?.deviceId === X` 后紧跟 `ctx.active.viewToken` 的可选链收窄在属性访问上比闭包 let 更易失效——typecheck 兜底，必要时局部 `const` 快照（等价改写）。
- import 顺序/format 由 lint --fix 兜底。

## 实施顺序

单批搬移（文件数少、DAG 已排死）：写 plan → 拆 8 文件 + 收薄 index → typecheck + lint + vitest（scrcpy 全部 + 全量回归）→ 收尾文档。

**实施结果（2026-10-13）**：一次到位。typecheck/lint 零错误（3 处 prettier 重排由 --fix 收敛）、1139 项测试全过与拆分前基线一致；index.ts 758 行 → 19 行装配 + 8 个域文件（41–156 行/文件）；`__tests__/` 与全部消费方零改动。

## Phase 5 review 记录

- [x] 只记录不修复：见 `book/notes/issue/2026-10/2026-10-13-scrcpy-split-review.md`（ipc 入参文案 i18n 不一致、项目骨架.md 过期规划行，均先于拆分存在）。

## 收尾

- [x] 架构快照 `book/docs/architecture/2026-10-13-scrcpy-module-split.md`
- [x] learn：工厂闭包拆分与单例状态拆分的差异（context 传参 vs state.ts 访问器）
- [x] `npm run book:index` 刷新索引
