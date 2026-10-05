---
description: create-worktree 技能的仓库父目录公式在仓库根执行会得到相对路径 "."，worktree 被建进主仓库内部；用 rev-parse --show-toplevel 或绝对路径展开
tags: [git, worktree, skill, shell]
---

# `git rev-parse --git-common-dir` 在仓库根返回相对路径

- **Scenario**: 用脚本/skill 计算 `<仓库父目录>` 来拼 worktree 目标路径（create-worktree、或任何"在仓库旁边建目录"的自动化）。
- **Why**: 实测（git 2.x，macOS）：在**主仓库根**执行 `git rev-parse --git-common-dir` 返回 `​.git`（相对路径），`dirname` 得 `.`；拼出的 `<父>/xxx-wt/<分支>` 变成 `./xxx-wt/<分支>`，按 CWD 解析——CWD 恰是仓库根时 worktree 被建进**主仓库内部**且 git 不报错（worktree list 里路径瞬间穿帮）。在 worktree 内执行才返回绝对路径。本次踩坑：分支建到了 `multi-session-device/multi-session-device-wt/...`，靠 `git worktree list` 的异常路径发现。
- **怎么用**: 求仓库根用 `git rev-parse --show-toplevel`（恒绝对路径），或直接 `git -C <仓库> worktree add` 传**绝对路径**目标目录；产物路径永远先 `realpath`/`cd` 到绝对再拼。skill 文档里的公式照抄前先在当前 CWD 验一次。
