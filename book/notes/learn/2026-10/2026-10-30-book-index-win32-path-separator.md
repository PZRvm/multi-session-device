---
description: 零依赖 Node 脚本里凡是要产出「跨平台一致的文本」（索引、清单、模板），path.relative/join 的结果必须先归一为正斜杠——win32 的反斜杠会击穿按 'a/b' 写死的键匹配与 split('/')
created: 2026-10-30
tags: [windows, nodejs, path, book-infra]
---

# book:index 在 win32 把索引写坏了——relative() 的反斜杠

## 规则

- **产出跨平台一致文本前，先把路径归一成正斜杠**：`relative()`/`join()` 在 win32 产 `\` 分隔符，凡下游有「按 `a/b` 形态写死的键」（本例 `DIR_PURPOSE` 表）或 `rel.split('/').pop()`（本例截文件名）的逻辑，反斜杠全部击穿——症状是目录用途全空、名字带全路径。一行修复：`relative(a, b).split('\\').join('/')`。`dirname()` 对正斜杠串在两个平台行为一致，归一一次即可全链安全。
- **生成物脚本的跨平台性要靠真机暴露**：`gen-book-index.mjs` 在 mac 上跑了两个月零问题，首次在 Windows 真机重生成即写坏 README（目录表 ±350 行）——「生成物勿手改」的前提是生成器本身可信，跨平台工具第一次在新平台跑，先 `--check`（本脚本有只校验模式）或 diff 生成物再落盘。

## 适用条件

- 零依赖 `.mjs` 工具脚本（不能用 path.posix 的场景：输入本身可能是混合分隔符）；任何按路径字符串做前缀匹配 / split 的代码。
- 修复落点：`scripts/gen-book-index.mjs` 的 `rel` 归一（2026-10-30，feature/windows-settings-finish）；修复后 win32 重生成与 mac 版逐字节一致（仅新增条目与计数差异）。
