---
description: 统一设备行加载图标与动作按钮的尺寸和中心，修复启动中、停止中图标错位
status: draft
created: 2026-10-05
---

# 设备行动作图标对齐 — plan

> 用户要求先创建计划。本轮完成 Step 0、Phase 1、Phase 2，未实施。关联 [stage04](../stage/04-模拟器对接.md) 启停验收；不改阶段概述或步骤。

## Requirements brief

用户截图 1 中，启动时的旋转图标与取消、删除图标不在同一水平中心。停止等待也需按同一标准处理。当前产品操作是「停止」，本项沿用现有状态机，不增加冻结模拟器的暂停能力。

- 作用域：`DeviceRow` 行尾动作区的布局、加载图标容器、动画与无障碍语义。
- 排除项：runner、IPC、启停时序、复制与删除业务、列表行整体重排、其他区域的加载动画。
- 边界：保留 14px 图标与 24×24px 动作槽位；加载标记不接受点击，不伪装成操作按钮。

验收要求：starting/stopping 的加载图标与相邻图标中心一致，旋转时不偏移；取消、停止重试、删除入口及禁用态保持当前行为；亮暗主题、选中和未选中行均清晰可见。

## Impact range

[DeviceRow.tsx](../../src/renderer/src/components/DeviceRow.tsx) 中，普通图标在 24×24px 的 `IconButton` 内居中，`BusyIcon` 则是直接放入 `Actions` 的 14px SVG；`Actions` 没有 `align-items: center`。两种承载尺寸不同，符合截图中的错位现象，最终需在实际窗口核验像素结果。

| 文件                                                       | 动作                                                           |
| ---------------------------------------------------------- | -------------------------------------------------------------- |
| `src/renderer/src/components/DeviceRow.tsx`                | 动作区交叉轴居中；加载图标增加同尺寸槽位；旋转仅作用于内部 SVG |
| `src/renderer/src/components/__tests__/DeviceRow.test.tsx` | 运行既有状态与操作回归；只在语义改变时补必要断言               |

风险：把尺寸直接加在旋转 SVG 上会混淆图标与槽位；用 disabled button 承载纯状态会增加无意义按钮；容器与 SVG 同时旋转会引入中心漂移。

## Design

数据流继续为 main 状态快照 → DeviceRow；本项没有新状态、共享类型或 IPC。

1. `Actions` 使用 inline-flex，并明确交叉轴居中。普通按钮及加载槽位均为 24×24px、不可收缩，间距仍为 2px。
2. 加载槽位使用非交互元素，内部 14px SVG 设为 block、居中；只旋转 SVG，旋转原点为自身中心。保留「启动中 + 设备名」「停止中 + 设备名」的可访问名称，槽位不进入 Tab 顺序。
3. 动画继续表达等待；`prefers-reduced-motion` 下保留静态状态标记与文字。
4. 实施时使用 impeccable 技能核验对齐；沿用现有主题 tokens、lucide-react、styled-components，不扩展全局按钮系统。

## Build order

1. 统一动作槽位与内部图标样式。验证：真实窗口 starting/stopping 的图标中心对齐，动画多个角度不漂移。
2. 回归启动、取消、停止重试、复制、删除与行选择；确认操作区不冒泡，纯状态不增加键盘焦点。
3. 执行相关 DeviceRow 测试、typecheck、lint 和改动文件格式检查；Phase 5 按 review 清单只记录发现，Phase 6 回写结果。

## Test plan

视觉样式以实际 Electron 截图验收，jsdom 不承担像素对齐证明。覆盖 starting/stopping × 亮/暗 × 选中/未选中，窄列表、长名称和停止错误副行；检查动画过程中每个槽位中心及行高稳定。

交互复用既有 DeviceRow 回归，不为尺寸常量新增镜像实现的测试。确认取消启动、重试停止只触发对应回调，删除在过渡态仍禁用，重命名与行选择不回归。

## Done criteria

本轮终点为可执行的 draft 计划。未来实施完成需真实窗口视觉与交互验收通过、相关检查通过、review 发现记录在案。若人已增加对应 stage 步骤，验证后勾选并附结果；无对应步骤时记录计划结果，不自行新增正式步骤。届时才将 plan 改为 completed，并运行 `npm run book:index`。
