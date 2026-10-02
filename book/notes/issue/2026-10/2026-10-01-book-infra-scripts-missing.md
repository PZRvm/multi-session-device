---
description: workflow/git-workflow 引用的 book:index、check-commit-message.mjs、.githooks、git-policy.yml 在本仓库均不存在，规则与基建脱节
---

# book 规则引用的基建脚本在本仓库缺失

- **Observed**: 2026-10-01 收尾时发现：`book/guidelines/workflow.md` 交互规则 7 要求收尾跑 `npm run book:index`，`git-workflow.md` 引用 `scripts/check-commit-message.mjs`、`.githooks/`、`.github/workflows/git-policy.yml`、`npm run book:release-check`——以上在本仓库一律不存在（package.json 无对应脚本，无 scripts/ 与 .githooks/ 目录），用户终端实测 `npm run book:index` 报 Missing script。仓库也只有 `main` 分支，git-workflow 描述的 dev 集成分支尚未建立。
- **Reproduction**: `npm run book:index`；`ls scripts .githooks .github`；`git branch -a`。
- **Suggested direction**: 二选一：① 按 guideline 把基建补出来（book:index 脚本、commit-msg hook、dev 分支）；② 在 guideline 里标注"本仓库暂未启用"，把规则改成与现实一致。规则说谎比没有规则更糟，宜早不宜迟。

## 跟进（2026-10-01）

方向①部分落地：`npm run book:index`（`scripts/gen-book-index.mjs`）与 `npm run book:release-check`（`scripts/check-book-clean.mjs`，检查语义按本仓库重写为"垃圾文件 + 索引新鲜度"，不再是上游的模板语义）已可用；guideline 里 `cd code &&` 失效路径与 ADR-004 引用已改为与现实一致。仍缺：`scripts/check-commit-message.mjs`、`.githooks/`、`.github/workflows/git-policy.yml`、dev 分支——本条对这些保持开放。

## 跟进（2026-10-02）——本条收口

方向①剩余四项全部落地：`scripts/check-commit-message.mjs`（Clean Commit 主题校验，Merge/Revert 与既有历史不校验）、`.githooks/commit-msg`（本 clone 已 `git config core.hooksPath .githooks` 启用，新 clone 需各跑一次）、`.github/workflows/git-policy.yml`（main 方向守卫 + 提交主题校验 + book:release-check，push/PR 进 dev/main 触发；仓库暂无 remote，推上 GitHub 即生效）、`dev` 分支已从 `main`（d0a31dd）切出。规则与现实对齐，无遗留。
