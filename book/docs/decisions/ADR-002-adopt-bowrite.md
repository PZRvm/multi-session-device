---
description: 我们把 shuorenhua 加上自己的 review 模式蒸馏成 bowrite（薄写）——一个仓库内的写作 skill：写薄，写好
---

# ADR-002：采用 bowrite 写作 skill（薄写）

## Status

Accepted——随模板一同发布。

## Context

每篇 book 文档都要过说人话标准（见 [ADR-001](ADR-001-adopt-bocode.md) 和 `guidelines/writing-style.md`）。我们借鉴的完整规则集 [shuorenhua](https://github.com/MrGeDiao/shuorenhua) 是外部 MIT 项目——对中文挖得比我们需要的深，但它不是我们的，且本项目的策略是引用第三方 skill，永不打包。

同时，本项目自己的文档 review 反复抓到的表达问题，guideline 和上游 skill 都没点名：让读者猜的抖机灵（赌桌比喻、双层比喻）、压缩到解不出东西的过度概括（"不信也对"）、强调句式（"不是X，而是Y" / "正是……的原因"）、从口语溜进书面语的词（"根子" → "根源"）、从别的领域借来的术语（用"工作记忆"指任务跟踪）、多语言文档里的翻译腔。这些模式随每轮 review 积累。

## Decision

加第四个 skill，`bowrite`（中文名：薄写——写薄，写好：内容变少，核心没变）：

- **薄**：字变少，信息零丢失——把书读薄发生在写作时
- **好**：自然、直接、说读者的话——永远不以清楚为代价换聪明
- 它带一份**活的模式账本**：review 抓到的每个新表达问题，作为一条 before/after 加进去，skill 随项目一起长
- 它蒸馏 shuorenhua 的原则并保留署名；上游 skill 仍是中文深清理的参考，永不打进包
- `guidelines/writing-style.md` 留着做没有 skill 的环境里的文字退路

## Consequences

- 装了 skills 的 agent 在每个项目都有一份可执行的写作标准，而不只是文字规则
- 本项目的 review 发现现在复利进 skill，而不是活在一次次一次性修复里
- 三层必须分清：skill = agent 的何时/如何，guideline = 人的什么/为什么，上游 = 中文深规则集——一见重复就地对账
- 账本需要维护；不再复现的条目最终并进通用规则
