---
description: eslint 的 TS 推荐规则会打到零依赖 .mjs 脚本上要求返回类型标注——scripts/ 每个新脚本头部带文件级 disable
tags: [eslint, mjs, tooling, zero-dep, lint-error]
---
# 零依赖 .mjs 脚本过不了本仓 eslint——TS 规则要求返回类型，而 .mjs 写不了 TS 标注

- **Scenario**: 在 `scripts/` 下新建零依赖 .mjs 工具脚本（要能被 node 直接跑，不能上 tsx/ts-node），`npx eslint scripts/` 报 `@typescript-eslint/explicit-function-return-type`。
- **Why**: `eslint.config.mjs` 的 `tseslint.configs.recommended` 覆盖所有 js/ts 文件（含 .mjs），该规则要求每个函数显式返回类型；但纯 .mjs 里写 `function f(): string` 是非法语法——规则和脚本形态天然冲突，只能绕。
- **How to apply**: 每个新脚本头部（doc 注释后）加一行文件级 disable 并注明原因：`/* eslint-disable @typescript-eslint/explicit-function-return-type -- 零依赖 .mjs 脚本要能被 node 直接运行，写不了 TS 返回类型标注 */`。`scripts/gen-book-index.mjs`、`check-commit-message.mjs` 已带头，照抄即可。
