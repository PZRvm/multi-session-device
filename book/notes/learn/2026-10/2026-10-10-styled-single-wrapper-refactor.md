---
description: styled 单 Wrapper 全局重排的执行经验——影响表和施工批次必须对账、并行 agent 的集中验证纪律、后代类选择器特异性升档的前提
tags: [styled-components, 重构, 并行执行, agent 协作]
---

# styled 单 Wrapper 重排——执行经验

**范围**：refactor/styled-single-wrapper 分支（squash 为 dev 565b61a），15 个违规组件文件的 163 个多余 styled 定义收敛为每文件 1 个。详见 [plan](../../../plans/2026-10-10-styled-single-wrapper-refactor.md)。

## 影响表和施工批次必须对账

初版 plan 的影响表列了 15 个违规文件，Build order 只排了 14 个——ProfilePage（18 个定义）在表里有、批次里没有。6 个并行 agent 全部「完成」后，靠 done criteria 的守卫 grep（`styled(` 出现 0 处）才抓出这个漏网。教训：影响表逐行核对施工清单再开工；守卫 grep 要在宣布完成之前跑，不是宣布之后补跑。

## 并行 agent 改样式层的纪律（有效，可复用）

- 文件按 agent 严格切分、互不重叠；每个 agent 的提示里写死「只许改名下文件、不改导出面」。
- 并行期间禁项目级命令（vitest / lint / git），只许 `npx prettier --write` 自己的文件和 `npx tsc --noEmit`（只修自己文件的报错，其他文件的报错是并行中间态）。tsc 是全项目的，报错按文件过滤即可用。
- 验证集中在所有 agent 完成后跑一遍：typecheck + lint + test + 守卫 grep。本次 805 个测试首次集中跑即全绿——前提是 agent 的 tsc 过滤纪律加上「CSS 逐条平移不改值」的硬约束。
- agent 只改文件不做 git，提交由协调者按批 staged + commit——批的边界清晰，squash-merge 回 dev 前每批可独立回退。

## 后代类选择器的特异性升档是「有条件安全」

内部元素从自身 styled 类（0,1,0）变成 Wrapper 后代类（0,2,0），特异性升高。本项目全局 CSS 无元素级选择器、无跨文件类选择器竞争，级联结果不变；若将来引入全局样式表或 CSS reset，这个前提要重新核对——升档方向是变高不是变低，风险是「压过别人」，不是「被别人压过」。

## 杂项

- `styled(Loader2).attrs({ size: 14 })` → `<Loader2 size={14} className="...">` 平移干净，spin keyframes 一并进 Wrapper 模板，同一 stylis 管线行为不变。
- 数值型动态（FrameRect、相机 top、ScreenLayout）转 TS 内联 style 时，`calc(${top}px - 2.5px)` 要先算术化（`top / 2 - 2.5`，React 数值自动补 px）再平移，不能字符串照搬。
- DOM 上原有的 aria 属性（aria-current / aria-pressed / aria-selected）就是现成的状态通道，优先用属性选择器响应，不新造 is-* 类——ImageTable 与 DeviceWizard 全程零新增状态通道。
