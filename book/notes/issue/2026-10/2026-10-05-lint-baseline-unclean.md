---
description: npm run lint 存量 17 项未清（10 errors / 7 warnings）——react-hooks/set-state-in-effect 为主，集中在 DeviceCanvas 等既有效应
---

# lint 基线存量 17 项未清

- **Observed**: 2026-10-05 清单加载反馈收尾时盘点：`npm run lint` 常态报 17 项（10 errors、7 warnings），主体是新版 react-hooks 的 `set-state-in-effect`（DeviceCanvas 等既有效应里同步 setState），另有少量 prettier 告警。本轮改动零新增（实现中把「effect 清选」改成渲染期派生正是为了不添新项），但基线本身没清。
- **Reproduction**: 任意时点在仓库根跑 `npm run lint`。
- **Suggested direction**: 单独排一轮：逐条判断是改写（派生化 / 事件回调化）还是豁免（有意的首挂载副作用），清完把「lint 全绿」纳入收尾关卡口径；涉及行为等价性验证，不宜顺手修。

严重级：P3（不阻塞功能，但关卡口径长期带着「已知 17 项」会钝化增量警觉）。

## 跟进（2026-10-05）——已修

与本 issue 记录同日，投屏画布会话在 stage04 直接提交 `3f0a977`（🔧 update (screen): 清 lint 存量 17 项——ref 写入移出渲染、layout 与连接状态改派生、输入回调 useCallback 化）清空全部存量；合并 wizard 分支后主仓复验 `npm run lint` 零输出。与姊妹 issue [baseline-lint-errors-stage04-files](2026-10-05-baseline-lint-errors-stage04-files.md) 记录的是同一批问题，以那边为准。
