---
description: stage04 基线上 npm run lint 有存量 10 errors / 7 warnings（react-hooks 渲染纪律 + 显式返回类型），全部位于已提交的 scrcpy 与投屏 renderer 文件
---

# stage04 基线 lint 存量未清

- **Observed**: 2026-10-05 图标对齐分支 Phase 4 跑 `npm run lint`：10 errors / 7 warnings，全部在 stage04 已提交文件——`src/main/scrcpy/index.ts` 及其 `__tests__`、`src/renderer/src/components/DeviceCanvas.tsx`、`src/renderer/src/hooks/{useDeviceInput,useDeviceScreen}.ts`。error 类型：react-hooks「Cannot access refs during render」（DeviceCanvas 32、useDeviceInput 57、useDeviceScreen 52）、「setState synchronously within an effect」（DeviceCanvas 48、useDeviceScreen 180）、`explicit-function-return-type`×4、`no-unused-vars`（scrcpy/index.ts:54 `establishTransport` 仅作类型用）；warning 以 `exhaustive-deps` 为主。基分支 4e01b09 上同样 17 个——非新分支引入，是基线欠账。
- **Reproduction**: 任意 worktree `npm run lint`（带 `--cache`，复核基线时先删 `.eslintcache` 免得看旧账）。
- **Suggested direction**: react-hooks 两条 error 触在投屏渲染路径的 ref/render 纪律上，修法要人判（提 state、调 effect 时序或明志豁免），不宜顺手改；return type / unused 属机械修。建议 stage04 收尾清单加一行「lint 清零」再转正，否则全量红会淹没后续改动的真信号。

严重级：P2（两个 set-state-in-effect 可能是真实的级联渲染隐患，且 lint 全量红持续劣化信噪比）。
