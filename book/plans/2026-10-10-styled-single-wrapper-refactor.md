---
description: 渲染层 styled-components 全量重排——每文件只留一个 Wrapper，内部元素改 className 后代选择器，视觉零变化
status: in_progress
created: 2026-10-10
---

# styled-components 单 Wrapper 化（全局重排） — plan

依据：[coding-style 样式条款](../guidelines/coding-style.md)（2026-10-10 当日补细）、[workflow](../guidelines/workflow.md)。

## Requirements brief — Step 0

### Background

[coding-style](../guidelines/coding-style.md) 早有「每个组件只建最外层一个 Wrapper，不建第二个 styled」的条款，但没写内部元素该怎么落笔，结果大面积走样：23 个用 styled 的文件共 170 个定义，其中 15 个文件违规（最多的 `DeviceWizard.tsx` 一个文件 25 个）。内部元素各自成 styled 的代价：模板与样式分离（一个按钮的样式离它的 JSX 三百行远）、`$` 前缀 prop 逐层传染（`Subtitle`、`ErrorLine`、`HealthLine`、`NoticeLine` 全都带 `$selected`）、`EmptyHint`、`IconButton`、spin 动画这类小样式在多个文件重复定义。

规范条款已于 2026-10-10 补细：内部元素用原生标签 + `className`，样式写进 Wrapper 的类选择器后代。本计划把存量代码搬到这个写法上。

### Scope

- Affects：`src/renderer/src/` 下 15 个违规文件（`App.tsx` 与 `components/` 内 14 个）的样式层；`styled(Input)`、`styled(Loader2)` 这类包装改为传 className。
- Does NOT affect：DOM 结构与语义标签、aria 属性与交互行为、组件逻辑与数据流、主题 token 名、`main` / `preload`、测试断言——已核实 `components/__tests__/` 无一处引用 styled 内部组件名，也无 `toHaveStyle` 断言。
- Boundaries：纯样式重构，视觉零变化。重构中发现的既有视觉问题记 `notes/issue/`，不顺手修。

### Requirement

| 要求                                 | 判定                                                                       |
| ------------------------------------ | -------------------------------------------------------------------------- |
| 每个组件文件 ≤1 个 styled 定义       | grep 计数；`theme/index.tsx`（Provider）与叶子基础组件（唯一定义即本体）除外 |
| 内部元素原生标签 + className         | JSX 里不再出现第二个 styled 组件名                                          |
| 动态样式走新三通道                   | aria/data-* 后代选择器、条件 className、数值内联 style                     |
| 视觉零变化                           | dev 目检 + 截图对比，见 Test plan                                          |

## Impact range — Phase 1

| 文件                              | styled 数 | 动态样式现状                        | 风险点                                             |
| --------------------------------- | --------- | ----------------------------------- | -------------------------------------------------- |
| components/DeviceWizard.tsx       | 25        | Tab 选中、加载态                    | 步骤多，目检面最大                                 |
| components/wizard/ImageTable.tsx  | 22        | 下载进度、状态色、按钮态            | 进度条与多态按钮，视觉密度最高                     |
| components/wizard/ProfilePage.tsx | 18        | —                                   | 表单排版                                           |
| components/DeviceEditor.tsx       | 18        | —                                   | 表单排版                                           |
| components/DeviceCanvas.tsx       | 16        | `$frame` `$top` `$layout` 全是数值  | 唯一需要成规模内联 style 的文件；投屏区目检        |
| components/wizard/SettingsForm.tsx | 14       | —                                   | 表单排版                                           |
| components/DeviceRow.tsx          | 13        | `$status`、四个 `$selected`         | 选中态已挂 `aria-current` 在 Wrapper 上，内部 `$selected` 全部可由 `&[aria-current] .xxx` 取代 |
| components/wizard/SummaryPanel.tsx | 9        | —                                   | 摘要排版                                           |
| components/CanvasPlaceholder.tsx  | 7         | —                                   | —                                                  |
| App.tsx                           | 5         | —                                   | 主窗骨架                                           |
| components/DeviceHealthNotice.tsx | 5         | —                                   | —                                                  |
| components/DeviceListPane.tsx     | 4         | —                                   | —                                                  |
| components/ListRow.tsx            | 3         | —                                   | —                                                  |
| components/SegmentedControl.tsx   | 2         | —                                   | 已有 Wrapper，只剩 Segment 一个                     |
| components/DeviceToolbar.tsx      | 2         | —                                   | —                                                  |

已合规不动：BoardHead、Button、Divider、Input、ResizeHandle、SettingsParts、SettingsWindow（各 1 个定义，即组件本体）；`theme/index.tsx`（0 个）。

跨文件重复现状：`EmptyHint`、`IconButton`、spin `@keyframes`（全仓 5 处）在多个文件各自定义。本计划**不**抽公共样式文件——各文件先收敛到自己的 Wrapper；要不要抽取是另一个决策，重构中发现相关线索记 issue，不做。

## Design — Phase 2

### 目标形态

以 DeviceRow 为例，现状与目标。

现状（节选）——每个内部元素一个 styled，`$selected` 逐层传染：

```tsx
const Subtitle = styled.span<{ $selected: boolean }>`
  font-size: 12px;
  color: var(--board-ink-dim);
  ${({ $selected }) => $selected && `color: inherit; opacity: 0.72;`}
`
```

