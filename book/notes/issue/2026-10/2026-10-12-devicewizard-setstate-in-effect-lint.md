---
description: DeviceWizard.tsx:458 存量 lint error——react-hooks 规则报 effect 内同步 setState 可触发级联渲染；dev 基线即有，非断网开关批引入
created: 2026-10-12
status: open
---

# DeviceWizard effect 内同步 setState（存量 lint error）

## 问题

`src/renderer/src/components/DeviceWizard.tsx:458`：eslint（react-hooks 新规则）报 error「Calling setState synchronously within an effect can trigger cascading renders」。`npm run lint` 全仓唯一 error，导致 CI 语义上的 lint 不绿。

## 复现

主仓库 dev 与 feature/network-switch-group worktree 均 `npm run lint` → `✖ 1 problem (1 error, 0 warnings)`。

## 建议

- 按既有先例改渲染期派生（镜像 useScreenshot 的 `device.status === 'running' ? latched : idle` 模式）或把派生下沉 useMemo；
- 与 boardhead-toggle 批的 matchMedia 下沉 `theme/usePrefersDark` 同思路，具体方案看该 effect 实际派生什么再定。

## 备注

- 2026-10-12 断网开关批（feature/network-switch-group）Phase 5 自审时发现：本批未触碰该文件，dev 基线复跑确认存量。按 workflow 只记录不顺手修。
