---
description: commit-msg 钩子要求 scope 全小写——驼峰命名（packageOps）会被主题校验拒两次且报错信息不直观
tags: [git, commit-message, hooks, gotcha]
---

# commit scope 必须小写：驼峰模块名过不了主题钩子

- **Scenario**: 给 packageOps 的修复提交写 `🔧 update (packageOps): …`——钩子连续拒绝两次，输出只打印合法形式对照表，没直接点名原因（描述长度 45 远未超限，排查绕了弯路）。查 `scripts/check-commit-message.mjs` 才看到 `scope 必须小写` 的分支。
- **Why**: 模块文件名是驼峰（packageOps.ts），scope 顺手照抄就带了大写 O；钩子的报错把具体 problems 打在被 `tail -1` 截掉的前几行，只留对照表尾巴。
- **How to apply**: scope 用语义小写词（packages/sdk/wizard），不照抄文件名；钩子拒绝时先看输出的第一行具体 problems 再对照形式表。
