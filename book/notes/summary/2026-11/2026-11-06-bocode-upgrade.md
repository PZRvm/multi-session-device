---
description: BoCode 已切换到 79426a9 官方英文四技能，同步任务分级及状态索引，保留项目布局和发布约定，目录导航一项 P3 待补
---

# BoCode official upgrade — summary

- **Background**: the installed Chinese fork had fallen behind upstream; its boscope approval rule also conflicted with this project's real-gap rule. The user confirmed switching to official English templates while keeping project conventions and Chinese records.
- **What was done**: installed official `bocode`, `boscope`, `book-writeback`, `bowrite` locally, byte-identical to upstream `79426a98a0fbf58d04f3c19a23a6a680343b24f7`. Refreshed guidelines and directory templates, added S/M/L tiers, upgraded open-first task/issue indexing, and introduced `.bocode-version`. Root commands, src layout, git-log change records, installer publication, Windows slash handling, CRLF and readonly `--check` remain in place.
- **Why these choices**: original skill text makes future diffs direct; project exceptions live in AGENTS.md/guidelines. Template-only cleanliness and release-changelog gates do not belong in an application repository.
- **Outcome**: 68 historical entries received status-only changes; their bodies and locations are unchanged. Of those, 36 classify as resolved, 1 as done and 31 as open; the other 57 already-valid entries remain untouched. Per-entry evidence is in the [migration audit](../../../docs/poc/2026-11-06-bocode-status-migration.md). Four skill comparisons, lint, index/release checks and diff whitespace checks pass. Isolated fixtures cover grouping, status flips, empty groups, invalid/missing status, invalid descriptions/links, CRLF, simulated Windows paths and fresh/stale readonly checks. No application code or release workflow changed; application tests were not rerun.
- **Follow-ups**: review found one [P3 directory navigation omission](../../issue/2026-11/2026-11-06-bocode-directory-navigation.md), recorded without fixing. Local skills are Git-ignored and do not travel with a clone; start a new session to load the official names. Old skills and empty Codex placeholders are backed up in `/Users/pangzerui/.codex/backups/multi-session-device/20261106131505`.

The [plan](../../../plans/2026-11-06-bocode-upgrade.md) and [ADR-006](../../../docs/decisions/ADR-006-sync-official-bocode.md) record the scope and active ownership rules. No commit or push was performed.
