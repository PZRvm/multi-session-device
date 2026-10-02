---
description: 六篇 guideline 的索引与按需查阅路由表——什么任务先读哪篇，无需通读
---

# 规则书（Guidelines）

项目的开发规则。每一位贡献者——包括 AI agent——都要遵守。

| 文件 | 内容 |
|------|---------|
| `workflow.md` | 六阶段关卡工作流与 code↔book 交互规则 |
| `writing-style.md` | 所有 book 文档的说人话标准 |
| `git-workflow.md` | Clean Commit 提交格式与 Clean Flow 分支 / PR / 合并规则 |
| `review-checklist.md` | 八项 code review 检查 |
| `architecture.md` | 长期架构规则（模板——按你的项目替换） |
| `coding-style.md` | 语言相关的编码基线（模板——按你的项目替换） |

## 按需查阅——查任务触达的那篇，永不通读

| 当任务涉及… | 先读 |
|--------|-----------|
| 阶段、关卡、book 同步 | `workflow.md` |
| 模块边界、数据归属、技术更换 | `architecture.md` |
| 模块与数据流的当前形态 | `../docs/architecture/` 快照 |
| 接口契约 | `../docs/api/` |
| 写任何 book 文档 | `writing-style.md` |
| 提交、分支、PR、发版 | `git-workflow.md` |
| 语言级代码规则 | `coding-style.md` |
| review 一个 diff | `review-checklist.md` |
| 这个症状或技术以前踩过坑 | 按 tag 搜 `../notes/learn/` |

初次接触仓库：把 `workflow.md` 通读一遍。之后直接跳到任务触达的那篇——上面这张表负责路由。
