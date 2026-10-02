---
description: plans 目录用法——Phase 2 批准后实现计划落在这里，含命名和计划模板
---

# Plans

实现计划住在这里。每个功能的详细计划在 Phase 2 设计定稿后落进本目录——plan 是 agent 照着施工的蓝图。

## 命名

`YYYY-MM-DD-<feature-name>.md`

## 模板

```markdown
---
description: <一行说人话的内容摘要>
status: draft | approved | in_progress | completed
---

# <功能> — plan

## Requirements brief
<Step 0 的要点——背景、作用域、排除项>

## Impact range
<Phase 1 产出：受影响的文件、模块、数据流>

## Design
<Phase 2 产出：数据流、文件清单、接口>

## Build order
1. <步骤，每步带自己的验证>
2. ...

## Test plan
<Phase 4 的覆盖维度>

## Done criteria
<明确的终点线——测试全绿、review 记录在案、book 已同步、索引已重建，加上功能特有的一切>
```

一份计划写出来就能执行：每一步都小到可以单独验证。done-criteria 槽位是终点线——agent 在文字停下的地方停，所以一条明确的终点线防止过早停车。读起来为真时，把 `status` 翻成 `completed`；plan 随之兼作"当时打算做什么"的记录，实际发生了什么由 `stage/` 对应步骤的勾选结果记录。
