---
description: Clean Commit 提交信息格式与 Clean Flow 分支、PR、合并规则（单人及团队开发）
---

# Git 工作流

本仓库遵守 [Clean Commit](https://github.com/wgtechlabs/clean-commit) 与 [Clean Flow](https://github.com/wgtechlabs/clean-flow)：提交历史保持可读，`main` 只接收已经在 `dev` 上稳定集成过的代码。两份规范本身只带文档——本仓库用自己的零依赖工具执行它们（`scripts/check-commit-message.mjs`、`.githooks/`、`.github/workflows/git-policy.yml`）。

## 全流程一张图

```text
大功能：feature/* 工作分支 ── 本地验收 ──> dev ── PR + merge commit ──> main
小修复：  直接提交 ─────────────────────────────────────> dev
```

| 分支 | 用途 | 允许的来源 |
|--------|---------|-----------------|
| `main` | 稳定、可发布的代码 | 只收来自 `dev` 的 merge commit |
| `dev` | 单人开发的集成分支 | 验证过的小修复、文档、低风险迭代直接提交；大功能做完后合入 |
| 工作分支 | 独立大功能或横切改动 | 从最新 `dev` 切出 |

永远不要直接向 `main` 提交或推送。单人开发为速度优化：小而聚焦、本地验证过的修复和文档可以直接进 `dev`。每个独立大功能仍然从工作分支开始，未完成的能力不会漏进 `dev`。

PR 留给值得单独留档的 review：多人协作，以及每一次 `dev → main` 发版。单人大功能本地验收后可以不开 PR 直接 squash-merge 进 `dev`；高风险改动仍然可以刻意开一个。

## 分支命名

短、小写、连字符：

```text
feature/user-profile
fix/login-timeout
docs/deployment-guide
chore/update-dependencies
test/upload-validation
refactor/api-client
```

## Clean Commit 格式

所有非合并提交的主题用以下形式之一。规则自标准落地起只管新提交；既有历史永不重写。

```text
<emoji> <type>: <description>
<emoji> <type> (<scope>): <description>
<emoji> <type>!: <description>
<emoji> <type>! (<scope>): <description>
```

| Emoji | Type | 用于 |
|:---:|---|---|
| 📦 | `new` | 新功能、新文件、新能力 |
| 🔧 | `update` | 对既有代码的修改、修复、重构、改进 |
| 🗑️ | `remove` | 删除代码、文件、功能、依赖 |
| 🔒 | `security` | 安全修复、漏洞补丁 |
| ⚙️ | `setup` | 配置、CI/CD、工具链、构建系统 |
| ☕ | `chore` | 维护、依赖升级、清理 |
| 🧪 | `test` | 新增、更新、修复测试 |
| 📖 | `docs` | 文档改动 |
| 🚀 | `release` | 版本发布与发布准备 |

规则：type 和 scope 小写；scope 可选、要短；描述用现在时、不以句号结尾、72 字符以内。破坏性标记 `!` 紧跟 type，只用于 `new`、`update`、`remove`、`security`。

```text
📦 new (auth): add login rate limiting
🔧 update (api): improve error handling
🧪 test: add upload validation coverage
📖 docs: describe deployment process
🚀 release: promote dev to main
```

仓库脚本校验格式、type、scope、破坏性标记、句号结尾和长度；现在时与否留到 review 时人工判断。

## 单人敏捷开发

### 小修复与快速迭代

保持单一目的、可快速验证，不含迁移、不可逆数据操作或大范围重构。本地检查通过后直接提交 `dev`：

```bash
git checkout dev
git pull --ff-only origin dev
# 改动、测试
node scripts/check-commit-message.mjs "🔧 update (form): handle empty optional input"
git commit -am "🔧 update (form): handle empty optional input"
git push origin dev
```

### 独立大功能

从工作分支开始。单人功能本地验收即可——squash-merge 进 `dev`，再推送：

```bash
# 1. 从最新 dev 切出
git checkout dev
git pull --ff-only origin dev

# 2. 切工作分支
git checkout -b feature/user-profile

# 3. 提交前先校验主题
node scripts/check-commit-message.mjs "📦 new (auth): add login rate limiting"
git add <files>
git commit -m "📦 new (auth): add login rate limiting"

# 4. 合回前与 dev 同步
git fetch origin
git rebase origin/dev
git checkout dev
git merge --squash feature/user-profile
git commit -m "📦 new (auth): add login rate limiting"
git push origin dev
```

多人共建同一功能时，从 `feature/user-profile` 向 `dev` 开 PR，检查通过后 **Squash and merge**；squash 的主题同样走 Clean Commit。合并后删除工作分支。

`dev` 稳定后，先跑 `npm run book:release-check`——两项全绿才发版：book 索引与内容一致（改了 book 忘跑 `book:index` 会失败），git 树里没有 .DS_Store 之类垃圾文件。然后开 `dev → main` 的 PR，选 **Create a merge commit**，保住集成边界。merge commit 的主题同样走 Clean Commit，例如：

```text
🚀 release: promote dev to main
```

## 自动化与平台设置

- 进 `dev`/`main` 的 PR 和对它们的推送，由 `.github/workflows/git-policy.yml` 校验分支方向和提交主题；直推 `dev` 的提交仍会过 Clean Commit 校验。
- 同一个 workflow 在每次进 `dev`/`main` 的 PR 和推送上跑 `book:release-check`；索引过期或垃圾文件一进树就失败。
- 每个 clone 跑一次 `git config core.hooksPath .githooks`，本地就有同样的 `commit-msg` 检查。
- 在 GitHub 上保护 `main`：要求来自 `dev` 的 PR、状态检查、merge commit。直推 `dev` 保持允许，保单人速度；团队 PR 仍走 squash 合并。

私有仓库的套餐不支持分支保护 API 时，CI 和本地 hook 已经在仓库内把政策执行到位；仓库转公开或套餐支持后尽快启用平台设置。
