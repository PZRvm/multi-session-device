---
description: fixtures README 格式基线问题已解决——对账提交中格式化，全仓 prettier --check 复验退出码 0
tags: [prettier, baseline, fixtures]
status: resolved
---

# 测试资料 README 的既有格式问题

> 开放项已并入 [待修问题清单](../../task/2026-10-09-待修问题清单.md)追踪；本文仅作证据存档。

- 观察：2026-10-07 旋转修复验收执行 npx prettier --check src，唯一警告为 src/main/emulator/**tests**/fixtures/README.md；npm run lint 通过。
- 证据：用 git show HEAD:src/main/emulator/**tests**/fixtures/README.md 读取提交版本，再用 prettier.resolveConfig 和 prettier.check 按仓库配置检查，结果 false。工作区该文件未改动，问题来自基线。
- 影响：全仓格式关卡退出码 1；本次 scrcpy 修改的四个文件单独检查通过。
- 建议：单独格式化这份资料文档。本次只记录，未修改。

## 2026-10-09 复验关闭

问题已解决，非本轮修复：README 在对账提交 65c3674 中被格式化，2026-10-09 复验 `npx prettier --check src` 退出码 0，格式关卡不再被阻断。
