---
description: 设备列表出身过滤视图（方案 C）：一份事实源 + 随来源切换的视图谓词——默认只显示当前来源桶出身的设备，其余收进折叠区可展开，运行/过渡态设备永远豁免
status: in_progress
created: 2026-10-12
---

# 设备列表出身过滤视图（方案 C）— plan

设计阶段（Step 0 / Phase 1 / Phase 2）草案，**设计轴待批复，实现未开始**。来源：2026-10-12 交互讨论——用户提出「双份 devices.json 按来源切换」构想，分析后定为物理拆分成本大（运行设备消失、孤儿误报、清除保留根语义变重、avdHome 六处调用点时序耦合），改走**一份事实源 + 视图谓词**：过滤是纯视图行为，不删不改不迁移，任何启动判定零参与。

**前置依赖**：[plan 2026-10-12-device-list-source-aware](2026-10-12-device-list-source-aware.md)（出身标注 + 切来源重查 + 指路文案）已实现于 worktree 分支 `feature/device-list-source-aware`，**须先合入 dev**——本 plan 的过滤谓词、折叠区标注、汇总条口径全部建在 `imageSourceOrigin` 与重查链路之上。

依据：[stage05](../stage/05-功能完善.md) 步骤「SDK 来源设置」后续交互批、共享态向导收窄批（创建侧已按来源收窄，本 plan 补列表侧视图）。

## Requirements brief — Step 0

### Background

出身标注（`imageSourceOrigin`）已持久化在每个设备上，切来源后全量重查即时刷新可用性；但列表仍是全量平铺——共享态下托管出身设备带着「不可用 + 指路」标注挤在列表里。本 plan 给列表加一层**随来源切换的视图谓词**：默认只显示当前来源桶出身的设备（它们引用的镜像就在当前根里，理论全部可用），另一桶收进折叠区。用户原始表述「给每个模拟器加上来源，切换来源时自动更新列表」——前一半（标注）已交付，本 plan 补后一半的视图呈现。

### Scope

- Affects：`DeviceSnapshot`（顶层 `sourceBucket` 字段，主进程组快照时计算）、`deviceStore`（sourceBucket 切片）、`DeviceListPane`（过滤谓词 + 折叠区渲染）、`App`（汇总条口径，见轴 2）、i18n 三语、PRD 设备列表节一句扩容。
- Does NOT affect：devices.json 存储层（单份不变）、创建/删除/启动/停止流程、向导（收窄批已按来源收窄）、对账引擎与孤儿扫描（数据层零改动）、来源切换链路（sdkSourceSwitch 零改动）、设置窗、启动判定（出身零参与，同前批 Boundaries）。
- Boundaries：过滤纯视图——不删除、不隐藏运行事实、不产生任何写操作；**运行/过渡态（starting/running/stopping）设备永远豁免过滤**（跨桶运行设备必须可见可停，这是物理拆分方案致命坑的免疫条款）；出身与当前桶一致但文件异常的设备**仍然显示**（它属于这里，只是坏了）；过滤偏好为会话级，一期不持久化。

### Requirement

| 能力 | 要求 | 一期边界 |
| --- | --- | --- |
| 默认视图 | 当前来源桶出身的设备平铺显示；创建即落当前视图（出身=创建时来源，天然自洽） | 谓词：`origin === sourceBucket` |
| 折叠区 | 另一桶设备收进底部计数行（「另有 N 台项目自有设备」），点击展开/收起；展开后标注与指路文案照旧 | 一期两桶、一层折叠，不做多级分组 |
| 运行豁免 | starting/running/stopping 设备无视谓词永远可见可停 | 过渡态全豁免，不区分方向 |
| 来源感知 | renderer 经快照顶层 `sourceBucket` 知道当前桶；切换后经重查轮的新快照自然更新 | 不开新 IPC、不动 sdk 通道 sender 守卫 |

设计轴（**2026-10-12 全部批复**，用户按推荐项批准并附注「两边尽量做隔离就好」——折叠区展开后也**不与主列表混排**，以独立分区呈现在主列表下方，隔意见轴 1 实施形态）：

