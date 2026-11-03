---
description: 对账报告完整查看面板设计——主窗首个自绘弹层（BaseModal 原语 + 分组滚动明细），汇总条「查看详情」与摘要式原生通知双入口打开，原生长文本弹窗退役；关闭 issue 2026-10-12-reconcile-report-full-view
status: completed
created: 2026-10-12
---

# 对账报告完整查看面板 — plan

[stage05](../notes/summary/2026-10/2026-10-16-功能完善.md) 打磨批 / 用户方案 A 批复（2026-10-12）：超长对账明细此前由原生弹窗承载——无滚动、撑爆屏幕、按钮出屏（已加 40 行截断防线保可用性），完整性受损。本 plan 把**完整报告查看**改为应用内滚动面板，原生弹窗只留摘要提示；同时沉淀主窗第一个自绘弹层原语（BaseModal），供危险区确认词输入等后续家族复用。**关闭 [issue 2026-10-12-reconcile-report-full-view](../notes/issue/2026-10/2026-10-12-reconcile-report-full-view.md)。**

依据：[DESIGN.md](../../DESIGN.md)（直角、tokens、非模态倾向——本件为内容浏览型模态，Esc/遮罩可关）；[对账设计](../plans/2026-10-05-avd-reconciliation.md)（报告字段与汇总条契约）。

## Requirements brief — Step 0

### Background

对账（reconcile）结果有三条展示路径：列表上方常驻汇总条（`DeviceHealthNotice`，含「查看详情」）、后台异常的原生 dialog 提示、汇总条「查看详情」打开的原生长文本 dialog。第三条在异常多时不可用（截断防线后信息缺失）。报告数据通道 `devices:reconciliationReport` 已返回完整 `ReconcileReport`，只缺应用内渲染面。

### Scope

- Affects：主窗新组件（BaseModal 原语 + ReconcileReportModal）、`DeviceHealthNotice`「查看详情」改开面板、App 的 pendingNotification 通知改摘要式（原生 dialog 按钮「查看详情」→ 开面板）、mainWindow 域词条、App 域测试。
- Does NOT affect：main 侧对账逻辑与通道（`devices:reconciliationReport` 原样）；dialog 域 40 行截断防线（保留，服务其他弹窗）；危险区确认词自绘改造（只沉淀原语，不实施）；导出 txt（方案 B，不做）。
- Boundaries：面板只读（不带重新检查——汇总条已有该钮，避免双入口状态机）；打开时拉一次报告快照，不订阅后续刷新（重开即新）；Esc 与遮罩点击关闭（纯浏览无丢失风险）。

## Impact range — Phase 1

| 证据 | 现状 | 后果 |
| --- | --- | --- |
| [App.tsx:84-113](../../src/renderer/src/App.tsx) `buildDetailText` | 报告 → 逐行文本 → dialog detail | 拼行逻辑拆解为面板的分组渲染数据源 |
| [App.tsx:118-150](../../src/renderer/src/App.tsx) pendingNotification effect | 弹 `reconcileSummary` dialog；成功展示后登记 seen | 改摘要式（标题+计数+「查看详情/知道了」两按钮）；dialog.show 返回 response 可直接驱动开面板，无新通道 |
| [App.tsx:190](../../src/renderer/src/App.tsx) `handleViewDetail` | 长文本 dialog | 改为开面板（拉报告 → setState） |
| [DeviceHealthNotice.tsx:65](../../src/renderer/src/components/DeviceHealthNotice.tsx) | 「查看详情」→ onViewDetail → App | 回调签名不变，App 侧换实现——组件零改动 |
| [types.ts:202-218](../../src/shared/types.ts) `ReconcileReport` | 完整结构已过桥（storeHealth/deviceIssues/orphanEntries/unrecognizedCount/scanError/checkedAt） | renderer 直接分组渲染，无新通道 |
| 组件清单 | 主窗无 Modal/Portal 先例（仅 InstallDropOverlay） | 立首个 BaseModal 原语——focus 管理与关闭语义从此有单源 |

