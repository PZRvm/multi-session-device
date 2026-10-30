---
description: Windows 真机 npm test 全套 153 失败（基线 160）——测试夹具的 mac 平台假设经 process.platform 泄漏，产品代码 Windows 分支行为正确；裁决不修，mac 全绿为门禁口径
---

# Windows 真机跑全套测试：平台假设失败清单（裁决不修）

- **现象**（2026-10-30，Windows 真机，feature/windows-settings-finish @ da14795 + 真机前置批）：`npm run typecheck` / `npm run lint` 0 错 0 警；`npm test` 32 文件 160 用例失败（1243 过 / 6 skip）。profiles 修复批后为 153 失败（1252 过 / 7 skip，零新增；另有 4 例 external/logcat/wizard 计时敏感偶发本轮恰好通过——P4 施工时已记录过 external 域偶发）。
- **根因**：不是产品缺陷——产品代码按 `process.platform` 正确走 win32 分支，用例按 darwin 假设写死夹具与断言。三类形态：
  1. **ABI 守卫拦截 arm64 夹具（约 53 处，最大头）**：create/lifecycle/edit 等域夹具镜像为 `arm64-v8a`，win32 下 P5 的 `hostImageAbi` 守卫正确抛「跨架构镜像（arm64-v8a）不支持——Windows 需 x86_64」，测试想验的后续场景（如 `'boom'`、`'画像未知'`）没走到——守卫是 P5 按设计工作。
  2. **检测链 darwin 剧本（studioDetect 13 处等）**：期望 `/Applications` 扫描命中、mdfind 兜底生效、产出 `/Users/tester/...` 路径——win32 分支按设计走 Program Files / `%APPDATA%` 链，mdfind 在 win 分支不可达。
  3. **文件系统差异（sdkSourceSwitch 30 处等）**：源根扫描的 marker/路径分隔符假设使 `planMigration` 预检在 win32 提前落 `empty-source`（期望的是 `journal-pending` / `target-junk` / `fs-unsupported`）；store 的 chmod→rename 用例错误码与失败时机不同（EPERM 出现在不同阶段、文案不同）。
- **不修的理由**：门禁口径是「单测都在 mac 上跑，全绿为准」（[todos](../../../todos/windows-support.md) 备注），分支在 mac 上全绿；不在 Windows 长期开发，无人定期在 Windows 跑套件，这个红只在真机验收现场出现；修复约一天、动 30+ 测试文件，对真机行为零改善。Windows 上的验收门禁 = typecheck/lint 0 错 + 通过的用例（已含全部 win32 专属分支）+ 真机手动剧本。
- **若将来在 Windows 长期开发**：开独立「测试平台中立化」批次——夹具钉平台注入或换 x86_64 夹具、studioDetect 的 darwin 用例显式走 `Deps.platform` 接缝、排查 sdkSourceSwitch 的路径假设；本清单即底稿。
