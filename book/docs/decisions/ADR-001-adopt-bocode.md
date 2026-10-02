---
description: 本仓库运行在 BoCode 工作流上——book 驱动 code，code 回写 book，六阶段关卡守住每个功能
---

# ADR-001：采用 BoCode 工作流

## Status

Accepted——模板随本决定一同发布。只有当项目长大到容不下它时才重议。

## Context

本项目的大部分实现由 AI coding agent 完成。agent 快，现在也有记忆——但那记忆只归 agent 自己：人读不懂、难管理、不可靠地检索。人失去全局观——落了什么、咬了什么、什么等着修。项目需要一个人和 agent 共读的地方：一本操作手册、组织过的经验、一份持续维护的问题清单；只有存储，这些一个都给不了。在把一切都存在聊天记录和记忆里的项目里，同样的问题被反复回答，同样的坑被反复踩，人再也说不清代码为什么长这样。

考虑过的替代方案：

- **别处约定（只有 ADR / 只有 README）**：太薄——记决定，不记经验和 plan
- **以 issue tracker 为中心**：任务活着，知识不活；tracker 是队列，不是 book
- **没有系统**：知识随每个会话蒸发

## Decision

本项目在顶层保留两半——`code/` 和 `book/`——双向互联：

- `book/` 驱动 `code/`：plan 是施工蓝图，guidelines 是基线，learn 条目是经验库，issue 是改进 backlog
- `code/` 回写 `book/`：每个功能以 summary、新经验、新 issue、一条 changelog 和一次重新生成的索引收尾
- 每个功能走六个带关卡的阶段（Step 0 brief → 需求分析 → 设计确认 → 实现 → 测试 → review/收尾），设计需用户确认，review/收尾只记录不修复
- 每篇 book 文档带一行 frontmatter description；一个零依赖脚本重新生成总索引，缺一个就让构建失败

## Consequences

- 每个功能都留下书面痕迹；agent 的每个会话从 book 出发，而不是从零开始
- 人可以不用读代码就跟上项目：summary 报告，decision 解释
- 收尾每个功能多花几分钟——当作复利的代价接受
- 这套纪律只在索引保持绿、书写保持说人话时才有回报；两者都靠工具链和风格规则强制执行，而不是靠意志力
