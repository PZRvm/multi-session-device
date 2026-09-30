---
name: book-writeback
description: 返写 skill（中文名：返写）——活干完后引导回写 book：stage 步骤勾选、learn 条目、issue 记录、changelog 条目，带模板与质量关卡，最后重刷索引。功能收尾时、学到东西的小修之后、或用户要求勾 stage、写 learn / issue / changelog 时使用。
---

# book-writeback（返写）

不回写 book 的开发会丢掉经验。本 skill 覆盖写什么、写到哪、质量线在哪——适用于 BoCode 布局（`book/` 含 `stage/`、`notes/{learn,issue}/`、`changelogs/`、`plans/`）。

## 写什么，什么时候写

| 情况 | 写 |
|-----------|-------|
| 功能完成 | stage 步骤勾选（附一行结果）+ learn + changelog，plan 状态 → completed |
| 学到东西或踩了坑（任何阶段） | learn——立即写，不等收尾 |
| 注意到问题但刻意不修 | issue |
| 小修一笔、没什么可教的 | 只写 changelog |

## 模板与质量关卡

### stage 勾选 → `book/stage/01-<阶段名>.md`

把完成的步骤勾为 `[x]`，**同一行附一句结果**——效果如何、遗留什么。

```markdown
- [x] 实现模拟器克隆（对应 plan：2026-09-29-模拟器克隆.md） —— 结果：单机 10 实例实测通过，克隆耗时约 8 秒
- [-] iOS 画面嵌入 —— 原因：等权限方案调研
```

**关卡：** 光看这一行，不看 diff 就知道步骤做到了什么程度。数字优先于形容词；没做的事和做了的事说得一样明白。agent 对 stage 的权限边界（可勾选、可建议，不可删改）见仓库的 `AGENTS.md`。

### learn → `book/notes/learn/YYYY-MM/YYYY-MM-DD-<topic>.md`

给人和 agent 用的可检索知识条目。

```markdown
---
description: <一行说人话的内容摘要>
tags: [<主题>, <技术>, <症状>]
---
# <一句话结论>

- **场景**：这条经验什么时候适用
- **原因**：背后的机制
- **怎么用**：下次有什么不同的做法
```

**关卡：** 光看标题就能回答问题。tags 写你日后会搜的词——包括症状词（"timeout"、"drift"、"silent-fail"）。

### issue → `book/notes/issue/YYYY-MM/YYYY-MM-DD-<topic>.md`

一条被记录的问题。**记录的时候绝不顺手修。**

```markdown
---
description: <一行说人话的内容摘要>
---
# <一行说清问题>

- **观察**：看到了什么，在哪，什么时候
- **复现**：让它再次出现的步骤或条件
- **建议方向**：修复大概会动哪——仅记录
```

**关卡：** 别人光凭这条记录就能确认问题存在。

### changelog → `book/changelogs/YYYY-MM/YYYY-MM-DD-<description>.md`

短、带日期、只述事实：什么落地了。一次改动一条；有 plan 就链接它。

### plan 状态 → `book/plans/YYYY-MM-DD-<feature>.md`

把 `status:` 翻成 `completed`（或 `in_progress`），让施工图兼作"当初想做什么"的记录。

## 每次回写之后

1. 每个新文件带 frontmatter `description`。
2. 重刷索引：`cd code && npm run book:index`——零警告才算做过。
3. 书写遵守 `book/guidelines/writing-style.md`：说人话，忠实契约高于风格（数字、命令、名称、责任归属绝不移动）。

## 质量线

违反忠实契约的回写（编造事实、软化谓词、转移责任）比不回写更糟——未来的会话要在它上面盖楼。拿不准某个数字或原因，就把不确定性写进条目里。
