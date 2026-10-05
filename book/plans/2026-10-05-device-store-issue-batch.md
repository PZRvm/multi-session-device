---
description: 四个设备域 issue 的收口批次——三个已在 7099076 修掉待验证回写，键盘重命名本轮实现
status: draft
---

# 设备域 issue 批次收口 — plan

## Requirements brief

背景：2026-10-03 stage 03 Phase 5 review 记录了四个设备域 issue，用户要求修复。Phase 1 核对发现：**三个主进程 issue 已在 stage 04 步骤 4（commit 7099076，runner 接真）修复**，其中两个已有测试在案，但 issue 文件从未回写跟进记录；只有「行内重命名无键盘路径」完全没动。

现状核对明细：

| issue | 现状 | 本轮动作 |
| --- | --- | --- |
| 删除运行中设备不先停机 | 已修：`deleteFlow` 级联停机（starting→取消、running/stopping→停止、未停止不删）；确认框已明示「将先停止并等待退出」；停止失败腿有测试 | 补 happy path 测试 + 回写 |
| devices ensureLoaded 并发双读竞态 | 已修：`loadPromise` 单例（失败置 null 可重试） | 补回归测试 + 回写 |
| devices 落盘失败内存/磁盘分叉 | 已修：`commitMetas` 写盘成功才改内存 + 全局串行 writeQueue；create/rename 失败腿有测试；rename 失败 renderer 已有 alert | 补删除腿测试 + 回写 |
| 行内重命名无键盘路径 | 未修：唯一入口 onDoubleClick | **本轮实现** + 回写 |

作用域（本轮做什么）：

1. 实现 `DeviceRow` 键盘重命名（F2 + 选中态 Enter）
2. 补三个主进程 issue 缺失的回归测试
3. 四个 issue 文件全部回写跟进记录

明确不影响（排除项）：

- `src/main/devices/index.ts` 主进程逻辑**预期零改动**——修复已在位；若新测试暴露真实缺陷，停下记录并回报，不在本批顺手扩scope
- store 读写机制（tmp+rename 原子写）不动
- 删除确认文案与 UI 流程不动（已在位且正确）
- 持久化对账（stage 04 `[suggested]` 步骤）、`2026-10-05-device-store-read-error-as-empty.md` 等姊妹 issue 不在本批
- `book/stage/` 步骤不增不改——本批是 review issue 收口，不是 stage 步骤

## Impact range

受影响文件：

- `src/renderer/src/components/DeviceRow.tsx` — 行 keydown 加 F2 / 选中态 Enter 进重命名 + `aria-keyshortcuts`
- `src/renderer/src/components/__tests__/DeviceRow.test.tsx` — 键盘路径用例
- `src/main/devices/__tests__/index.test.ts` — 三条主进程回归用例
- `book/notes/issue/2026-10/` 四个 issue 文件 — 跟进记录
- `book/plans/2026-10-05-device-store-issue-batch.md` — 本 plan
- `book/README.md` — `book:index` 再生

数据流不变：devices 域维持「主进程单写者 + 快照广播」。

## Design

### 键盘重命名（issue 2，唯一代码改动）

现状：行 keydown 只处理 Enter/空格 → `onSelect`；重命名唯一入口是 `onDoubleClick`。

改法（两个平台惯例并取，均在 issue 建议方向内）：

- **F2**（Windows 惯例）：行聚焦时按 F2 进入重命名
- **选中态 Enter**（macOS Finder 惯例）：行已选中（`selected` prop 为真）时再按 Enter 进入重命名；未选中时 Enter 维持现语义（仅选中），空格不变
- 现有守卫复用：`startRename` 已挡 creating/deleting；行 keydown 首行已挡 `event.target instanceof HTMLInputElement`，重命名输入框自身的 Enter 不会串到行处理器
- a11y：行 Wrapper 加 `aria-keyshortcuts="F2"`。选中态 Enter 是次级惯例，不进 aria 清单——避免与「Enter 选中」的既有语义打架；键盘地图的完整梳理留给 stage 05

### 主进程回归测试（验证在位修复，不改动实现）

1. **issue 3 并发首载**：`readDeviceMetas` 返回受控延迟的 Promise，首载窗口内并发调两次 `devicesList` → `readDeviceMetas` 只调一次（`loadPromise` 单例的回归锚）
2. **issue 1 级联停机 happy path**：create → start → `onRunning` → delete → `runner.stop` 被调、`deleteAvd` 在停机之后、列表清空、落盘 metas 不含该 id。现有用例只覆盖停止失败腿（停止失败不删 AVD）
3. **issue 4 删除腿落盘失败**：`deleteAvd` 成功 + `writeDeviceMetas` 拒绝一次 → delete 抛错、设备保留且 `lastError.code === 'delete-failed'`；随后写盘恢复 → rename 成功（证明 writeQueue 单次失败不断队列）。create/rename 两腿已有用例在案

### issue 文件回写

仿 `2026-10-05-wizard-download-no-tick-guard.md` 的「跟进——已修」段式：四个文件各补 `## 跟进（2026-10-05）` 段，注明修复落点（7099076 或本批）与验证方式（测试名）。issue 2 的跟进段在实现合入后写。

## Build order

1. 主进程回归测试先行：`src/main/devices/__tests__/index.test.ts` 加三条用例 → `npm test` 全绿。**若红：在位修复有洞，停下回报，不改实现凑绿**
2. `DeviceRow` 键盘用例先行（红）→ 实现 keydown 改动（绿）
3. `npm run typecheck` + `npm run lint` 无新增问题
4. book 回写：四个 issue 跟进段、plan 状态翻 `completed` → `npm run book:index` → 提交

## Test plan

覆盖维度：

- 键盘路径：F2 进重命名（输入框出现、回填现名、自动聚焦）；选中态 Enter 进重命名；未选中 Enter 仅选中不进重命名；creating/deleting 下 F2 无效；重命名中输入框的 Enter 不触发行级语义
- 并发：首载窗口双 list 单读
- 级联：running 删除 → 先停后删、metas 落盘正确
- 失败路径：删除腿写盘失败 → 设备保留 + `delete-failed` + 队列存活可继续写
- 回归：既有全套测试不红

## Done criteria

- `npm test`、`npm run typecheck`、`npm run lint` 全绿，无断言削弱
- F2 与选中态 Enter 在 jsdom 用例中可发起重命名，`aria-keyshortcuts` 在位
- 四个 issue 文件各有跟进段；本 plan 翻 `completed`；`npm run book:index` 已跑；成果提交在 `fix/device-store-issues`
