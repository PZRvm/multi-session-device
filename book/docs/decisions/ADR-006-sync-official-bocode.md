---
description: 使用官方英文 BoCode skills 并以 SHA 跟踪升级，项目路径、发布机制与中文历史记录保持独立
---

# ADR-006: Sync official BoCode with explicit project adaptations

## Status

Accepted — 2026-11-06. The user confirmed the [migration report](../../notes/think-report/20261106131053-BoCode原版升级.md). Earlier ADRs remain historical records; this decision and current AGENTS.md/guidelines describe the active installation.

## Context

The Chinese skill fork had diverged from both upstream and this project's own Phase-2 rule. Upstream now supplies task tiers, status-based task/issue indexing, stronger writing rules and an upgrade procedure. Copying the whole template would lose Windows index fixes and application-specific release conventions.

## Decision

Install the official English `bocode`, `boscope`, `book-writeback` and `bowrite` skills unchanged. Refresh template rules and tools by merging project adaptations, and pin the synchronized upstream SHA in `.bocode-version`. Follow upstream UPGRADE.md for later upgrades.

Keep root `src/`, root npm commands, git-log change records and the existing installer publication workflow. Put those adaptations in AGENTS.md and guidelines rather than editing skills. Preserve project architecture/coding guidelines, Chinese historical records and file locations. Task/issue archiving changes frontmatter status, never location; migration evidence is [recorded per entry](../poc/2026-11-06-bocode-status-migration.md).

## Consequences

- Official skills can be compared directly with the pinned upstream files. Old translated skills and empty Codex placeholders are backed up outside the repository.
- Skills remain a local installation under ignored `.agents/skills/`; a Git clone alone does not install them. New agent sessions must rediscover the skill names.
- Project-specific script changes (Windows separators, CRLF, read-only index checks and root layout) must survive future upgrades.
- The official writeback issue template lacks status at this baseline; AGENTS.md and the local notes template explicitly require `status: open`.
- Upstream ADR references describe upstream decisions; local same-number ADRs are separate records. No template-only release gate is installed.
