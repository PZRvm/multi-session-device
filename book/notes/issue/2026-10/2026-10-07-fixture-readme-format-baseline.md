---
description: 全仓 src 格式检查被既有 emulator 测试资料 README 阻断，本次旋转修复的四个代码文件格式通过
tags: [prettier, baseline, fixtures]
---

# 测试资料 README 的既有格式问题

- 观察：2026-10-07 旋转修复验收执行 npx prettier --check src，唯一警告为 src/main/emulator/**tests**/fixtures/README.md；npm run lint 通过。
- 证据：用 git show HEAD:src/main/emulator/**tests**/fixtures/README.md 读取提交版本，再用 prettier.resolveConfig 和 prettier.check 按仓库配置检查，结果 false。工作区该文件未改动，问题来自基线。
- 影响：全仓格式关卡退出码 1；本次 scrcpy 修改的四个文件单独检查通过。
- 建议：单独格式化这份资料文档。本次只记录，未修改。
