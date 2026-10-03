---
description: git 基建施工图——Clean Commit 主题校验脚本、commit-msg hook、git-policy CI 工作流、dev 分支，收口 book-infra-scripts-missing
status: completed
created: 2026-10-02
---

# git 基建 — plan

> 批准记录：2026-10-02 用户下令「继续检查这四个问题并且修复」——指 issue [2026-10-01-book-infra-scripts-missing](../notes/issue/2026-10/2026-10-01-book-infra-scripts-missing.md) 跟进段里仍缺的四项。

## Requirements brief（Step 0）

**背景**：book 基建脚本（book:index / book:release-check）已于 2026-10-01 落地，issue 还剩四项：`scripts/check-commit-message.mjs`、`.githooks/`、`.github/workflows/git-policy.yml`、`dev` 分支。guideline（git-workflow.md）一直在按"它们存在"的方式描述规则——四项补齐后规则与现实对齐。

**范围（影响什么）**：

- `scripts/check-commit-message.mjs`：Clean Commit 主题校验（格式、emoji↔type 配对、小写、`!` 适用范围、句号结尾、长度）
- `.githooks/commit-msg`：本地钩子，取消息首行调校验脚本；本 clone 执行 `git config core.hooksPath .githooks` 启用
- `.github/workflows/git-policy.yml`：main 方向守卫（只收 dev 的 PR、禁直推）+ 提交主题校验 + book:release-check，push/PR 进 dev/main 触发
- `dev` 分支：从 `main`（d0a31dd）切出，作为集成分支

**排除项（明确不影响）**：

- 不动既有历史——init 提交等不符合 Clean Commit 的历史不重写也不校验（规则只管新提交）
- 不做 GitHub 平台设置（main 分支保护）——repo 尚无 remote，workflow 文件随仓库走，推上 GitHub 即生效；平台保护按 guideline 的"自动化与平台设置"一节人肉开
- 不改 git-workflow.md——它描述的正是本次落地的东西，落地后规则自动成真

**需求本身**：`node scripts/check-commit-message.mjs` 对合法主题放行、违规拦截；hook 端到端工作；yml 语法合法且三个 job 覆盖 guideline 承诺的三件事；dev 分支存在。

**learn/ 检索**：四篇现有经验与本任务无关。

## Impact range（Phase 1）

| 文件                                                                | 动作                                        |
| ------------------------------------------------------------------- | ------------------------------------------- |
| `scripts/check-commit-message.mjs`                                  | 新建                                        |
| `.githooks/commit-msg`                                              | 新建 + 可执行位                             |
| `.github/workflows/git-policy.yml`                                  | 新建                                        |
| 本 clone 的 `git config core.hooksPath`                             | 设为 `.githooks`                            |
| `dev` 分支                                                          | 新建（指向 main 当前 tip）                  |
| `book/notes/learn/`                                                 | +1（eslint 打 .mjs 的坑，本任务中第二次踩） |
| `book/notes/issue/2026-10/2026-10-01-book-infra-scripts-missing.md` | 追加跟进段，本条收口                        |

**风险**：旧提交误伤——已排除（Merge/Revert 跳过 + 新分支首推跳过 + 只校验范围提交）。emoji 变体选择符（🗑️/⚙️ 带 VS16）比对误报——脚本内统一去 VS16 再比对。

## Design（Phase 2）

**校验规则**（全部出自 git-workflow.md，不外推）：

- 结构：`<emoji> <type>[!][ (<scope>)]: <description>`，冒号后必须有空格
- emoji 必须在九个对照表里且与 type 配对；比对前去 `\uFE0F`
- type 小写且在表内；`!` 只用于 new/update/remove/security
- scope 可选：小写（中文 scope 视为无大小写，允许）、无空白、≤24 字符
- description 非空、不以 `.`/`。` 结尾、≤72 字符（按码点数，中文一字算一）
- 现在时不校验（guideline 明确留给 review 人工判断）
- `Merge ` 开头 / `Revert "` 开头的 git 生成主题跳过

**workflow 三个 job**：

1. `branch-direction`：PR 进 main 但 head ≠ dev，或直推 main → 报错
2. `commit-subjects`：PR 用 `origin/<base>..head.sha`，push 用 `before..after`；`before` 为零值（新分支首推）或不可定位（疑似强推）→ 跳过——历史不校验；逐条调校验脚本，任一失败整体失败
3. `book-release-check`：直接跑 `npm run book:release-check`（零依赖，无需装包）

## Build order

1. 校验脚本落盘——验证：正反用例（见 Test plan）
2. hook + 可执行位 + hooksPath 配置 + dev 分支——验证：hook 对消息文件端到端拦截/放行
3. workflow yml——验证：YAML 解析通过
4. 收尾回写（plan、stage、issue、learn）+ 重跑 book:index

## Test plan（Phase 4）

- 正向 9 条：九个 type 各一（含带 `!`、带中文 scope/描述、真实历史提交两条）→ 全 0
- 跳过 2 条：Merge、Revert → 0
- 反向 12 条：无 emoji、结构缺空格、emoji↔type 不配对、type 大写、`!` 用在 docs、ASCII/中文句号结尾、scope 大写/含空白/超长、description 超 72、缺空格、空描述 → 全 1
- hook：合法/非法消息文件各一，退出码正确，多行消息取首行
- 静态：eslint、prettier 对 scripts/ 干净；yml 可被 yaml 解析

## Done criteria

四项全部落地且验证过；issue 2026-10-01-book-infra-scripts-missing 追加跟进收口；stage/01 追加步骤勾选附结果；book:index / book:release-check 保持全绿。

> 完成记录（2026-10-02）：四步全过。23 条用例（9 正 + 2 跳 + 12 反）全部符合预期；hook 端到端通过；本 clone 已启用 hooksPath；dev 分支已建。
> Phase 5 review（2026-10-02，boscope 补跑）：2 条发现只记录不修复——git-policy.yml 注入面 + 首推 main 误伤（[issue](../notes/issue/2026-10/2026-10-02-git-policy-yml-hardening.md)）、commit-msg 未滤空行/注释行（[issue](../notes/issue/2026-10/2026-10-02-commit-msg-hook-comment-lines.md)）。范围偏差一笔：`.obsidian/` 进 `.gitignore` 不在本 plan 影响面，良性，随记录归档。
