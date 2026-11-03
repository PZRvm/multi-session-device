---
description: stage04 基线上 npm run lint 有存量 10 errors / 7 warnings（react-hooks 渲染纪律 + 显式返回类型），全部位于已提交的 scrcpy 与投屏 renderer 文件
---

# stage04 基线 lint 存量未清

- **Observed**: 2026-10-05 图标对齐分支 Phase 4 跑 `npm run lint`：10 errors / 7 warnings，全部在 stage04 已提交文件——`src/main/scrcpy/index.ts` 及其 `__tests__`、`src/renderer/src/components/DeviceCanvas.tsx`、`src/renderer/src/hooks/{useDeviceInput,useDeviceScreen}.ts`。error 类型：react-hooks「Cannot access refs during render」（DeviceCanvas 32、useDeviceInput 57、useDeviceScreen 52）、「setState synchronously within an effect」（DeviceCanvas 48、useDeviceScreen 180）、`explicit-function-return-type`×4、`no-unused-vars`（scrcpy/index.ts:54 `establishTransport` 仅作类型用）；warning 以 `exhaustive-deps` 为主。基分支 4e01b09 上同样 17 个——非新分支引入，是基线欠账。
- **Reproduction**: 任意 worktree `npm run lint`（带 `--cache`，复核基线时先删 `.eslintcache` 免得看旧账）。
- **修复（2026-10-05，已验证）**：渲染纪律类——ref 渲染期写入全部移入 effect（`deviceRef`/`enabledRef`/`layoutRef`，事件都在 commit 后时序等价）；DeviceCanvas 的 layout 从 state+effect 级联改为 `useMemo` 纯派生；useDeviceScreen 的 status/format/error 并入带 `target`（运行中 id:runId）的单源 state、渲染期派生暴露，激活效果只留副作用（信封维护 + IPC），顺带消除了设备切换时迟到回调污染旧状态的面；useDeviceInput 全部 helper `useCallback` 化并补齐依赖数组。机械类——scrcpy 补显式返回类型 ×4、`establishTransport` 改 `typeof import('../transport')` 类型位用法。验证：lint 0 error / 0 warning，typecheck 过，vitest 全量 190 过 5 跳（真机门控），prettier 过。

严重级：已解决（修复随 2026-10-05 图标对齐分支提交；连接状态派生化是行为等价重构，唯一可见差异是设备切换瞬间旧格式不再短暂外显——由 connecting 覆盖层接管）。
