---
description: 修复 scrcpy 拆分 review 的两个存量 issue——ipc.ts 六处入参校验硬编码中文迁移 msg()（新增 5 词条 × zh-CN/zh-TW/en 三语块，zh 文本逐字保持）；项目骨架.md 删掉已落地的 scrcpy/stream.ts【规划】行并在顶部指引补模块拆分快照链接
status: completed
created: 2026-10-13
---

# scrcpy 拆分 review issue 修复 — plan

来源：[issue 2026-10-13-scrcpy-split-review](../notes/issue/2026-10/2026-10-13-scrcpy-split-review.md)（Phase 5 只记录的两项，用户批复修复）。

## Requirements brief — Step 0

- Affects：`src/main/scrcpy/ipc.ts`（6 处 throw 文案）、`src/shared/i18n/errors.ts`（三语块各 +5 词条）、`book/docs/architecture/项目骨架.md`（1 行删除 + 顶部指引 1 句）、issue 文件补已解决记录。
- Does NOT affect：zh-CN 下的错误文本（逐字保持，含 `screen:*:` 前缀——沿字典既有惯例：前缀嵌在词条文本里，如 `retryGenerationStale`）；错误抛出条件与路径；其余 scrcpy 文件；骨架文档其他规划行（emulator 三行的现行布局由顶部指引统一指路，不动行本身）。
- 验证门：`npm run typecheck && npm run lint && npm test`（测试断言 `'非法的入参'` 为子串匹配，zh 缺省不受影响）。

## Design

- 词条命名沿 screen 域惯例（`{通道}{描述}`，前缀在文本）：`activateInvalidPayload` / `activateInvalidId` / `activateInvalidViewToken` / `retryInvalidPayload` / `inputInvalidPayload`；插在各语言块 `retryNoSession` 之后。`ErrorsCopy = keyof typeof zhCN` 保证三语块少补即编译错。
- `项目骨架.md`：删 `src/main/scrcpy/stream.ts`【规划】行（该能力已落地为 `src/main/scrcpy/` 域模块）；顶部「实现现状已由 …取代」句补 main 模块拆分两快照链接。

## 实施结果（2026-10-13）

一次到位：errors.ts 三语块各 +5 词条（`ErrorsCopy` 类型强制 parity）；ipc.ts 六处 throw 迁 `msg()`，zh-CN 文本逐字保持；骨架删过期规划行、顶部指引补拆分快照链接。typecheck / lint / 1139 项测试全过。详见 issue 文件「已解决」段。