- [x] **轴 1 折叠区形态**：列表底部一行计数 + 点击展开/收起；展开后跨桶设备在**独立分区**呈现（不混排，分隔线区隔），带既有标注。
- [x] **轴 2 汇总条口径**：「N 台设备文件异常」只数当前视图（渲染层按可见集派生计数与名单）。
- [x] **轴 3 偏好持久化**：会话级默认「仅当前来源」，不持久化。
- [x] **轴 4 双根并存设备归属**：按出身静态归属视图（出身即归属，列表不因镜像分布跳变）。

## Impact range — Phase 1

### 现状证据

| 证据 | 当前事实 | 设计后果 |
| --- | --- | --- |
| `src/main/devices/index.ts:763` | `snapshotNow()` 组装 `DeviceSnapshot`；devices/index.ts 已 import `isSharedReadOnly`（出身批引入） | `sourceBucket` 一处计算，随既有快照通道自然到达 renderer，零新订阅零新 IPC |
| `src/shared/types.ts` DeviceSnapshot | `{ revision, devices, storeHealth, reconciliation }` | append `sourceBucket: 'app-owned' \| 'shared-studio'`；旧快照消费者（测试 mock）需补键 |
| `src/renderer/src/components/DeviceListPane.tsx` | 列表渲染入口（接收 devices 数组渲染 DeviceRow） | 过滤谓词与折叠区落此组件；App 无需改传参形状 |
| `src/main/emulator/sdkSourceSwitch.ts` | 来源切换广播 `sdk:source-changed` → 重查接线（出身批）→ 重查轮发布新快照（devices:reconcile 既有链路回带 summary） | `sourceBucket` 翻转随重查轮快照自然到达；boot 侧 `restoreSdkSource` 先于建窗，首帧即正确 |
| `src/renderer/src/App.tsx` DeviceHealthNotice 用法 | `affectedNames` 由 renderer 从 devices 数组派生 | 轴 2 的视图口径在 App 派生处加同一谓词，零主进程改动 |
| 出身批 `imageSourceOrigin` | 持久字段随 Device/DeviceMeta 流转；缺席回落 app-owned | 谓词读 `device.imageSourceOrigin ?? 'app-owned'`；老设备进「项目自有」视图 |
| 共享态向导收窄批 | 共享态创建只列 Studio 已装镜像；共享态建的设备出身 shared-studio | 创建即落当前视图（`origin === sourceBucket` 恒真），无「建完找不到」错位 |

影响图：

```text
sdkSourceSwitch 切换 ──► onSdkSourceChanged ──► reconcileDevices 重查轮
                                                      │ snapshotNow()
                     ┌────────────────────────────────┘
                     v
        DeviceSnapshot { sourceBucket, devices[·.imageSourceOrigin], reconciliation }
                     │ devices:changed / devices:list
                     v
        deviceStore.sourceBucket 切片
                     │
                     v
   DeviceListPane 谓词:  origin === sourceBucket ? 平铺
                         status ∈ {starting,running,stopping} ? 豁免
                         else ? 折叠区计数行（可展开）
                     │
                     v
   App 汇总条口径:  unavailable 数与名单按可见集派生（轴 2）
```

### 风险与处理

| 风险 | 本轮设计处理 |
| --- | --- |
| 跨桶运行设备被过滤后无法停止 | 过渡态全豁免是谓词硬条款（Boundaries）；测试专项覆盖「切来源时另一桶有 running 设备」 |
| 汇总条与折叠区信息打架（全量口径下报看不见的设备） | 轴 2 推荐视图口径：计数与名单按可见集派生；折叠行交代隐藏侧 |
| 双根并存设备被默认视图藏住但其实可启动 | 轴 4 接受此损失（出身即归属的一致性 > 少数派直达）；折叠区可见 + 展开后核验通过即可正常启动 |
| 切来源瞬间视图与数据短暂错位（sourceBucket 翻转先于重查完成） | sourceBucket 与 devices 同帧同快照到达，无中间态；重查期间过滤谓词已按新桶生效，标注随后补齐 |
| 快照消费者测试 mock 缺 sourceBucket 键连环挂（出身批同款教训） | 实现批先 grep 快照 mock 清单（learn 2026-10-12 §1 锚点法），逐文件补形状 |

