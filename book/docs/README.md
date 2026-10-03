---
description: docs/ 的地图——产品需求、架构快照、API 设计、架构决策记录
---

# Docs

技术文档：系统长什么样，以及为什么长这样。

| 目录            | 内容                                                 | 与 guidelines 的区别                                            |
| --------------- | ---------------------------------------------------- | --------------------------------------------------------------- |
| `PRD.md`        | 产品需求文档——一期范围、验收标准、决策记录的唯一依据 | guidelines 说永远怎么工作；PRD 说这一期做什么、做到什么算数     |
| `architecture/` | 实现快照——模块和数据流的当前状态                     | `guidelines/architecture.md` 装长期规则；快照装带日期的当下真相 |
| `api/`          | API 设计与接口契约                                   | guidelines 说怎么审；API 文档说接口是什么                       |
| `decisions/`    | 架构决策记录（ADR）——选择为什么这么做                | 决策一篇记一个选择；guidelines 沉淀常效规则                     |

新文档需要 frontmatter `description`（见 `guidelines/writing-style.md`），加完要重新生成索引（`npm run book:index`，仓库根）。
