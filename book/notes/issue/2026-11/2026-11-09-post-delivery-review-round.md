---
status: resolved
description: 休眠交付后六轮追加提交（GPU 默认/缺陷修复/Popover UI×4）的结构化代码评审：发现 7 项记录待办，无阻断性缺陷
created: 2026-11-09
tags: [review, hibernation, popover, gpu, record-only]
---

# 追加提交评审轮（47606ca..HEAD，record-only）

依据 boscope Phase 5 与 `book/guidelines/review-checklist.md` 十一项。范围：
`567235a`（GPU 默认）、`f72e2a2`（自删快照/ack/dev 锁三修）、`16538a4`/`4ecea69`/
`b32723b`/`1ba618e`（Popover UI 四轮），22 文件 +769/−265。前轮评审见
2026-11-06-hibernation-review-round.md（其 P1/P2/P3 仍 open）。

## 十一项核查结论

- 重复代码：无生产代码重复（smoke 测试内 cold/resume runner 配置重复，测试域可接受）。
- 鉴权/权限洞：三新通道均 requireSender('main') + 载荷守卫；dev 锁回退仅
  !app.isPackaged 生效，安装版语义不变 ✓。
- 竞态：quit 失败保留 entry 且 phase 回 running（可正常 stop）；hibernate/stop/
  delete 与在途 flight 互斥；prepareAppShutdown 先于 flight 收口映射 stopped，
  flight 迟到 catch 因 status≠hibernating 不抢写 ✓（saved 级清单留扫描投影=正确语义）。
- 事务边界：快照删除仅发生在进程不在窗口（hibernate 提交后 keep=本次、discard、
  进程亡记账路径）；恢复后清单消费只删清单 ✓——自删缺陷已有真机回归层。
- 漏通知：port-anomaly/中断/损坏均有 lastError 或行内提示 ✓。
- 边界：i18n 三语 parity 由类型锁定；空/极端（损坏清单、半写、遗留进程）有测试 ✓。
- 复杂度：PopoverIconButton 单组件承载 button/busy/pressed/className 四态，
  行内 13 处调用声明式复用，可控。
- 无需求来源的部分：无（spawn error 监听来自本轮取证发现的静默死亡缺陷）。
- 体验缝：短词气泡+禁用原因辅行、能力关闭原因、复制序列号全本地化 ✓。
- 越界：diff 逐文件核对全部可追溯到提交所述目的，无 scope drift。
- 分级：四个 UI 轮按 S 轻通道单目的提交（含动机与自测）符合 tier 规则；
  修复轮在 L 计划伞下，无降级逃逸。

## 发现（记录待办，不在本轮修）

| # | 级 | 发现 | 位置 |
| --- | --- | --- | --- |
| R1 | P2 | LogcatPanel 内部三按钮（暂停/恢复、清空、弹出独立窗）仍原生 title——用户要求「logcat 按钮也要 popover」只覆盖了主入口 logToggle | LogcatPanel.tsx:65-84 |
| R2 | P2 | spawn 失败（'error' 无后续 'close'）仅记日志，boot 等待需耗满 BOOT_TIMEOUT 240s 才以超时收口——慢失败路径；error 时应主动走失败收口短路 | runner.ts:378 |
| R3 | P2 | settings-contract 非法 graphics 回退仍 'auto'，与 darwin 新默认 host 不一致（伪造载荷路径的回退值漂移） | settings-contract.ts:244 |
| R4 | P3 | PopoverIconButton 视口钳制用固定半宽 90px，而气泡 max-width 240px（半宽可达 120px）——长辅行在窄边距仍可能被裁；应按实测宽度钳制 | PopoverIconButton.tsx |
| R5 | P3 | 迟到的 screenInput（非 ack）在会话拆除窗口仍以 inputStale 抛错进控制台——与 ack 同理可静默容忍 | scrcpy/ipc.ts screenInput |
| R6 | P3 | 英文动词不一致：行内停止 'Shut down' vs 工具条电源 'Power off device'（两动作不同但措辞需统一审视）；zh 均为「关闭」系 | mainWindow.ts |
| R7 | P3 | 两个无 MSD_DEV_PORT 的 dev 实例共享 'default' 后缀目录，第二个仍被拒（有日志说明，可接受）；busy 槽气泡未挂 aria-describedby（aria-label 已承载语义） | main/index.ts / PopoverIconButton |

## 2026-11-09 处置（修复轮，R1–R7 全部落地）

- R1 ✓ LogcatPanel 三按钮迁移 PopoverIconButton（bar-btn 体系保留，暂停键带 pressed）
- R2 ✓ runner spawn 'error' 经 entry.spawnFailure 短路 boot 等待，不再耗满 240s
- R3 ✓ settings-contract 非法 graphics 回退改为 capabilities.defaults.graphics 同源
- R4 ✓ 气泡按实测宽度钳制视口（useLayoutEffect 测量）
- R5 ✓ screenInput 拆除窗口静默丢弃（与 ack 同口径）；requireReadySession 死代码删除；
  守卫测试改为断言静默
- R6 ✓ EN powerOff 统一为 'Power off'（与行内 'Shut down' 成对）
- R7 ✓ dev 无端口时后缀带工作区目录哈希（裸 dev 不再互踩 default 目录）；busy 槽
  气泡挂 aria-describedby

验证：typecheck/lint 零告警；vitest 1642 全绿；dev 装配 6182 正常。
前轮（2026-11-06）P1/P2/P3 不在本轮范围，仍 open。

## 已验证无恙的重点项

自删快照修复（域级真机回归 35.7s）、ack 容忍（组件测试）、dev 锁与正式版/双实例
实测、GPU 默认分平台门控未外推、删除守卫/半提交清单/隐式冷启动拦截在前轮结论上
未被修复轮破坏（vitest 1642 全绿佐证）。