## Design — Phase 2

### 1. 快照来源桶（types + 主进程）

`src/shared/types.ts` DeviceSnapshot append：

```ts
/** 组快照时的活动来源桶（renderer 过滤谓词依赖；与 devices 同帧到达） */
sourceBucket: 'app-owned' | 'shared-studio'
```

`snapshotNow()` 计算处：`sourceBucket: isSharedReadOnly() ? 'shared-studio' : 'app-owned'`。

### 2. renderer：store 切片与过滤谓词

- `deviceStore`：`sourceBucket` 从快照提取（初始 list 与每次 changed 覆写）。
- `DeviceListPane`：
  - `active = devices.filter(d => (d.imageSourceOrigin ?? 'app-owned') === sourceBucket || isTransient(d.status))`
  - `folded = 其余`；折叠行渲染 `format(copy.otherOriginDevices, { count })`，点击切换展开态（组件内 useState，会话级）。
  - 展开时跨桶设备原样渲染 DeviceRow（标注/指路/禁用启动来自出身批，零新逻辑）。

### 3. 汇总条口径（轴 2 批复后）

`App.tsx` 派生 affectedNames/计数处套同一可见集谓词（与 DeviceListPane 提取共享一个小工具函数，两处谓词单源）。主进程 reconciliation summary 零改动。

### 4. 文件清单（Phase 3）

| 文件 | 工作 |
| --- | --- |
| `src/shared/types.ts` | DeviceSnapshot.sourceBucket append |
| `src/main/devices/index.ts`（+ 测试） | snapshotNow 计算 sourceBucket |
| `src/renderer/src/stores/deviceStore.ts`（+ 测试） | sourceBucket 切片 |
| `src/renderer/src/components/DeviceListPane.tsx`（+ 测试） | 谓词、折叠区、豁免条款；与 App 共享谓词小工具（新文件 `originView.ts` 或组件内导出） |
| `src/renderer/src/App.tsx`（+ 测试） | 汇总条口径按可见集派生（轴 2） |
| `src/shared/i18n/mainWindow.ts` | `otherOriginDevices` 计数行、展开 aria 等 ≤3 键，三语 |
| `book/docs/PRD.md` | 设备列表节 AC 一句扩容 |
| `book/stage/05-功能完善.md` | 步骤附注挂本 plan 链接 |

### 5. 测试面（Phase 4）

- 主进程：snapshotNow 的 sourceBucket 三态（managed/custom → app-owned、shared-studio）。
- renderer：store 切片提取与覆写；DeviceListPane 默认过滤（本桶平铺/跨桶进折叠区/计数正确）、过渡态豁免（跨桶 running 可见可停）、折叠展开切换、缺席出身回落 app-owned 归属、空桶空态沿用；汇总条视图口径（若轴 2）。
- 回归：全量测试、typecheck、lint、build；出身批既有测试不动。

## Done criteria — 设计阶段

需求与排除项填实（存储层/对账引擎/切换链路明确不动，运行豁免为硬条款）；影响图与风险有代码证据（snapshotNow 单点、DeviceListPane 入口、App 派生处、重查轮快照回带）；四设计轴待批复；PRD/stage 挂链接列入实现批。

实现阶段终点（Phase 3–6 另行勾选），真机/模拟器验收清单：

