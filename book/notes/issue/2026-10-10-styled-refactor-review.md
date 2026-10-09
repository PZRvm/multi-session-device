---
description: styled 单 Wrapper 重排过程中发现的既有问题——发丝线隐式 DOM 契约、选中态状态点对比度、重复 CSS 与死钩子等（只记录，未修复）
tags: [styled-components, 债务, review]
---

# styled 重排 review 发现（只记录，未修复）

**范围**：refactor/styled-single-wrapper 执行期间由各重排 agent 记录的既有问题。均为重构前已存在的行为，按「只记录不修复」纪律原样保留。

## 待修（小）

1. **发丝线隐式 DOM 契约**——DeviceListPane 的 `.list > div + div` 相邻选择器依赖 DeviceRow 根元素是 `div`；DeviceRow 根标签一旦更换，列表发丝线静默消失。建议改为 DeviceRow 自带上边框或走显式类。
2. **选中态状态点对比度**——DeviceRow 选中（aria-current 反白为 accent 背景）时 StatusDot 仍用原状态色（如 `var(--idle)`），在 accent 背景上对比度可能偏低。原有行为，重构时未改。
3. **重复 CSS**——CanvasPlaceholder 的 `.action-label` 与 `.new-label` 两条规则逐字节相同，可合并为一个类。
4. **死钩子**——ImageTable 的 status-cell 挂着 `num` class，但文件内无 `.num` 规则（旧网格迁移残留）。

## 修复记录

2026-10-10 用户裁决修复「待修（小）」全部 4 项（提交见 git log）：发丝线选择器改 `& > * + *`（按相邻子元素分隔，不再依赖 DeviceRow 根标签）；选中态状态点改 `--accent-ink` + 0.85 不透明度（与文字行同口径，原状态色在 accent 背景上对比 2.6–3:1，改后约 9:1）；action-label / new-label 合并为一条组合选择器（两个语义类名保留在 DOM 上）；status-cell 的死 `num` 钩子移除。备查 5–9 维持原状。805 测试全绿、typecheck / lint / prettier 零错。

## 备查（无需行动）

5. SettingsForm 的 `select()` helper 非禁用时也渲染空 `<p class="hint">`（margin:0 无视觉影响，DOM 有空节点）；cameraSelect 硬编码 `<option value="emulated">` 又在 options 里 filter 掉。
6. DeviceListPane 的 retry-link 是无显式 `type` 的 button（不在 form 内，无行为影响）。
7. ProfilePage 的 `onShowDeprecatedChange` 是死 prop（组件注释已说明等官方源提供弃用信号后接入——有意为之）。
8. DeviceCanvas `.overlay` 的 `pointer-events: auto` 冗余（无祖先禁用指针事件）。
9. App.tsx 的 `loadError` 选择器声明位置远离其他 store 选择器分组，hook 位置合法但可读性差。
