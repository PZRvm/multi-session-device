# AGENTS.md

Entry rules for AI agents working on multi-session-device. Humans start at `book/README.md`.

## Project and layout

This is an Electron application using electron-vite, React and TypeScript. Source lives in root `src/`; the BoCode template's `code/` layout is adapted to Electron conventions.

- `book/`: guidelines, architecture/API/ADR records, plans, and notes (summary, learn, issue, task, think-report).
- `book/README.md`: generated master index; never edit it by hand.
- `scripts/`: zero-dependency book tools. Run every npm command at the repository root.

## Workflow and task tiers

Grade tasks S/M/L before Step 0, per `book/guidelines/task-tiers.md`. Record the tier and why/how verified in the first commit's motive. S uses the light channel; M/L use the complete workflow.

- M/L require a structured Step-0 requirements brief before code, with background, scope, exclusions and requirements filled.
- M/L never skip phases. Read the corresponding plan and `book/guidelines/workflow.md` before changing code. Summary archives describe completed work, not active tasks.
- Phase 2 proceeds once the design is complete. Stop only for a real gap: scope conflict, undetermined data shape or unclear external dependency; never just for confirmation.
- Phase 5/6 findings are recorded in issues, never fixed in passing.
- Feature work stays inside scope: no opportunistic refactoring or new abstractions.

## Writeback

For completed M/L work:

1. Write `book/notes/summary/YYYY-MM/`: background, changes, reasons, outcome and follow-ups (see book-writeback).
2. Write lessons in `book/notes/learn/`; record deliberately unfixed problems in `book/notes/issue/`.
3. Mark the corresponding plan `completed`. Flip handled task/issue status only with disposition evidence: task `open|done`, issue `open|resolved`. Partial fixes or monitoring stay open. Files never move for status archiving.
4. Run `npm run book:index` after any book edit. New directories/classifications also need a purpose in `scripts/gen-book-index.mjs`.

S owes its motive, honest self-test and single-purpose commit; no brief, plan, summary or learn search. This project uses git log as its change record at every tier; `book/changelogs/` is not enabled.

## Official skills and project overrides

The four official English skills live in `.agents/skills/{bocode,boscope,book-writeback,bowrite}/`. Keep their upstream text intact; project adaptations belong here and in guidelines. Skill directories are locally installed and ignored by Git.

- `code/` means this repository's source area (`src/`), and `cd code && npm run …` means run `npm run …` at the repository root.
- Git log replaces separate changelog entries, including in S-tier and writeback instructions.
- Historical Chinese documents and project ADRs retain their original language and evidence. Current workflow rules come from this file and current guidelines.
- The official book-writeback issue template currently omits status: include `status: open`, as required by `book/notes/README.md` and the index.
- Upstream ADR numbers refer to the BoCode repository; do not resolve them against local same-number ADRs.

## Default safety

One-shot local commands do not touch production: npm scripts, tests, builds, git status/diff/log, book:index and commit-subject validation are preauthorized. Run them, fix failures within scope, and rerun. Production data/credentials, destructive operations and every push to main remain human-controlled; never push directly to main.

## Staying current

`.bocode-version` pins the last synchronized upstream commit. For upgrades read BoCode's [UPGRADE.md](https://github.com/Focus695/BoCode/blob/dev/UPGRADE.md) and CHANGELOG.md, refresh template-owned files by merging project adaptations, preserve project-owned records, verify the index, then update the SHA. Back up ignored local skills before replacement. Do not import template-only cleanliness or release-changelog gates into this application repository.

## Tooling

- `npm run book:index`: regenerate the index; missing descriptions, invalid task/issue status or broken links fail.
- `npm run book:release-check`: tracked OS junk + read-only index freshness/validity check.
- `node scripts/check-commit-message.mjs "<subject>"`: validate Clean Commit format.
- Application installer publication stays on the existing same-repository dev→main merged-PR workflow; see `book/guidelines/git-workflow.md`.