1. 托管 2 台 + 共享建 1 台 → 切共享：列表只见共享那台，底部「另有 2 台项目自有设备」；展开可见且带指路标注。
2. 切回托管：反向成立；共享出身设备收进折叠区。
3. 跨桶运行豁免：共享态启动一台共享设备 → 切托管 → 该运行中设备仍可见、可停止。
4. 创建即落当前视图：共享态向导（已装镜像）建一台 → 立即出现在共享视图顶部。
5. 汇总条口径：共享态下隐藏的托管坏设备不进「N 台文件异常」计数（轴 2 批复后）；展开后计数随之可见化。
6. 三语正确；全量测试、typecheck / lint / build 通过。

## 实施记录 — 2026-10-12（worktree feature/device-list-source-aware 续作，批 1–6 完成，真机验收待做）

### Phase 3：实现

- `types.ts`：`DeviceSnapshot.sourceBucket`（必填，与 devices 同帧）；`snapshotNow()` 按 `isSharedReadOnly()` 计算——切来源后的重查轮快照自然翻转到新桶，boot 侧恢复先于首帧，无中间态。
- `deviceStore`：`sourceBucket` 切片，`apply` 内提取（`??` 回落当前值）。
- `originView.ts`（新）：`originOf`/`isTransientStatus`/`splitByOriginView` 谓词单源——DeviceListPane 与 App 汇总条口径共用。
- `DeviceListPane`：主分区（本桶 + 过渡态豁免）+ 底部折叠区（计数行展开/收起）；**展开后独立分区呈现不混排**（偏差 1）；行渲染抽 `rowHandlers` 复用。
- `App`：`affectedNames` 按可见集派生；`DeviceHealthNotice` 计数 prop 化（`unavailableCount`，不再直读 summary）；`BoardHead` 计数同切可见集（偏差 1）。
- i18n：`otherOriginOwned`/`otherOriginStudio` 两键三语（折叠行按当前桶选词；可见文本即无障碍名，`foldedSectionAria` 键在实现中删除）。

**偏差记录 1**：用户批复「两边尽量隔离就好」超出轴 1 原字面（"展开后混排"）——展开的折叠区改为独立分区（分隔线 + 浮起背景），`BoardHead` 设备计数一并切可见集口径（plan 未列，属隔离意图的延伸，review P3-A 记录）。

**偏差记录 2**：实施顺序调整——用户指示「不要合并，先在之前 worktree 修改」，dev 侧已做的合并回退（`reset --keep`，用户本地 PRODUCT.md/electron-builder.yml 改动保留），出身批与过滤视图批同留本分支，验收后统一合并。前置依赖（出身字段在分支上）因此自然满足。

### Phase 4：验证

- 新增测试 7 项：DeviceListPane 过滤/豁免/折叠展开 ×1、共享桶文案切换 ×1、缺席出身归属 ×1；deviceStore 切片覆写与缺席回落 ×2；主进程快照三态 ×1；DeviceHealthNotice 视图口径 ×1。快照 mock 缺键连锁按 learn 锚点法逐文件补齐（App.reconciliation/DeviceCanvas.actions/deviceStore）。
- 全量 **1123 项通过、6 项原有跳过**；typecheck 0 错；lint 0 告警；build 通过。
- 真机验收**未做**（上方清单 ①–⑥，与出身批 ①–⑦ 一并走查）。

### Phase 5：review（只记录不修）

- P3-A：BoardHead 计数切可见集属 plan 外延伸（偏差 1），若需要「库内总量」口径需另加展示位。
- P3-B：选中设备若落在折叠区（如选中所见设备后切来源），画布仍显示它但列表行不可见——一期接受；正常操作路径不会选中隐藏设备，展开可达。
- P3-C：汇总条的 visible 门（signature/orphanCount）与对账通知弹窗仍是全量真值——孤立目录与签名异常是「库的事」不受视图过滤，仅 unavailable 计数为视图口径；语义成立，记录备查。

### Phase 6：收尾

