---
description: 设备列表出身过滤视图（方案 C）：一份事实源 + 随来源切换的视图谓词——默认只显示当前来源桶出身的设备，其余收进折叠区可展开，运行/过渡态设备永远豁免
status: draft
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

设计轴（**待批复**，▪ 为推荐项）：

- [ ] **轴 1 折叠区形态**：▪ 列表底部一行计数 + 点击展开/收起（展开后跨桶设备混排显示、带既有标注）；备选：仅计数行不可展开（信息不全）。
- [ ] **轴 2 汇总条口径**：▪ 「N 台设备文件异常」只数当前视图（渲染层按可见集派生计数与名单）——避免共享态下汇总条报一排看不见的设备；备选：维持全量口径（与折叠行信息重复且误导）。
- [ ] **轴 3 偏好持久化**：▪ 会话级默认「仅当前来源」，不持久化（一期最简）；备选：localStorage 记住「显示全部」选择。
- [ ] **轴 4 双根并存设备归属**：▪ 按出身静态归属视图（出身即归属，列表不因镜像分布跳变；跨根可启动的少数派经折叠区可见）；备选：按可启动性动态归属（谓词需实时核验结果参与，列表随重查跳变）。

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