目标——选中态本来就有 `aria-current` 挂在 Wrapper 上，内部一律原生标签 + className：

```tsx
// JSX
<span className="subtitle">{device.name}</span>

// Wrapper 模板内
.subtitle {
  font-size: 12px;
  color: var(--board-ink-dim);
}
&[aria-current] .subtitle {
  color: inherit;
  opacity: 0.72;
}
```

### 动态样式映射规则（规范条款的落地版）

| 现状写法                                | 目标写法                                                       | 例                                          |
| --------------------------------------- | -------------------------------------------------------------- | ------------------------------------------- |
| `$selected` 等「整行/整块状态」prop      | 状态已在 Wrapper 的 aria / `data-*` 上，后代选择器响应          | `&[aria-current] .subtitle`                 |
| `$status` 等离散枚举                    | TS 里算 class 或挂 `data-status`，Wrapper 里写每个值的选择器    | `.status-dot[data-status='running']`        |
| `$top`、`$frame`、`$layout` 数值        | TS 算内联 `style`，CSS 只留静态样式                             | `style={{ top: cameraTop }}`                |
| `styled(Input)` / `styled(Loader2)`     | 传 className / size 等 props                                    | `<Input className="rename-input" />`        |
| 组件内 `@keyframes`（spin 等 5 处）     | 平移进所属 Wrapper 模板，作用域不变                             | —                                           |

### 每个文件的重排顺序（统一动作）

1. JSX 里把内部 styled 组件名换成原生标签 + className（kebab-case）。
2. 各 styled 的 CSS 平移进 Wrapper 模板的对应类选择器，删掉 `$` prop。
3. 动态样式按映射表改写。
4. 删空了的 styled 定义；`npm run typecheck` 收尾确认无残留引用。

## Build order

每批独立提交、独立验证：`npm run typecheck` + `npm run lint` + `npm run test` 全绿，再 `npm run dev` 目检该批界面。从小到大，先攒手感再碰硬骨头。

1. 批 A——小步热身（≤4 个定义）：SegmentedControl、DeviceToolbar、ListRow、DeviceListPane。目检：主窗列表区、外观切换。
2. 批 B——中件：DeviceHealthNotice、CanvasPlaceholder、App.tsx。目检：主窗骨架、健康提示、空画布。
3. 批 C——行与表单：DeviceRow（`$selected` → aria-current 后代选择器的样板文件）、SummaryPanel、SettingsForm。目检：列表行各态（默认/选中/错误行/重命名）、向导摘要与系统镜像设置。
4. 批 D——编辑器与画布：DeviceEditor、DeviceCanvas（数值全转内联 style，重点回归 `DeviceCanvas.layout.test` 与横竖屏/皮肤遮挡）、ProfilePage（初版漏排进批次，执行时守卫 grep 抓出补入）。目检：编辑器表单、投屏各分辨率、机型选择页。
5. 批 E——两大件：ImageTable（进度条与按钮多态）、DeviceWizard（Header/Footer/Tab 全链）。目检：向导全步骤走一遍，含下载中断与重试。
6. 收尾：全仓 grep 守卫（见 Done criteria）、book 收尾（learn + 本 plan 状态 + 索引）。

## Test plan

- 自动：现有 vitest 全绿即行为未变（测试按角色/文本查询，不触样式层）；纯样式重构不新增测试。
- 目检：每批按 Build order 的清单过对应界面；批 D/E 重构前后截图对比（正常态 + 选中态 + 错误态，画布横竖屏各一）。
- 回归重点（动态样式改造的三个点）：DeviceRow 选中态文字颜色、ImageTable 下载进度填充、DeviceCanvas 相机遮挡位置。

## Done criteria

- 守卫通过：对每个组件文件 `grep -cE "^const [A-Z][A-Za-z]* = styled" <文件>` ≤1（含 `App.tsx`）；`src/renderer/src/` 内 `styled(` 包装为 0 处。
- `npm run typecheck`、`npm run lint`、`npm run test` 全绿。
- 目检与截图对比无视觉回归；过程中发现的视觉问题已记 `notes/issue/` 而非顺手改。
- book 收尾完成：learn 条目（重排踩到的坑）、本 plan `status: completed`、`npm run book:index` 通过。

## 执行记录（2026-10-10）

用户批准并行执行后，批次从小到大的顺序改为 7 个 agent 按文件切分并行（批 A/B/C/D 各一，ImageTable、DeviceWizard 各一），每批独立提交保留，验证集中到全部完成后一次跑。初版 Build order 漏排 ProfilePage（影响表有、批次无），由 Done criteria 的守卫 grep 抓出后补一个 agent 完成、并入批 D 提交——教训见 [learn](../notes/learn/2026-10/2026-10-10-styled-single-wrapper-refactor.md)。

集中验证结果：`typecheck` / `lint` 通过；vitest 805 通过 6 跳过（既有 skip）；守卫 grep——15 个违规文件每文件恰 1 个 styled 定义、`styled(` 包装 0 处；`npx prettier --check src` 通过。分批提交在 refactor/styled-single-wrapper 分支上完成后 squash 为 dev 565b61a。

Done criteria 剩余一项未闭合：dev 目检与截图对比（人工项）——目检通过后由人把 `status` 翻成 `completed`。执行中发现的既有问题记在 [issue](../notes/issue/2026-10-10-styled-refactor-review.md)。
