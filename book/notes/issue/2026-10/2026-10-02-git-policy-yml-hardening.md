---
description: git-policy.yml 两处待加固：GitHub 表达式直接内插进 shell 有注入面，首推 main 会被方向守卫误伤
---
# git-policy.yml 的注入面与首推 main 误伤

- **Observed**: 2026-10-02 Phase 5 review 发现两处，都在 `.github/workflows/git-policy.yml`。① `commit-subjects` job 把 `${{ github.event.pull_request.base.ref }}`、`${{ github.head.sha }}`、`${{ github.event.before }}`、`${{ github.sha }}` 直接内插进 `run: |` 的 shell——`base.ref` 是分支名，恶意分支名（如含 `$(...)` 或分号）可注入命令。② `branch-direction` job 对任何直推 `main` 的 push 一律报错，没有豁免"仓库首次建立、`before` 为零值"的引导场景——首次把 `main` 推上 GitHub 会吃红灯。
- **Reproduction**: ① 对照 GitHub Actions 的 `${{ }}` 内插到 shell 的注入惯例看 yml 第 33～44 行即可；② 在全新远端仓库首推 `main`（`git push origin main`，before 为 `0000…0`），workflow 的 `branch-direction` job 失败。
- **建议方向**: ① 分支名/SHA 一律改走 `env:` 传参再在脚本里引用（`${{ }}` 只出现在 env 块）；② `branch-direction` 对 `github.event_name == 'push' && github.event.before == 零值` 的首推放行。本仓库当前单人、无 fork、无 remote，现实风险≈0，CI 真正启用前一并加固即可——仅记录，不顺手修。

## 跟进（2026-10-02）——已修

两处均按建议方向落地：① 五个 GitHub 表达式全部移入 `env:` 块，脚本内只引用环境变量；② `branch-direction` 的 push 条件加 `github.event.before != 零值` 豁免首推。验证：重构后的 push 分支在 bash 下对真实历史区间（d0a31dd..24c93f6）端到端跑通、两条历史主题全过；零值 before 走跳过分支；YAML 解析与 prettier 干净。
