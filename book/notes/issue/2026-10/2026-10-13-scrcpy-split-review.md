---
status: resolved
description: scrcpy 拆分 review 发现（只记录不修复）——ipc.ts 部分入参校验文案是硬编码中文未走 msg() i18n；项目骨架.md 仍留着从未落地的 scrcpy/stream.ts【规划】行
created: 2026-10-13
tags: [i18n, 文档过期, scrcpy, review]
---

# scrcpy 拆分 review 发现（2026-10-13）

**发现**：[scrcpy 模块拆分](../../../plans/2026-10-13-scrcpy-module-split.md) Phase 5 review 时发现两处存量问题，均先于拆分存在、按「只记录不修复」规则未动：

1. **`src/main/scrcpy/ipc.ts`（原 index.ts）入参校验文案 i18n 不一致**：`screenActivate`/`screenRetry`/`screenInput` 的入参校验错误是硬编码中文字符串（如 `'screen:activate: 非法的入参'`），而同文件其余错误路径（`inputStale`、`screenSessionNotReady` 等）都走 `msg()`。renderer 侧用户可见的主要是状态推送里的 `error` 字段（已 i18n），这些 throw 的文案大多数只进日志/开发者控制台，影响有限。
2. **`book/docs/architecture/项目骨架.md` 有过期规划行**：`src/main/scrcpy/stream.ts`【规划】从未按此名落地（实际演化成 scrcpy 目录多文件），该行一直未更新。

**建议方向**：

1. 若要做 scrcpy 域的 i18n 收口，把这批硬编码串迁 `locale` 并补 en 词条即可，改动集中在 ipc.ts 三个 handler 头部。
2. 项目骨架.md 的 scrcpy 段可直接指向 [2026-10-13 scrcpy 拆分快照](../../../docs/architecture/2026-10-13-scrcpy-module-split.md)，删掉【规划】行。

**已解决（2026-10-13）**：用户批复修复，plan 见 [2026-10-13-scrcpy-split-review-fixes](../../../plans/2026-10-13-scrcpy-split-review-fixes.md)。

1. `ipc.ts` 六处 throw 全部迁 `msg()`：新增 `activateInvalidPayload` / `activateInvalidId` / `activateInvalidViewToken` / `retryInvalidPayload` / `inputInvalidPayload` 五词条，zh-CN / zh-TW / en 三语块各补齐（前缀沿字典惯例嵌在词条文本里）；zh-CN 文本逐字保持，行为零变化。
2. `项目骨架.md` 删除 `src/main/scrcpy/stream.ts`【规划】行，顶部「实现现状」指引补 main 模块拆分两快照链接（emulator 三行的现行布局同由此指路，行本身未动）。

typecheck / lint / 全量 1139 项测试保持通过。
