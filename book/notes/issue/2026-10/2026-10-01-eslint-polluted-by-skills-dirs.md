---
description: npm run lint 被 .zcode/.agents 的 skills 目录污染出 1.6 万条问题，src/ 干净也过不了全仓关卡
status: resolved
---

> 2026-10-12 核销（fix/issue-audit 批）：.gitignore 已含 .zcode/、.agents/，eslint ignores 同步覆盖；当前全仓 lint 常绿。
# 全仓 eslint 被 skills 目录污染，lint 关卡失真

- **Observed**: 2026-10-01 stage 01 收尾时，`npm run lint`（`eslint --cache .`）报 15445 problems（1645 errors），但 `npx eslint src` 全绿。全部问题来自 `.zcode/skills/` 与 `.agents/skills/` 下的脚本文件——`out/` 已在 eslint.config.mjs ignores 里，skills 目录没有。
- **Reproduction**: 仓库根目录跑 `npx eslint . 2>&1 | grep -c error`，对比 `npx eslint src`。
- **Suggested direction**: eslint.config.mjs 的 ignores 增加 `**/.zcode` 与 `**/.agents`（一行改动）；或把 lint 脚本收窄到 `src`。注意 stage 01 排除项声明了"不动 eslint 规则集"，故只记录不顺手修，留给独立小任务。

## 跟进（2026-10-03）——已修

按方向①落地：eslint.config.mjs ignores 增加 `**/.zcode`、`**/.agents`、`**/.codex`、`**/.opencode`（四个本地工具目录盘上都在，同类一并纳入）。`npm run lint` 全仓转绿（15445 problems → 0），关卡恢复全仓效力；coding-style"格式化与 lint"一节已把关卡改回 `npm run lint`，并注明这些 ignores 不得移除。
