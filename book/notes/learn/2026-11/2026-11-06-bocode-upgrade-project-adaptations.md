---
description: 升级 BoCode 时保持四技能原文，把根路径、Git log 和状态模板差异写入项目规则，索引脚本必须合并而非覆盖
tags: [bocode, upgrade, skills, book-index, windows, crlf, status]
---

# BoCode upgrades need an upstream baseline and explicit project adaptations

- **Scenario**: replacing a localized BoCode fork with official skills while keeping a root-layout Electron application.
- **Why**: upstream index defaults assume `code/`, lack this project's `--check` mode and Windows/CRLF fixes, and now require task/issue status. The official writeback issue template at 79426a9 also omits status even though notes/README and the index require it.
- **How to apply**: pin the upstream SHA in `.bocode-version`; keep original skill text unchanged; put root commands, git-log change records and `status: open` in AGENTS.md. Merge the generator, verify CRLF and simulated Windows relative paths, and compare historical records with status lines removed. Keep partial fixes and monitoring open, with per-record disposition evidence.
- **Installation**: `.agents/skills/` is ignored by Git. Back it up before replacement; local installation does not distribute skills to another clone, and a new session must discover renamed skills.
