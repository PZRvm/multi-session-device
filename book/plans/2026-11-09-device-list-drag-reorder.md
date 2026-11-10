---
description: 左侧列表拖拽排序——AVD 主区与真机区行拖拽换序：AVD 走 devices:reorder 整单重排（数组序即持久化序，零 schema 变更），真机走 applyOrder 合并层 + external-order.json 偏好存储
status: completed
created: 2026-11-09
---

# 设备列表拖拽排序 — plan

设计阶段（Step 0 / Phase 1 / Phase 2）草案，**实现未开始**。来源：2026-11-09 可行性调研——AVD 侧是 PRD.md:51-52 既有要求（stage03 plan 记 deferred），真机侧是新增范围（PRD 真机节只有连接/断开/投屏）。手势与持久化模式取自 multi-session-browser 会话列表拖拽先例（纯原生 HTML5 DnD、零依赖、数组序即唯一持久化序，见其 `book/plans/20260918085931-会话列表拖拽排序开发计划.md`），两项目架构同构（Electron + zustand + 主进程快照广播），迁移成本集中在真机侧的顺序合并层。

口径批复（2026-11-09 用户确认推荐项）：① 真机区可拖、折叠区不可拖；② 真机顺序落盘 `external-order.json`（存 UI 偏好，非设备记录）；③ 断线真机条目序位保留、总量上限 64。

## Requirements brief — Step 0

### Background

左栏列表顺序 = devices.json 数组序 = 创建序（全链路无一处 sort，grep 验证）；真机列表顺序 = adb track 载荷行序，每帧重建。用户要拖拽整理两处列表；AVD 侧 PRD AC「排序与元数据重启后保留」，真机侧无既有口径，本 plan 补。

### Scope

- **Affects**：`DeviceListPane`（两区手势挂载、行属性传递）、`DeviceRow`（行根 draggable 与视觉属性）、新手势 hook、`deviceStore`/`externalStore` 各一个 reorder 动作、`ipc-channels` 两通道、主进程 devices 域 reorder 服务 + handler、`external.ts` applyList 合并层、新 `externalOrder` 偏好存储模块、preload devices api、PRD 真机节一句扩容。
- **Does NOT affect**：devices.json schema（v2 不动，不加 order 字段——数组序即排序，绕开 `projectV2Meta` 白名单投影）；创建/删除/重命名/启停链路（reorder 是独立命令）；折叠区与他桶设备（不可拖不可锚）；真机会话桥与无线域（order 与会话/代次无关）；对账引擎与 CAS（重排经 commitMetas 走既有保护）；日志窗（只被动跟随 `devices:external-changed`）；i18n UI 文案（拖拽零新界面文案，仅 errors.ts 加一个 `actionReorder` 错误键，三语）；依赖（不引拖拽库）。
- **Boundaries**：重排是纯视图结构操作，不改任何设备元数据字段；read-only 态 AVD 区禁拖（行级禁拖 + `assertMetaWritable` 服务端双闸，沿跨桶只读先例）；`external-order.json` 是对 external.ts:37「纯内存」注释边界的一次显式扩展——存的是用户偏好不是设备记录；无线 id = `ip:5555`，换网即新条目排尾部（adb 事实，不修）。

### Requirement

| 能力 | 要求 | 边界 |
| --- | --- | --- |
| AVD 主区拖拽 | 行拖拽换序，重启保留（devices.json 数组序即事实源） | 已提交设备整单重排；creating/deleting 过渡行不可拖不可锚 |
| 真机区拖拽 | 行拖拽换序，重启保留（external-order.json） | 任意状态可拖；断线条目序位保留、上限 64 裁剪 |
| 折叠区 | 不可拖不可锚 | 一期不做桶内排序 |
| 视觉 | 原生拖影 + 源行 0.45 透明 + 目标行 2px 插入线 | 灰阶、零动画、零新文案 |

## Impact range — Phase 1

### 现状证据

