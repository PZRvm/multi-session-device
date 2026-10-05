---
description: 基线 4e01b09 自带 10 个 eslint error（scrcpy 测试与 index 的显式返回类型、renderer 的 react-hooks refs/setState 纪律）与 7 个 warning；icon-alignment 分支已在修 renderer 部分，合流时注意别互相覆盖
tags: [lint, baseline, react-hooks, scrcpy]
---

# 基线提交自带 10 个 lint error

- **问题**: `feature/stage04-emulator-integration` 基线（4e01b09）上 `npm run lint` 即有 10 error / 若干 warning，非新分支引入：
  - `src/main/scrcpy/__tests__/cache.test.ts`、`index.test.ts`、`smoke.real.stream.test.ts`、`src/main/scrcpy/index.ts`——`explicit-function-return-type` 与一处 only-used-as-type；
  - `src/renderer/src/components/DeviceCanvas.tsx`（渲染期写 ref、effect 内同步 setState）、`hooks/useDeviceInput.ts`（渲染期写 ref）、`hooks/useDeviceScreen.ts`（同前两条）——react-hooks 新版 refs/setState 纪律。
- **复现**: 在任何未改这些文件的 worktree（如刚检出 4e01b09）直接 `npm run lint`。注意对比基线时别拿 icon-alignment worktree 当参照——那个分支上有未提交的重构已把 renderer 部分修掉，会误判"基线是干净的"。
- **建议方向**: renderer 侧的 refs/setState 与该分支 `feature/device-action-icon-alignment` 的重构方向一致（ref 更新移入 effect、状态单源合并），等它合流后再统一清理剩余；scrcpy 的返回类型是机械补注。外框分支（frame-and-canvas）已保持零新增 error。
