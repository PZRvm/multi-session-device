---
description: DeviceWizard.tsx:458 存量 lint error——react-hooks 规则报 effect 内同步 setState 可触发级联渲染；dev 基线即有，非断网开关批引入
created: 2026-10-12
status: closed
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

## 处置记录（2026-10-12，用户批准修复）

- 修法：同文件 391–397 行已有同规则豁免先例（能力装载重置的「依赖驱动的同步重置不构成级联」口径），本处同款——`eslint-disable-next-line react-hooks/set-state-in-effect` + 注释写明「写入即停：置入后 `image !== null` 条件翻转，下一 render 依赖不再变化」。
- **不改渲染期派生的理由**（与截图批 learn 的派生先例刻意区分）：自动选中必须写状态才能在共享态条件消失（来源切走、清单变化超出单镜像）时**保持**已选中的镜像；纯派生会让选择随条件消失而丢失，语义错误。
- 验证：lint 全仓 0 error 0 warning；DeviceWizard 41 项测试通过；无行为变化（仅注释与豁免标记）。
- 状态：resolved（lint 语义恢复 CI 绿）。