| 证据 | 当前事实 | 设计后果 |
| --- | --- | --- |
| `DeviceListPane.tsx:375,496` | 渲序 = 传入数组序，无 sort | 重排数组即重排列表，零排序逻辑可冲突 |
| `persistence.ts:77-78` | `metasEqual` 按位序深比较；外部重排 devices.json 判 metadata-changed 冻结 | 数组序是被 CAS 监控的状态，用户序天然受保护 |
| `create.ts:258-272` | rename 先例：`assertMetaWritable → commitMetas → broadcastChanged() → snapshotNow()` | reorder 服务照此形状，一条命令走完全链 |
| `deviceStore.ts:84-103` | apply 按 revision 幂等；runCommand 应答即应用 | reorder 应答快照回流无需新订阅 |
| `external.ts:259-284` | applyList 每帧从 track 载荷重建 cache（`sameDevices` 位序比较） | 用户序必须在 applyList 单写入口合并，否则被帧冲掉 |
| `external.ts:541-544` | `devicesExternalList` requireMain 守卫先例 | reorder 通道同守卫；广播本就发全部窗口 |
| `theme/store.ts` | 小偏好 JSON 先例：version + 损坏按缺省起步 + tmp/rename 原子写 + 串行队列 | externalOrder 照抄骨架 |
| `package.json` / 组件树 | 无拖拽库、无虚拟滚动；DeviceRow 根为 styled.div（`DeviceRow.tsx:416`），行尾按钮区已 stopPropagation | 原生 HTML5 DnD 直接可用 |

### 影响图

```text
AVD 链：
drop 合成已提交设备全序 ─► deviceStore.reorder（乐观换序 + invoke）
  ─► devices:reorder {ids} ─► requireSender('main') + isReorderInput
  ─► reorderDevices: assertMetaWritable → commitMetas(ids.map(byId))
  ─► devices.json 原子写 + bumpMetaRevision + broadcastChanged
  ─► devices:changed 快照回流（revision 守卫幂等）

真机链：
track 帧 ─► applyList: next = applyOrder(载荷解析, orderNow()) ─► 既有 diff/广播
drop 合成全序 ─► externalStore.reorder ─► devices:external-reorder {ids}
  ─► requireMain + ids 与 cache id 集相等校验 ─► cache 重排 + broadcast
  ─► persistOrder 尽力落盘（失败仅告警，会话序不回滚）
boot: loadExternalOrder() 先于 registerExternalIpc
```

### 风险与处理

| 风险 | 处理 |
| --- | --- |
| track 帧冲掉用户序 | applyList 单写入口合并层（本 plan 的唯一新机制） |
| 拖拽误触行内按钮/重命名输入框 | pointerdown 原点判定（`closest('input, button')` 内 cancel dragstart）+ renaming 态行禁拖；按钮区既有 stopPropagation 不动 |
| 陈旧全序覆盖并发增删 | 主进程整单集合校验拒绝（长度相等 + 无重复 + 全部已知），renderer 失败重拉收敛 |
| read-only 态发起拖拽 | 行级禁拖（metaWritable 门）+ `assertMetaWritable` 服务端拒绝双闸 |
| external-order.json 损坏 | 照 theme.json 先例按缺省起步，原文件不静默改写 |
| 无线死条目删除后 order 残留 | 条目保留无害，上限 64 自然收敛（对齐 EPOCHS_CAP 先例） |

## Design — Phase 2

### 1. 手势层：`useListDragReorder`（新，两列表共用）

`src/renderer/src/hooks/useListDragReorder.ts`。参数：`mime`（`application/x-msd-avd` / `application/x-msd-external`）、`rowAttr`（`data-avd-drag-id` / `data-external-drag-id`）、`items`（可拖宇宙全序：AVD = 已提交设备含折叠区设备，真机 = 全部行）、`canDrag(id)`（AVD：metaWritable）、`onReorder(ids)`。

语义（照 browser 先例）：

