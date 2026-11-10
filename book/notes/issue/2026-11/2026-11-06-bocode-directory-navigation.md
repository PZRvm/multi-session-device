---
description: BoCode 原版升级的目录 README 少了项目专属 PRD、录屏接口和架构快照入口，文档本身与总索引仍完整
status: open
---

# P3: Restore project-specific directory navigation after the BoCode refresh

- **Observed**: Phase-5 review of the 2026-11-06 upgrade found that replacing directory templates omitted project-specific navigation: the PRD row in `book/docs/README.md`, the recording IPC link in `book/docs/api/README.md`, and the Android runtime/module-split/recording/project-skeleton links in `book/docs/architecture/README.md`.
- **Reproduction**: compare these three files with dev HEAD `7cc1a2e`. The records themselves remain unchanged and reachable through the generated master index, so this is a navigation regression, not lost documentation or an application failure.
- **Suggested direction**: in a separate repair round, merge those project-specific entries back into the English directory templates and regenerate the index. Do not rewrite the underlying Chinese records.
- **Disposition**: recorded without fixing, as required in Phase 5. This is the only new review finding for the migration.
