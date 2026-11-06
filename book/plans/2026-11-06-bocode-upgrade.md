---
description: 将中文改编 BoCode 切换为官方原版，同步任务分级、状态索引和升级版本戳，保留项目适配
status: completed
---

# BoCode official upgrade — plan

## Requirements brief

- Background: the installed Chinese fork predates upstream workflow updates and contains conflicting Phase-2 approval wording. The user confirmed the migration report and authorized implementation on 2026-11-06.
- Affects: local four-skill installation, template guidelines and directory READMEs, AGENTS.md, index generator, issue/task status metadata, version stamp, attribution and migration records.
- Does NOT affect: application source or behavior, historical record bodies and file locations, src layout, installer release workflow, architecture/coding guidelines, git history or remote branches.
- Boundaries: original English skills remain byte-identical to upstream; project exceptions live in AGENTS.md and adapted guidelines. Preserve CRLF/Windows and --check behavior. Never infer a resolved issue without disposition evidence.
- Requirement: sync upstream 79426a98a0fbf58d04f3c19a23a6a680343b24f7, install official skill names, add task tiers and status grouping, retain project release conventions and record a reproducible baseline.
- Experience: future sessions find one official skill set, small tasks use the light channel, open work is visible before handled entries, upgrades have an explicit starting SHA.

## Impact range — Phase 1

Local skills → workflow/entry rules → directory templates → index/status validation → generated book index. No application IPC, permissions, notifications or UI changes. Risks: untracked skill installation, destructive overwrite of project adaptations, ambiguous historical status and template-only release gates.

Related lessons read: Windows index path normalization, generated README must not be formatted by Prettier, and zero-dependency scripts need the repository ESLint exception.

## Design — Phase 2

- Tier: L (migration of shared workflow and historical status metadata). The confirmed report supplies scope and authorization; no unresolved design gap remains.
- Back up installed Chinese skills and empty Codex placeholders outside the repository, install official bocode/boscope/book-writeback/bowrite into .agents/skills, remove duplicate old entry points by moving them to the backup.
- Refresh template-owned guidelines and directory READMEs in English. Merge root command paths, src layout, git-log change records and installer publication rules. Keep project records and architecture/coding guidelines.
- Merge upstream status parser and open-first index groups into the local generator; retain CRLF parsing, slash normalization, --check, custom purposes and root paths. Add status only to historical entries that need normalization; record per-file reasoning separately.
- Add an upgrade ADR describing original skill ownership versus project overrides and local-only installation. No runtime interfaces change; permissions/notifications are not needed.
- Validate in isolated temporary fixtures: status grouping, invalid/missing status failures, CRLF, readonly stale checks, cross-platform path handling and existing links. Run lint and book release checks.

## Build order

1. Back up and install skills; compare all four files with pinned upstream.
2. Merge rules/templates and index; classify historical statuses with evidence.
3. Validate, then review without fixing; record findings separately.
4. Write summary/learn, complete plan, stamp upstream SHA, regenerate index.

## Test plan

Normal: official skills identical, all entries indexed once, open before handled. Boundaries: empty group, CRLF, Windows separators, missing/invalid status. Errors: broken links and stale --check fail without rewriting the index. Regression: root commands, custom sections, existing release pipeline and record bodies unchanged. Run npm run lint and npm run book:release-check; application tests are outside this tooling-only change.

## Done criteria

Four official skills verified; old local entry points backed up; all task/issue statuses valid and evidence recorded; index and lint green; project release conventions retained; review findings recorded without fixes; summary/learn/ADR and SHA stamp written; plan completed. No automatic commit or push.

## Execution results

- Phase 3: official skills installed unchanged; template rules and generator merged with project adaptations. Historical status audit covers 68 metadata-only changes.
- Phase 4: four upstream file comparisons pass; isolated fixture checks pass for CRLF, status grouping/flips, empty groups, bad status/descriptions/links, readonly stale/fresh checks and simulated Windows relative paths. Lint and book release checks pass. Application source, workflows, package manifests and architecture/coding guidelines have no diff.
- Phase 5: all eleven checks reviewed. No new runtime, permission, concurrency or scope issue found. One P3 directory-navigation omission was recorded in [the issue](../notes/issue/2026-11/2026-11-06-bocode-directory-navigation.md) and left unfixed; records remain accessible through the master index. No task-tier downgrade occurred.
- Phase 6: summary, lesson, ADR, migration audit and upstream version stamp written; plan completed. No automatic commit/push. Local skill backups reside outside the repository; new sessions must rediscover official skill names.