风险：弹层首次引入 focus trap / scroll lock 语义，做错会殃及后续家族——原语层控制在最小（遮罩、Esc、aria、滚动锁定）并配单测。

## Design — Phase 2

### 1. BaseModal 原语（components/BaseModal.tsx）

- 结构：全屏遮罩（`--board-veil`？无则半透明黑 40%）+ 居中面板（tokens：直角、`--board-bg-raised`、1px 发丝边）；内容区独立滚动。
- 关闭语义：Esc 键、遮罩点击（onClick 目标为遮罩自身才关）；关闭回调 `onClose` 必填。
- 可达性：`role="dialog"` `aria-modal="true"` `aria-labelledby`（标题 id）；打开时 focus 移入面板、关闭时还原触发元素 focus；Tab 循环最小实现（面板内首末 Tab 收口，不追求完整 trap——内容型弹层无表单）。
- body 滚动锁定：挂载时 `document.body.style.overflow='hidden'`，卸载还原（记原值）。
- 尺寸：width `min(560px, 92vw)`、height `min(480px, 84vh)`；窄窗不破。

### 2. ReconcileReportModal（components/ReconcileReportModal.tsx）

分组渲染 `ReconcileReport`（复用 buildDetailText 的分节顺序，改为结构化块）：

```text
┌ 设备对账详情                                    [×] ┐
│ 上次检查：2026-10-12 15:42（revision #217）        │
│ ── 元数据（storeHealth ≠ ok / issues 逐条）        │
│ ── 设备异常（每设备一组：名称 + 组件[镜像/AVD] + 说明）│
│ ── 孤立组（orphanEntries：id + detail，id 用 mono） │
│ ── 其他（未识别文件 N 项 / 扫描错误 / 暂缓判断设备） │
│ （滚动区，任意长度）                                 │
│                                        [关闭]      │
└────────────────────────────────────────────────────┘
```

- 空态：报告 null / 无异常 → 显示 `noAbnormalRecords`（现词条复用）。
- 打开即拉：`devices.reconciliationReport()` 一次；加载中一行占位；失败显示错误行 + 重试钮（与清单加载失败同口径）。
- 时不带「重新检查」（汇总条已有；重开面板即拿新报告）。

### 3. 交互流改造（App.tsx）

- `handleViewDetail`：setReportModalOpen(true)——面板自行拉数据。
- pendingNotification effect：dialog 文案改摘要式——`reconcileSummaryMessage` 改为「发现 {n} 类异常，左侧列表上方已常驻汇总。」；按钮 `[查看详情, 知道了]`，`response===0` → 开面板。seen 登记语义不变（成功展示后确认，失败/取消不压制重试）。
- 旧 `reconcileDetailTitle` 长文本弹窗路径删除（`buildDetailText` 迁移进面板后移除）。

### 4. 词条（mainWindow 域，三语）

新增约 8 键：面板标题（复用 reconcileDetailTitle）、分组标题 ×4（元数据/设备异常/孤立组/其他）、关闭、重新拉取（失败重试）、检查时间行、通知按钮「查看详情/知道了」。旧键清理：`reconcileSummaryMessage` 文案改摘要式（保留键改值）。

### 5. 文件清单

| 文件 | 工作 |
| --- | --- |
| `src/renderer/src/components/BaseModal.tsx`（新） | 弹层原语（遮罩/Esc/aria/focus 还原/滚动锁） |
| `src/renderer/src/components/ReconcileReportModal.tsx`（新） | 分组滚动明细 + 拉取/失败重试 |
| `src/renderer/src/App.tsx` | 开面板状态、handleViewDetail 换向、通知摘要式、删长文本路径 |
| `src/shared/i18n/mainWindow.ts` | 新键 ×3 语 + SummaryMessage 改值 |
| `DESIGN.md` | 弹层原语一节（首个自绘弹层的关闭/focus/尺寸约定） |

