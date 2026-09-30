# AGENTS.md

AI agent 在本仓库工作的入口规则。

## 项目结构

- 仓库本体是 Electron 应用（electron-vite + React + TypeScript），源码在 `src/`。
- `book/` 是文档与知识库：`guidelines/`（规则书）、`stage/`（开发阶段跟踪）、`notes/`（learn / issue / task / think-report）、`docs/`（快照、契约、ADR）、`plans/`（施工图）。总览见 `book/README.md`。

## stage/ 的权限边界

stage 由人主导（定阶段、定步骤、调顺序）。agent：

- **可以**：对应实现完成且验证后，把步骤勾为 `[x]` 并附一行结果；受阻时改为 `[-]` 并附一行原因；建议新步骤时以 `[suggested]` 标注，等人批准。
- **不可以**：删除步骤、修改概述、调整步骤顺序、直接转正自己的建议。

## 功能收尾（必做）

功能完成时依次做：

1. 勾选 `book/stage/` 里对应的步骤，附一行结果（效果如何、遗留什么）。
2. 踩坑写 `book/notes/learn/`；发现但不修的问题写 `book/notes/issue/`——只记录，不顺手修。
3. 对应 plan 状态翻 `completed`。
4. book 结构有增删时（新目录、新分类），同步更新 `book/README.md`。

## 其他

- 本项目不使用 summary（已由 stage 替代）；changelog 未启用，变更记录以 git log 为准。
- 动代码前先读 `book/stage/` 里当前阶段和对应 plan，按 `book/guidelines/workflow.md` 的六阶段走。
