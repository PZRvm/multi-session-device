---
description: book 基建脚本施工图——引入 BoCode 的索引生成与发版检查脚本并按本仓库适配（路径、目录表、检查语义、中文文案）
status: completed
created: 2026-10-01
---

# book 基建脚本 — plan

> 批准记录：2026-10-01 用户下令「把两个脚本引入进来，并且为这个仓库进行适配」（此前 agent 建议只引入索引脚本、放弃模板检查脚本，用户扩大为两个都要）。

## Requirements brief（Step 0）

**背景**：`book/notes/issue/2026-10/2026-10-01-book-infra-scripts-missing.md` 记录了 guideline 与基建脱节——workflow.md 收尾要求跑 `npm run book:index`，git-workflow.md 引用 `book:release-check`，两者在本仓库都不存在，实测报 Missing script。上游 BoCode 的 `code/tools/` 有两个零依赖脚本可引入。

**范围（影响什么）**：

- `scripts/gen-book-index.mjs`：引入并适配（适配点见 Design）
- 发版检查：借上游 `check-template-clean.mjs` 的位置，按本仓库语义重写为 `scripts/check-book-clean.mjs`
- `package.json` 挂 `book:index`、`book:release-check`
- guideline 里失效的引用改到与现实一致：`cd code &&` 路径（workflow.md 规则 7、writing-style.md、docs/README.md）；release-check 的模板语义（git-workflow.md 两处——本仓库非模板、无 ADR-004）
- AGENTS.md：README 标注为生成物；功能收尾第 4 条改为跑索引 + 补目录用途表；项目结构补 `scripts/`

**排除项（明确不影响）**：

- 不做 commit-msg hook（`check-commit-message.mjs`、`.githooks/`、`git-policy.yml`、dev 分支）——原 issue 对这些保持开放
- 不动 `src/` 代码；不动 eslint 规则集（scripts/ 只加文件级 disable）
- 不改 stage/ 既有步骤；不启用 changelogs/summary

**需求本身**：`npm run book:index` 与 `npm run book:release-check` 在仓库根可用；缺 description 或断链时退出码 1；索引过期或垃圾文件进树时 release-check 退出码 1。

**learn/ 检索**：现有三篇（perl 就地编辑、skill 命名空间、electron color scheme）与本任务无关。

## Impact range（Phase 1）

| 文件 | 动作 |
|------|------|
| `scripts/gen-book-index.mjs` | 新建（上游适配版） |
| `scripts/check-book-clean.mjs` | 新建（上游语义重写版） |
| `package.json` | +2 npm scripts |
| `book/guidelines/{workflow,writing-style,git-workflow}.md`、`book/docs/README.md` | 失效引用改真话 |
| `AGENTS.md` | README 标注生成物、收尾第 4 条改索引、项目结构补 scripts/ |
| `book/think-report/20260929011713-*.md` | 补 frontmatter description（索引检查揪出的唯一违规） |
| `book/README.md` | 从手写导览变为生成索引 |

**风险**：手写 book/README.md 的独有内容丢失。核对结论：目录用途进脚本用途表并在生成物重现；stage 替代 summary 的说明在 stage/README.md；三类笔记模板在 notes/README.md；docs 地图在 docs/README.md；"当前状态"注记本已过期（称 decisions/ 为空，实际已有 3 篇 ADR），随生成物一并退场。

## Design（Phase 2）

**gen-book-index.mjs 适配点**：

1. 路径：上游是 `code/tools/` + 兄弟目录 `book/`；本仓库没有 code/ 目录，脚本落 `scripts/`，`BOOK_ROOT = <仓库根>/book`
2. 目录用途表：换成本仓库实际分类（guidelines、stage、notes/{learn,task,issue}、think-report、docs/{api,architecture,decisions}、plans），移除未启用的 notes/summary 与 changelogs
3. 文案：生成物与报错全部中文；"按时间"一节改为"变更看 git log"的本仓库约定
4. 新增 `--check`：构建索引字符串与磁盘比对，不一致退出码 1 且不写盘——供发版检查用

**check-book-clean.mjs 检查语义**（上游守护"模板发出去必须干净"；本仓库不是模板，book 本该堆满真实记录，故重写）：

1. `git ls-files` 过滤垃圾文件（.DS_Store、Thumbs.db、desktop.ini）——只查 git 树，Finder 本地噪音不误报
2. 子进程跑 `gen-book-index.mjs --check`——索引新鲜 + description 齐全 + 链接可解析，三合一次检查
3. 任何违规打印清单，退出码 1

## Build order

1. 两个脚本落盘 + package.json 挂载——验证：`npm run book:index` 重建 34 篇索引
2. 修索引揪出的违规（think-report 缺 description）——验证：book:index 退出码 0
3. guideline/AGENTS.md 改真话——验证：全仓搜 `cd code &&` 命令无残留
4. 负向测试：手改 README → release-check 拦；临时文档缺 description → book:index 拦；恢复后全绿
5. eslint + prettier 过 scripts/——验证：`npx eslint scripts/` 干净

## Test plan（Phase 4）

- 正向：book:index 零警告；release-check 全绿
- 负向：索引被手改 → 退出码 1；新文档缺 description → 退出码 1；删除该文档后索引过期 → 退出码 1（新鲜度兜住"报错路径也写盘"的边角）；重跑索引 → 退出码 0
- 静态：eslint、prettier 对 scripts/ 干净

## Done criteria

两条 npm 脚本在仓库根可用且负向路径都拦得住；guideline 与 AGENTS.md 不再引用不存在的路径与 ADR-004；stage/01 追加步骤勾选附结果；原 issue 附跟进（剩余缺口：commit-msg hook、git-policy workflow、dev 分支）。

> 完成记录（2026-10-01）：五步全过。34 篇文档索引零警告、链接全可解析；负向测试 3 条全部按预期拦截；`npx eslint scripts/` + prettier 干净。