- 事件委托挂各列表容器（AVD `.origin-main`、真机 `.real-body`）；`pointerdown` 记手势原点，`dragstart` 时原点落在 `input, button` 内直接 `preventDefault()` 取消。
- `dataTransfer` 只写自定义 MIME + `effectAllowed = 'move'`；`dragover` 仅当**本容器发起**的拖拽（hook 本地 dragId 非空）才 `preventDefault()`——跨区拖拽与外部来源一律系统「不可投放」光标，两区天然隔离。
- hit 锚只认带 rowAttr 的行（过渡行/折叠区行无该属性即不可锚），按 `getBoundingClientRect()` 垂直中点分 before/after。
- drop 合成全序：源行移出按锚插回，零位移短路（不发 IPC）；`dragend` 无条件清瞬态（列表外释放/Esc 全覆盖）。
- 返回 `listHandlers` 与行视觉查询（源行/插入位）；行根 `draggable` 由调用方挂——DeviceRow：`draggable && !renaming`。

与 browser 先例的差异：browser 两 hook 刻意不抽象（哨兵行/过滤启用语义不同）；本两列表均为平铺无哨兵，抽一个参数化 hook。

### 2. AVD 重排链路

- `ipc-channels.ts`：`devicesReorder: 'devices:reorder'`（注释：整单重排，数组序即持久化序）。
- `environment.ts`：`isReorderInput`（ids 非空串数组、无重复）。
- 新 `src/main/devices/reorder.ts`：`reorderDevices(ids)` = `ensureLoaded()` → `assertMetaWritable(msg('actionReorder'))` → commitMetas 内集合校验（与 acceptedMetas 长度相等 + 全部已知，否则整单拒绝）→ `ids.map(id => byId.get(id))` 重排 → `broadcastChanged()` → `snapshotNow()`。
- `ipc.ts` handler：`requireSender(…, 'main')` + `isReorderInput` → `reorderDevices`。
- preload：`devicesApi.reorder(ids)`；`deviceStore.reorder(ids)`：零位移短路 → 乐观 set（对象引用原样移动，运行态保留）→ invoke → 成功 apply / 失败 `load()` 重拉，返回 ApiResult。
- `DeviceListPane`：hook items = `devices.filter(d => d.status !== 'creating' && d.status !== 'deleting')`（过渡行不在 acceptedMetas）；主区行传 `draggable`，折叠区行不传。

### 3. 真机重排链路

- 新 `src/main/devices/externalOrder.ts`（theme/store.ts 骨架）：`loadExternalOrder()`（boot 装配处调用，先于 `registerExternalIpc`）；`orderNow()`；`persistOrder(order)`（串行队列 + tmp/rename，失败 `console.warn` 不上抛——磁盘尽力，会话序不因此回滚）；`applyOrder(list, order)`（order 索引稳定排，未知条目按载荷序追加）；`EXTERNAL_ORDER_CAP = 64`（present 条目恒保留 + 记忆中缺席条目按原相对序续接，超限丢尾部）。
- `external.ts`：applyList 首行改 `const next = applyOrder(toExternalDevices(parseTrackDevices(payload)), orderNow())`——diff/广播/会话桥零改动；`registerExternalIpc` 增 `devicesExternalReorder` handler：requireMain + ids 与 cache id 集相等校验 → cache 按 ids 重排 → 内存 order = ids + 原记忆缺席条目 → broadcast → `persistOrder` 尽力 → 返回 cache。
- preload：`devicesApi.reorderExternal(ids)`；`externalStore.reorder(ids)`：乐观 set devices → invoke → `apply(响应)` / 失败 `listExternal()` 重拉。

### 4. 视觉

DeviceRow `Wrapper`（DeviceRow.tsx:416）与 DeviceListPane 的 `.external-row` 样式块各加三件：`&[draggable='true'] { user-select: none }`（renaming 行不设 draggable 即天然可编辑）、`&.drag-source { opacity: 0.45 }`、`&[data-drop-pos='before']::before` / `['after']::after` 2px 插入线（沿用行分隔线墨色 token，绝对定位不推挤行、`pointer-events: none`）。灰阶零动画，排序是纯结构操作不进主题强调色。

### 5. 文件清单（Phase 3）

