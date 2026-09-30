---
name: bocode
description: 入口 skill（薄码），服务运行 BoCode 工作流（code/ + book/ 布局）的仓库。在此类仓库开始会话时使用，或在判断文档去向、book 索引机制、code↔book 规则要求时使用。传授结构地图与全程纪律；功能开发本身由 boscope 负责。
---

# bocode（薄码）

本仓库运行 BoCode：`code/` 是源代码，`book/` 是文档流和知识库，两者双向驱动。你每次会话的任务：让飞轮转起来——码前从 book 读，码后往 book 写。

## 地图

```
book/
├── README.md          总索引（脚本生成——先读这个）
├── guidelines/        规则：工作流、书写风格、git、review
├── stage/             开发阶段：里程碑与步骤勾选，人主导
├── docs/              架构快照、API 契约、ADR
├── notes/
│   ├── learn/         经验条目——写码前先搜
│   ├── task/          任务跟踪
│   └── issue/         记录的问题——绝不顺手修
├── plans/             实现施工图——写码的输入
└── changelogs/        带日期的变更记录
```

## 会话纪律

**开工时：**
1. 读 `book/README.md` 拿全图。
2. 读 `AGENTS.md` 拿仓库规则和硬约束。
3. 写任何代码之前：读 `book/stage/` 拿当前阶段，查 `book/guidelines/` 拿基线，按 tag 搜 `book/notes/learn/` 找相关经验。

**写码中：** 新教训或新坑直接进当月的 `notes/learn/YYYY-MM/`——别等收尾才回忆。

**收工时：** 同步 book——plan 状态、stage 步骤勾选（附一行结果）、新 issue、changelog 一笔——然后重刷索引。写什么、写到哪，细节在 **book-writeback** skill 里。

## 两个契约

1. **索引契约**：每篇新 book 文档开头带 frontmatter `description`——一行说人话的**内容**摘要（不写体裁）。book 有任何改动后跑 `cd code && npm run book:index`；缺 description 构建就失败，这正是它的目的。
2. **只记录契约**：review 或收尾中发现的问题记录进 `notes/issue/`，绝不顺手修。记录在案的问题变成任务；修复是另一件事。

## 不许做的事

- 不要手改 `book/README.md`——它是生成的。
- 不要按功能归档：`learn/`、`issue/`、`changelogs/` 只按 `YYYY-MM/` 分组；功能靠索引、frontmatter 和链接去找。
- 不要用模板腔写 book 文档——写薄写好（**bowrite** skill，薄写），按 `book/guidelines/writing-style.md`：说人话，事实锁死。
- 不要把 `book/plans/` 里的 plan 当建议：它是实现的输入，偏离要走回设计，不许悄悄进代码。
