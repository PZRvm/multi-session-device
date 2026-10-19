# AGENTS.md

AI agent 在本仓库工作的入口规则。

## 项目结构

- 仓库本体是 Electron 应用（electron-vite + React + TypeScript），源码在 `src/`（BoCode 默认布局的 `code/` 位置，本仓库按 Electron 惯例放在根 `src/`）。
- `book/` 是文档与知识库：`guidelines/`（规则书）、`notes/summary/`（功能报告）、`notes/`（learn / issue / task / think-report）、`docs/`（快照、契约、ADR）、`plans/`（施工图）。总览见 `book/README.md`——它是 `npm run book:index` 的生成物，勿手改。
- `scripts/` 是 book 的零依赖工具：`book:index` 重新生成总索引，`book:release-check` 发版前卫生检查（垃圾文件 + 索引新鲜度）。

## 功能收尾（必做）

功能完成时依次做：

1. 写 `book/notes/summary/YYYY-MM/` 功能报告（背景 / 做了什么 / 为什么这么选 / 结果 / 后续，写给人看；模板见 book-writeback skill）。
2. 踩坑写 `book/notes/learn/`；发现但不修的问题写 `book/notes/issue/`——只记录，不顺手修。
3. 对应 plan 状态翻 `completed`。
4. book 结构有增删时（新目录、新分类），跑 `npm run book:index` 重新生成索引，并在 `scripts/gen-book-index.mjs` 的目录用途表里为新目录补一行用途。

## 默认安全

本地命令是一次性的、不接触生产环境——npm 脚本、测试、构建、`git status/diff/log`、`npm run book:index`、`node scripts/check-commit-message.mjs "<主题>"`。直接跑，失败了修，修完再跑，不用请示。仍归人管的事：触碰生产数据或凭据的操作、破坏性操作、每一次对 `main` 的推送（反正也从不直接推）。

## 硬约束

- Step 0（结构化需求简报）在任何代码之前，必做
- 阶段之间不许跳步
- 阶段 2 只在真实缺口处为用户停下——范围冲突、数据形态未定、外部依赖不明——绝不只为确认而停
- 阶段 5 / 阶段 6 发现的问题**只记录，绝不顺手修**
- 功能开发不碰范围外的代码：不做顺手的重构，不引入新抽象

## 其他

- changelog 未启用，变更记录以 git log 为准。
- 动代码前先读对应 plan 与 `book/guidelines/workflow.md` 的六阶段；`notes/summary/` 是已完成功能的报告存档，不是进行中的任务清单。
