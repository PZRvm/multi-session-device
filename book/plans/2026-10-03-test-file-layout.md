---
description: 测试文件布局转 __tests__/ 子目录共置（方案 B）并把约定成文进 coding-style 与项目骨架快照
status: completed
created: 2026-10-03
---

# 测试文件布局 **tests**/ 共置 — plan

> 批准记录：2026-10-03 用户在布局调研（anysearch 三角度检索）后拍板「使用方案 B，并且需要写到项目骨架里」。方案对比：A 同置平铺（React/TS 社区主流）/ B 同级 `__tests__/` 子目录（Jest 传统折中）/ C 顶层独立 `test/`（Electron 模板惯例）——选 B：目录清单干净且保留"组件挪目录测试随行"的同置核心收益。

## Requirements brief（Step 0）

**背景**：stage 02 接入 vitest 时测试文件与组件平铺同置（`SegmentedControl.test.tsx` 挨着组件），用户觉得目录清单混入测试文件很怪，调研确认 B 是标准折中后拍板。

**范围（影响什么）**：

- 两个测试文件迁入同级 `__tests__/`：`components/__tests__/SegmentedControl.test.tsx`、`stores/__tests__/themeStore.test.ts`（import 各上一跳）
- 约定成文：`coding-style.md` 目录与组件结构 + `项目骨架.md` 快照（stage 02 落地内容一并补真：themeSystems/theme/、元素基线、验证手段补 test）

**排除项（明确不影响）**：vitest 配置零改动（`src/**/*.test.{ts,tsx}` 通配天然覆盖 `__tests__/`）；不建顶层测试树（留给将来 E2E 进 `e2e/`）；不迁移尚未存在的测试。

**需求本身**：测试文件不再与组件平铺混列；约定在 coding-style（规矩）与项目骨架（快照）两处可查；`npm test` 行为不变。

**learn/ 检索**：vitest-testing-library-gotchas 一条引用了旧测试路径，随迁修正。

## Impact range（Phase 1）

| 文件                                                                    | 动作                                                                                                  |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 两个 `*.test.*` 文件                                                    | 迁入 `__tests__/`，import 上一跳                                                                      |
| `book/guidelines/coding-style.md`                                       | +`__tests__/` 共置 bullet                                                                             |
| `book/docs/architecture/项目骨架.md`                                    | 顶层树补 DESIGN.md/scripts/vitest.config；现状表补 stage 02 落地行 + `__tests__/` 行；验证手段补 test |
| `book/notes/learn/2026-10/2026-10-03-vitest-testing-library-gotchas.md` | 骨架路径指针随迁修正                                                                                  |

**风险**：路径改动后测试失联——vitest 通配已覆盖，迁移后全量跑测试即验。

## Design（Phase 2）

布局：`<同级>/__tests__/<模块名>.test.ts(x)`（Jest 传统折中形态）；E2E 将来进顶层 `e2e/`（单测同置、跨模块集中，混合惯例的完整形态）。

## Build order

1. 迁移 + import 修正——验证：`npm test` 7/7
2. 约定成文（coding-style + 项目骨架 + learn 指针）——验证：两处文档可查
3. 静态三关 + 索引重刷

## Test plan（Phase 4）

`npm test` 7/7（迁移后行为不变）；typecheck / 全仓 lint / prettier；`book:release-check`。

## Done criteria

测试文件不再与组件平铺混列且测试全绿；约定两处成文可查；索引重刷零警告。

> 完成记录（2026-10-03）：三步全过。7/7 测试零改动通过（通配覆盖验证）；coding-style 与项目骨架双处成文，骨架快照顺带补真 stage 02 落地内容（themeSystems/theme/、元素基线、`npm run test` 验证手段）。