- PRD 设备列表节 AC 扩容；stage05 SDK 步骤附注；[learn](../notes/learn/2026-10/2026-10-12-freshdomain-resetmodules-stale-import.md) 补 zustand 单例泄漏条目。
- **Phase 5 code review（2026-10-12 合并前，只记录不修）**：结论总体 pass、无 P1——4 项 P2（跨桶运行设备查看配置回归 / 许可静默文本匹配契约 / 清除级联编排与计数通道零测试 / 级联计数时间窗）与 8 项 P3，[处置记录](../notes/issue/2026-10/2026-10-12-source-aware-filter-batch-review.md)。
- **review 修复批（用户批复「全部修复」，2026-10-12）**：P2 四项清零——跨桶运行设备恢复查看配置、confirmLicenses 布尔化（删文本匹配契约与词条）、级联编排下沉 clearRetainedWithCascade + 4 项域测、级联文案时点口径；计数通道薄透传降 P3 留置。全量 1136 项通过。
- **review P3 修复批（用户批复「全部修复」，2026-10-12）**：八项清零——口径单源 @shared/deviceOrigin、死字段注释、跨桶 stopped 禁启动（隔离语义决策，tooltip 通用化）、summary 增 scanError 防扫描失败被静默、三测试缺口补齐（折叠区集成/引导负路径/通知补漏）、测试复位 sourceBucket、监听器数组化+退订、rmTree 失败指引。全量 1139 项通过。review issue 全部发现清零关闭。
- 本 plan 保持 in_progress：验收清单 ①–⑥ 全过后翻 completed。

### 验收期修复批 — 2026-10-12（用户真机走查报障：切共享后出现只剩按钮的空警告条）

- **P3-C 空横幅**（原记录「语义成立备查」被实测推翻）：全量签名非空亮门 + 视图口径零行正文 → 只剩「重新检查/查看详情」两个按钮的空条。修复：可见门改跟内容走（`lines.length === 0` 即不渲染），折叠区内异常设备补计数行（`hiddenOriginUnavailable` 三语，App 由 folded 集派生 `hiddenAffectedCount` 传入）——不闷声吞信息也不说看不见的话。新增 2 项回归（空横幅不复现、计数行渲染），全量 **1125 项通过**、typecheck/lint/build 干净。
- 用户机器佐证：报障时「查看详情」报告窗正确显示被折叠设备的异常明细（全量真值在详情窗语义正确，维持）。
- **用户复核修订（同日）**：上条修复给折叠区异常留的计数行（「另有 N 台其他来源设备文件异常」）被用户判定为多余提示——**顶部异常判定只认当前来源桶**，另一侧完全静默。移除 hiddenAffectedCount 行与三语词条，明细仅走「查看详情」与折叠区展开后的行内提示；测试改为「另一侧异常 → 横幅整条不出」。全量 1126 项通过。
- **用户复核修订 5（同日，跨桶只读）**：另一来源桶的设备不允许被修改——UI 层 DeviceRow 增 `crossBucket`：编辑/删除钮禁用（tooltip「另一来源设备——切换来源后可修改」），重命名路径（双击/F2/Enter）走 `onCrossBucketBlocked` 弹说明框；**停止/取消启动不受限**（运行豁免条款的延伸——另一侧跑着的设备必须可停）。主进程双保险：`assertDeviceInCurrentBucket` 在 rename/delete/config-save（updateDeviceConfig）三入口拒绝跨桶写（禁用态可被伪造入参绕过，沿仓库双闸惯例）。新增 2 项测试（DeviceRow 跨桶禁用与运行豁免、域层服务端拒绝），全量 1129 项通过。
- **用户复核修订 2（同日，启动弹窗）**：汇总条静默后原生通知弹窗仍在启动期弹出——同一视图口径延伸到通知链：`reconcileAnomalyHiddenFromView`（模块级，读 store 现值）判定「可见集无设备异常 ∧ 无孤立组 ∧ 库健康」时，登记 seen 并**代为 ack**（main 侧签名不再待提示，重启不复发），不弹 dialog 不开报告窗；补漏分支同样守口径。库级异常/孤立组不属「另一桶」豁免，照常提示。新增 1 项测试（另一桶异常 → 无 dialog、ack 被调、报告窗不开），全量 1127 项通过。
