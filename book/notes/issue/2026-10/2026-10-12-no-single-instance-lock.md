---
status: resolved
description: 全仓库缺 requestSingleInstanceLock——主仓库与 worktree 的 dev 构建同包名共享同一 userData，双实例并行互踩 devices.json/avd-home（删除被复活、互相触发冻结）
created: 2026-10-12
tags: [electron, single-instance, worktree, dev-workflow, data-safety]
---

# 无单实例锁：多构建并行共享 userData 互踩

来源：出身标注批验收期排障（用户三连报障的调查副产品，learn
[2026-10-12-persistent-field-store-projection-checklist §4](../../learn/2026-10/2026-10-12-persistent-field-store-projection-checklist.md)）
——当日主因是 store 投影 bug，但排障过程证实本隐患真实存在。

## 问题

`app.requestSingleInstanceLock()` 全仓库未调用。主仓库与 worktree 的 dev 构建
`package.json` 同名 → Electron `userData` 解析为同一目录
（`~/Library/Application Support/multi-session-device`）。create-worktree 只隔离了
渲染端口（6174/6175），没隔离数据目录。两个实例并行时：

- 各自内存态 devices 快照互不知情——A 删除的设备被 B 的下一次提交复活；
- 一侧的 devices.json 重写覆盖另一侧的在途写入；
- 单侧重查/切换触发的冻结态对另一侧表现为「无故只读」。

## 复现

主仓库 `npm run dev` 与 worktree `MSD_DEV_PORT=6175 npm run dev` 同时运行，
在两个窗口里交替删除/创建设备，观察 devices.json 内容抖动与行复活。

## 建议方向

1. `app.whenReady` 前调 `requestSingleInstanceLock()`，未拿到锁即 `app.quit()`
   并聚焦已有实例（Electron 标准做法，second-instance 事件）。
2. 可选加固：dev 模式按 `MSD_DEV_PORT` 派生 `app.setPath('userData', …)` 后缀，
   让 worktree 数据天然隔离（注意共享真实数据的验收场景需显式关掉该隔离）。
3. create-worktree skill 文档补一句提醒：端口隔离 ≠ 数据隔离。

优先级 P2（单人开发纪律可暂代，接入 CI/多终端即必修）。
