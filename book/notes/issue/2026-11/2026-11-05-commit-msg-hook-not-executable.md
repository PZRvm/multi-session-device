---
status: open
description: 主仓库提交时提示 commit-msg hook 无执行权限而被忽略，本轮手动主题校验通过，未改 hook 权限
---

# 主仓库的 commit-msg hook 被 Git 忽略

- **观察**：2026-11-05 在 dev 提交合并记录时，Git 提示 `.githooks/commit-msg` 没有执行权限而被忽略。本轮提交前显式执行 `node scripts/check-commit-message.mjs`，主题校验通过；提交没有因此失败。
- **复现**：在主仓库按当前 hooksPath 与文件权限提交，观察 Git 的 non-executable hook 提示。
- **建议方向**：单独核对 hook 的 Git 文件模式与本地执行权限，决定修正来源。本轮已到收尾阶段，只记录，未修改权限或 Git 配置。