| 文件 | 工作 |
| --- | --- |
| `src/shared/ipc-channels.ts` | devicesReorder / devicesExternalReorder 两通道 |
| `src/main/devices/environment.ts`（+测试） | isReorderInput |
| `src/main/devices/reorder.ts`（新，+测试） | reorderDevices 服务 |
| `src/main/devices/ipc.ts` | reorder handler |
| `src/main/devices/externalOrder.ts`（新，+测试） | 偏好存储 + applyOrder |
| `src/main/devices/external.ts`（+测试） | applyList 合并层 + reorder handler |
| `src/main/ipc/index.ts` | registerExternalIpc（194 行）前 loadExternalOrder |
| `src/shared/i18n/errors.ts` | actionReorder 键，三语 |
| `src/renderer/src/hooks/useListDragReorder.ts`（新，+测试） | 手势层 |
| `src/renderer/src/components/DeviceListPane.tsx`（+测试） | 两区挂接、行属性 |
| `src/renderer/src/components/DeviceRow.tsx`（+测试） | draggable 与视觉属性 |
| `src/renderer/src/stores/deviceStore.ts` / `externalStore.ts`（+测试） | reorder 动作 |
| `src/preload/api/devices.ts` | reorder / reorderExternal |
| `book/docs/PRD.md` | 真机节补排序 AC 一句 |

## Build order

1. `externalOrder` 模块 + `applyOrder` 单测（已知序/未知追加/载荷序稳定/上限）。
2. `external.ts` 合并层 + reorder handler + 单测（track 帧不冲用户序、重连首帧同、断线保留、广播载荷序）。
3. `reorder.ts` + ipc handler + 单测（校验矩阵、落盘数组序、revision+1、read-only 拒绝）。
4. 手势 hook + DeviceListPane/DeviceRow 挂接 + 组件测试。
5. 两个 store reorder 动作 + 测试（乐观路径、失败重拉收敛）。
6. preload + 视觉样式。
7. 全量回归 + PRD 补句 + book 同步（summary/learn/index）。

每步验证：步骤内新增测试绿 + 既有全量不红再进下一步。

## Test plan

- **主进程**：reorder 校验矩阵（重复/未知/缺项整单拒绝；合法重排落盘且 devices.json 数组序 = user 序；revision 自增；read-only 拒绝）；externalOrder 读写往返、损坏回落、上限裁剪；applyList 集成（帧到达保持用户序、状态翻转不冲序）；external reorder handler（id 集不等拒绝、成功重排 + 广播）。
- **renderer**：hook 手势（原点在按钮/输入内取消；drop 合成全序、折叠区设备相对位置不变；零位移不调 IPC；dragend 清理）；DeviceRow renaming 态不可拖、read-only 行禁拖；两 store reorder 乐观与失败路径。
- **回归**：全量测试、typecheck、lint、build。

## Done criteria

1. 全量测试、typecheck、lint、build 通过；无断言削弱。
2. 真机验收：① AVD 拖 3 台换序 → 重启保留；② 真机拖序 → 重启保留；③ 拖拽不误触行内按钮；④ 重命名中的行不触发拖拽；⑤ read-only 态行不可拖；⑥ 折叠区与过渡行不可拖不可锚；⑦ 真机拔插后其余设备序位不变、重插回原位；⑧ unauthorized↔device 状态翻转不冲顺序。
3. Phase 5/6 只记录不修；summary/learn 落 `book/notes/`；`npm run book:index` 通过。

## 实施记录 — 2026-11-09（worktree feature/device-list-drag-reorder，Build 1–7 完成，真机验收待做）

### Phase 3：实现

- **externalOrder**（新 `src/main/devices/externalOrder.ts`）：theme/store.ts 骨架（load 即清零重读 / 损坏按缺省起步 / tmp+rename / 落盘串行队列、失败告警不回滚）；`applyOrder` 纯函数稳定合并；`ensureOrderLoaded` memoized 读盘门。
- **external.ts**：applyList 首行合并层（`applyOrder(载荷, orderNow())`）；`devicesExternalReorder` handler（requireMain + 整单校验 + 断线条目保留合成新序 + broadcast）；注册尾 `ensureOrderLoaded().then(openSocket)`。
- **AVD 链**：`reorder.ts`（新，照 renameDevice 形状：ensureLoaded → assertMetaWritable → commitMetas 内整单校验重排 → broadcastChanged → snapshotNow）；ipc handler（requireSender 'main' + isReorderInput）；`errors.ts` actionReorder 三语；`ipc-channels` 两通道。
- **renderer**：`useListDragReorder`（新，事件委托 + pointerdown 原点取消 + 自定义 MIME + 中点锚定 + 零位移短路 + dragend 清态）；DeviceRow/ExternalRow 行根挂 `data-*-drag-id`/`draggable`/`data-drop-pos`/`drag-source`；DeviceListPane 双实例挂接（AVD 可拖宇宙 = 已提交设备含折叠区，过渡行不挂标识；真机区全状态可拖）；两 store reorder（乐观引用移动 + 失败重拉）；preload 两方法；App 传参。
- **视觉**：DeviceRow Wrapper 与 `.external-row` 各加 `position: relative` + 禁选字/0.45 半透明/2px 墨级插入线三件，灰阶零动画零新 UI 文案。