## Build order — Phase 3

1. BaseModal 原语 + 单测（Esc/遮罩关闭、aria、body 滚动锁、focus 还原）。
2. ReconcileReportModal 分组渲染 + 单测（mock 报告各分组、空态、失败重试）。
3. App 接线（查看详情/通知摘要式两入口、删旧路径）+ 集成测试。
4. 三语词条 + DESIGN.md；全量验证 + book 收尾（issue 关闭、stage 附注、索引）。

## Test plan — Phase 4

- BaseModal：Esc 关闭、遮罩点击关闭、面板内点击不关、aria-modal/labelledby、打开时 body overflow 锁定与卸载还原、关闭后焦点还原触发钮。
- ReconcileReportModal：各分组渲染（设备异常逐条、孤立组 mono、未识别计数）、无异常空态、报告拉取失败错误行 + 重试、长内容滚动区存在（120 条明细全渲染——回归锚：截断防线之前的完整信息量）。
- App 集成：汇总条「查看详情」开面板；通知 dialog 选「查看详情」开面板、选「知道了」不开且 seen 已登记；通知失败不登记 seen（原语义回归）。
- 全量：typecheck / lint / 全量测试 / build；既有 dialog 截断防线测试不动。

## Done criteria

任何长度的对账报告都能在应用内完整滚动查看（120 条明细全渲染有测试锚）；原生弹窗只剩摘要提示且按钮常在屏内；BaseModal 原语带单测可复用；三语齐、DESIGN.md 与 book（issue 关闭/stage/索引）同步；全绿。

## 待用户确认的设计轴

- [recommended — confirm or reject] 后台通知保留为**摘要式原生 dialog**（发现 N 类异常 + [查看详情][知道了]），而非完全去掉通知只靠汇总条——后台异常可能发生在用户未看列表时。
- [recommended — confirm or reject] 面板**只读**：不带「重新检查」（汇总条已有，重开面板即新报告）。
- [recommended — confirm or reject] Esc 与遮罩点击**都可关闭**（纯浏览无丢失风险）；Tab 收口做最小实现（无表单，不做完整 trap）。

## 实施记录 — 2026-10-12（四步完成，同日）

- 三设计轴批复后落地：BaseModal 原语（遮罩/Esc/aria/focus 还原/body 滚动锁，3 测试）→ ReconcileReportModal 分组滚动面板（加载/失败重试/空态，120 条明细全渲染回归锚，4 测试）→ App 接线（汇总条「查看详情」与摘要式通知 [查看详情/知道了] 双入口开面板，删长文本弹窗路径）→ mainWindow 域 7 新键 + SummaryMessage 摘要化 ×3 语 + DESIGN.md 弹层一节。
- 对账集成测试改写为摘要契约（无 detail、按钮组、选查看开面板并渲染明细）。
- 验证：1070 项测试全绿（+7）、typecheck/lint/build 通过。

## 追加（2026-10-12，用户约束：渲染层不要模态框）

应用内 BaseModal 面板实施当晚用户明确「渲染层不要模态框」——方案改**独立子窗口**：
- 新窗口域 `src/main/window/report.ts`（620×520 单例、已开聚焦、主窗关闭带走、就绪后崩溃释放单例——沿设置窗先例）+ 第五入口 `report.html` + `ReportApp`（原面板报告体去 BaseModal 壳）。
- App 双入口（汇总条查看详情 / 摘要通知选查看）改 `window.api.report.openWindow()`；BaseModal 原语与其测试**删除**（自绘弹层家族结论：本产品渲染层不引入模态，后续需求走子窗口或内嵌区）。
- 摘要式通知与在途互斥保留；dialog 40 行截断防线保留。
- 验证：1057 项全绿、typecheck/lint/build 通过。DESIGN.md 弹层一节改写为「窗口策略」。
