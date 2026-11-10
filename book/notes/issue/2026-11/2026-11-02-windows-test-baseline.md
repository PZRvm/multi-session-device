---
status: open
description: Windows 图标替换前的全量测试已有 153 项失败，涉及平台假设、路径、符号链接与权限，未在本任务修复
---

# Windows 全量测试基线未通过

- 观察：2026-11-02，在图标资源和源码替换前运行 `npm test -- --maxWorkers=2`，结果为 153 failed、1269 passed、12 skipped；文件统计 29 failed、86 passed、3 skipped，另有 4 个未处理错误。该次运行在修改前启动，不作为本次图标改动的失败结论。
- 复现：在 Windows 仓库根执行上述命令。
- 样本：`devices/create.test.ts` 的 arm64 镜像夹具在 win32 被兼容性检查拒绝；`store.test.ts` 的 chmod/rename 行为与断言不符；`sdkPaths`、迁移、Studio 探测等包含 macOS 路径预期；多项符号链接测试失败。尚未逐项归因。
- 建议方向：另立 Windows 测试兼容任务，区分夹具平台假设与真实实现问题。本次未改这些实现或断言。

本次图标相关的 `SettingsWindow.test.tsx`、`quit-confirm.test.ts`、录屏 `prompts.test.ts` 在替换后 21 项通过；构建、类型检查、lint、Windows 目录打包与 NativeImage 资源检查通过。

## 顶部适配扩展回归（2026-11-02）

顶部适配工作区执行 12 个相关测试文件，149 项中 148 项通过。唯一失败在 `src/main/theme/__tests__/store.test.ts:56`：预期 `/userdata/theme.json.tmp`，实际为 Windows 的 `\userdata\theme.json.tmp`。同一单文件测试在未修改的 dev 上复现（7 过、1 失败），属于测试路径平台假设，不是顶部样式回归。本轮未修改该文件。