**偏差记录 1**：文件清单的「`src/main/ipc/index.ts` 装配先行」未按原文落地——改为 `ensureOrderLoaded` memoized 门挂 `registerExternalIpc` 尾（首连前读盘），比"装配处先调"更强：无论装配顺序如何首帧合并必有用户序，且 ipc/index.ts 零改动。

**偏差记录 2**：i18n 实际改动为 errors.ts 一个错误键 `actionReorder`（三语，read-only 拒绝文案用），与简报"仅 errors.ts 加一个错误键"一致；UI 文案零新增，视觉三件无文本。

### Phase 4：验证

- 新增测试 33 项：externalOrder 12（读写往返/损坏回落/上限/串行/applyOrder 矩阵）+ external 域 6（载荷与整单校验/合法重排/帧不冲序/状态翻转/断线保留重插回位）+ AVD 域 5（合法重排 revision+1/陈旧全序拒绝不断队列/read-only/非主窗）+ 手势 hook 7（MIME 与源行/原点取消/canDrag/外来源放行/before-after 合成/零位移/源行消失）+ 挂接 5（标识矩阵/折叠区展开也不挂/read-only 行/真机行/两条 drop 链）+ DeviceRow 重命名禁拖 1 + store 5（AVD 乐观-失败-pending 跳过、真机乐观-失败）。
- 既有改动：external.test 注册通道数 9→10（新增 reorder 通道）。
- 全量 **1683 通过 / 8 原有跳过 / 0 失败**；typecheck 双侧 0 错；lint 0 告警；build 通过。
- 真机验收**未做**（上方清单 ①–⑧）。

### Phase 5：review（2026-11-09 合并前，只记录不修）

结论总体 pass、无 P1——1 项 P2（陈旧拖拽态下外来源拖放可被接受且无效 drop 不拦 Electron 默认导航）+ 4 项 P3（瞬态滞留诱因根 / reorder 失败重拉失败时无提示 / 删除在途整单拒绝行弹回 / 档位边界核对），[处置记录](../notes/issue/2026-11/2026-11-09-device-list-drag-reorder-review.md)。

### review 修复批（78ef1ce，2026-11-09）

P2-A 清零 + P3-B 诱因根同批处理：dragover MIME 根闸 + drop 无条件拦默认导航 + dragover 自愈；新增 2 项回归，全量 1685 通过。P3 三项留置 open（reorder 失败提示 / deleting 在途弹回 / 档位边界），见 issue 文件。

### Phase 6：收尾

- **2026-11-09 用户真机验收通过**：Done criteria 清单 ①–⑧ 走查通过（AVD/真机重启保留、不误触按钮、重命名行不拖、read-only 禁拖、折叠区与过渡行不可锚、拔插回原位、状态翻转不冲序）。本 plan 翻 completed，随修复批一并合并 dev。

### review 修复批 2（c4590b0，2026-11-09——用户批复修复 review 遗留项）

P3-B/C/D 清零：deleting 行纳入重排宇宙（仍不可拖不可锚，删除在途拖拽不再弹回）；非空列表读取失败横条（重拉也失败时给原因与重试，零新词条）；rowVisual 读取时对 ids 对账（拖拽外删除不留瞬态滞留；effect 方案被 react-hooks/set-state-in-effect 拦下改读取时守卫）。新增 3 项回归，全量 1688 通过。P3-E（档位备忘）按原裁定留置 open。
