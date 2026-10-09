---
description: P2：设置窗就绪后 renderer 崩溃未释放单例，主窗齿轮再次打开只聚焦故障窗；静态前端 review 发现，待独立修复
status: open
priority: P2
tags: [electron, settings, window, lifecycle, crash, review]
created: 2026-10-10
---

# 设置窗就绪后崩溃无法重建

## 问题

`src/main/window/settings.ts:54` 的 `fail()` 在 `session.settled` 后直接返回。`ready-to-show` 已调用 `settle()`，因此后续 `render-process-gone` 不会释放 `settingsSession` 或销毁故障窗口。再次调用 open 时，只会聚焦原窗口。

此项来自 [静态前端 plan](../../../plans/2026-10-09-settings-frontend.md) 的 Phase 5 独立 review，评级 P2。正常布局、分类切换、关闭与重开已通过；故障发生在窗口就绪后的渲染进程退出路径。

## 复现路径

1. 打开设置窗，触发 `ready-to-show`，开窗 Promise 正常完成。
2. 触发该窗 WebContents 的 `render-process-gone`，BrowserWindow 本身仍存活。
3. 从主窗再次调用 settings open。
4. 当前结果：沿用已完成的 Promise 并调用旧窗 focus；期望：清理故障窗，下次 open 创建新窗口。

现有窗口测试覆盖加载前 renderer 故障，未覆盖 `ready → gone → open`。该遗漏不能由加载前故障断言代替。

## 建议方向

区分「开窗 Promise 已结算」与「窗口仍可用」；加载前保留拒绝/提示语义，加载后故障也需要清理本代窗口与单例，旧代事件不得释放新代。补充就绪后崩溃再打开的生命周期测试。

按仓库 workflow 的 Phase 5「只记录，不修复」，本轮未改这条故障路径，留给独立修复任务。
