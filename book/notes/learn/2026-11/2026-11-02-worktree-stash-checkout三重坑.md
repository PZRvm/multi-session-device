---
description: worktree 里用 stash+checkout 对比基线有三重坑——stash 是仓库级共享（pop 到别的分支遗留条目）、untracked 文件冲突卡半途、切换分支会杀死运行中的 dev；基线对比只用只读方式
tags: [git, worktree, stash, baseline, electron-vite]
---

# worktree 里 stash+checkout 对比基线的三重坑

- **Scenario**: 在 worktree 里想验证「某个测试失败是不是基线就有」，惯用手法 `git stash → git checkout main → 跑测试 → 切回 → stash pop`。
- **Why**: 实测（git 2.x，Windows worktree）三件事连环：① **stash 是仓库级共享**——worktree 与主仓库共用 stash 栈，本 worktree 干净时 `git stash` 静默不创建条目，随后的 `stash pop` pop 到的是**别的分支/会话遗留的旧条目**；② 旧条目带 untracked 文件恢复，与当前分支同名文件冲突，pop 半途失败留下 UU 冲突 + "stash entry kept"（恢复：`git reset` + `git checkout -- <UU 文件>`，stash 本体未 drop 无损）；③ dev 运行中切分支，vite 对文件变化连锁 reload，切到旧位置分支时 App.tsx 引用不存在的模块直接把 Electron 进程弄死。
- **怎么用**: 基线对比全部走只读：文件存在性/内容用 `git show <ref>:<path>`；差异用 `git diff <merge-base>..HEAD -- <path>`；确实要跑测试时开**临时 worktree**（`git worktree add <tmp> <ref>`，用完 remove），绝不动当前工作区的 HEAD。注意 merge-base 才是有效基线——本地 main 可能落后于分叉链条（本次 main 停在旧 promote 位置，`main..HEAD` 里混入大量分支链条自带提交，误判为越界改动）。dev 运行期间禁止切分支/跑写 out/ 的 build。
