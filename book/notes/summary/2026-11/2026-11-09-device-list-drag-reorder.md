---
description: 左侧列表拖拽排序交付——AVD 主区与真机区行拖拽换序；AVD 走 devices:reorder 整单重排（数组序即持久化序），真机走 applyOrder 合并层 + external-order.json；手势零依赖照 multi-session-browser 先例
---

# 设备列表拖拽排序

## 背景

左栏列表顺序此前不可变：AVD 序 = devices.json 数组序 = 创建序，真机序 = adb track 载荷行序（每帧重建）。PRD 51-52 行本就要求拖拽排序（stage03 记 deferred），真机区排序是本轮新增范围。方案取自 multi-session-browser 会话列表拖拽先例（原生 HTML5 DnD、零依赖、数组序即唯一持久化序），两项目架构同构，成本集中在真机侧的顺序合并层。可行性调研与 M 档 plan 见 [plan 2026-11-09](../../../plans/2026-11-09-device-list-drag-reorder.md)。

## 改动

- **AVD 链**：新 `devices:reorder` IPC（`src/main/devices/reorder.ts`，照 renameDevice 形状：`assertMetaWritable` → `commitMetas` 内整单校验重排 → `broadcastChanged`）；devices.json 零 schema 变更——数组序即排序，天然受既有 CAS 保护；新设备仍追加尾部。
- **真机链**：新 `external-order.json` 偏好存储（`externalOrder.ts`，theme store 骨架；断线条目保留 + 上限 64 对齐 EPOCHS_CAP 先例）；`applyList` 单写入口加 `applyOrder` 稳定合并层——track 帧、插拔、状态翻转永不覆盖用户序，断线重插回原位；新 `devices:external-reorder` handler 整单校验换序；`ensureOrderLoaded` 门保证首帧合并前用户序已就绪。
- **手势层**：`useListDragReorder`（两列表共用参数化 hook）：事件委托挂容器、行根挂 `data-*-drag-id`；点击/拖拽靠原生位移阈值消歧；按钮/输入上发起的拖拽按 pointerdown 原点取消；外来源/跨区一律系统「不可投放」；drop 合成完整全序（折叠区设备相对位不变）、零位移不 IPC。折叠区与他桶行、creating/deleting 过渡行不可拖不可锚；read-only 行级禁拖 + 主进程 `assertMetaWritable` 双闸。
- **视觉**：源行 0.45 透明 + 目标行 2px 墨级插入线 + 可拖行禁选字，灰阶零动画零新 UI 文案（仅 errors.ts 加 `actionReorder` 三语错误键）。

## 结果

- 新增测试 33 项，全量 **1683 通过 / 8 原有跳过 / 0 失败**；typecheck 双侧、lint（0 告警门）、build 全绿。
- 两处实现偏差记录在 plan 实施记录（读盘门改挂 registerExternalIpc 首连前，强于原设计的装配处调用；见偏差记录 1）。
- 真机验收清单 ①–⑧（plan Done criteria）**未走查**——重启保留、拔插回原位、状态翻转不冲序等需真机环境确认，验收后翻 plan completed。

## 后续

- 2026-11-09 用户真机验收通过（①–⑧），plan 翻 completed。
- Phase 5 review：总体 pass 无 P1；P2 一项（外来源拖放可被陈旧拖拽态误接受）随修复批 78ef1ce 清零，P3-B/C/D 随修复批 2（c4590b0）清零，P3-E（档位备忘）按裁定留置（[issue 记录](../../../notes/issue/2026-11/2026-11-09-device-list-drag-reorder-review.md)）。合并 dev。
