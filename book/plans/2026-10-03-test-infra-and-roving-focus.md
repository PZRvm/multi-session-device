---
description: 两笔挂账的施工图——vitest 测试基建接入（stage 01 挂账步骤）与 SegmentedControl roving focus 修复（stage 02 P3 issue）
status: completed
created: 2026-10-03
---

# vitest 基建 + SegmentedControl 焦点修复 — plan

> 批准记录：2026-10-03 用户下令「将这两个账新开一个开发计划，并对其进行修复」——指 stage 01 挂账的 vitest 测试基建步骤与 stage 02 review 挂账的 issue [2026-10-03-segmented-roving-focus](../notes/issue/2026-10/2026-10-03-segmented-roving-focus.md)。

## Requirements brief（Step 0）

**背景**：两笔独立挂账恰好互补——vitest 接入后的第一个真实测试，正好用来验证 SegmentedControl 的焦点搬运修复。

**范围（影响什么）**：

- dev 依赖 +3：vitest 5 / jsdom 29 / @testing-library/react 16
- `vitest.config.ts`（jsdom 环境 + `@shared` 别名对齐）+ `package.json` +`test` 脚本
- `SegmentedControl.tsx`：ref 表 + `move()` 后显式 focus 新选中瓣
- 两个测试文件：SegmentedControl 5 用例 + themeStore 2 冒烟
- `coding-style.md` 标准跑法补 `npm run test` 关卡

**排除项（明确不影响）**：

- 不接 CI workflow（`git-policy.yml` 的触发面维持现状，本地 `npm test` 为准）
- 不上 user-event / jest-dom（fireEvent + 原生断言够用，依赖最小化）
- 不做 E2E、不为测试改产品代码以外的行为

**需求本身**：`npm test` 全绿；issue 复现路径（方向键 → 焦点错位）转绿。

**learn/ 检索**：cdp-smoke 一条相关——本轮交互验证改由 vitest 直接覆盖，CDP 留给视觉类冒烟。

## Impact range（Phase 1）

| 文件                                                            | 动作                     |
| --------------------------------------------------------------- | ------------------------ |
| `vitest.config.ts`                                              | 新建                     |
| `package.json`                                                  | +`test` 脚本、+3 devDeps |
| `src/renderer/src/components/SegmentedControl.tsx`              | +ref 表与 focus 搬运     |
| `src/renderer/src/components/SegmentedControl.test.tsx`         | 新建（5 用例）           |
| `src/renderer/src/stores/themeStore.test.ts`                    | 新建（2 冒烟）           |
| `book/guidelines/coding-style.md`                               | 标准跑法补 test          |
| `book/notes/issue/2026-10/2026-10-03-segmented-roving-focus.md` | 追加跟进收口             |

**风险**：RTL 自动 cleanup 在 vitest 无 globals 时不注册（实测命中——显式 `afterEach(cleanup)` 解决）；受控组件测试喂假 onChange 不回灌 value（实测命中——useState Harness 镜像真实数据流）。

## Design（Phase 2）

**修复**：`move()` 在 `onChange(next.value)` 后经 ref Map（`useRef(new Map<T, HTMLButtonElement>())`）对新瓣调 `.focus()`——React 改 tabIndex 不搬浏览器焦点，必须显式调 DOM API。

**测试形态**：键盘用例包一层 `useState` Harness 镜像真实数据流（App 把 store 值喂回 `value`）；回调契约断言（点击 → onChange 参数）才用 `vi.fn` 直测。

## Build order

1. vitest 接入（deps / config / script）——验证：`npm run test` 可执行
2. SegmentedControl 修复——验证：焦点用例转绿
3. 测试补齐 + coding-style 关卡——验证：7 用例全绿、静态三关全绿

## Test plan（Phase 4）

- `npm test` 7 用例：渲染语义 / 点击回调 / 方向键焦点搬运 / wrap 循环 / 连按跟随 / themeStore 持久化冒烟 ×2
- 复现路径回归：issue 的"方向键 → 焦点错位"必须转绿
- 静态：typecheck / 全仓 lint / prettier

## Done criteria

两笔账收口：`npm test` 全绿且键盘可访问性测试落地；issue 附跟进已修；stage/01 步骤勾选；coding-style 关卡更新；索引重刷。

> 完成记录（2026-10-03）：7/7 用例全绿（含键盘焦点搬运 3 条）；修复核心 = ref 表 + 一次 `.focus()`；调试命中 RTL cleanup 与受控组件 Harness 两个测试惯例，已蒸馏成 learn（[2026-10-03-vitest-testing-library-gotchas](../notes/learn/2026-10/2026-10-03-vitest-testing-library-gotchas.md)）。
