---
description: 解锁投屏 Phase 5 的三项发现已修复并正式回归：本地手势随代次取消、零帧有界恢复与可重试错误态、ACK 安全整数校验；全量 1254 项通过
created: 2026-10-16
status: resolved
tags: [scrcpy, review, resync, gesture, ACK, recovery]
---

# 解锁投屏修复 code review

范围：当前工作区相对 HEAD 的 8 个代码/测试文件，以及对应 plan、stage、learn、issue。
按 [八项检查单](../../../guidelines/review-checklist.md) 走查完整 diff 与调用方。
初轮结论：无 P1；有 2 项 P2、1 项 P3，P2 处置前不建议结束本轮功能收尾。
初轮只新增 review 记录并回写 plan/stage，没有修改产品代码或正式测试；用户随后批准修复并提交，结果见末节。

## P2-1 自动重同步释放设备手势后，renderer 仍发送旧 Move

位置：`src/renderer/src/hooks/useDeviceScreen.ts:155-160`；调用方为
`ExternalCanvas.tsx:164-170`、`DeviceCanvas.tsx:273-279`，本地输入状态在 `useDeviceInput.ts`。

拖动或捏合时遇到解码拥堵，本次新增的主动重同步会请求编码器重建，新配置递增 generation。
hook 更新归属后通知监听者，画布只向 main 发 `release-all`，没有清除输入 hook 中的
`pointersRef`、`pendingMovesRef`、待执行 RAF。分辨率相同的重建又不会让 `enabled` 变为 false，
输入 hook 的禁用清理因此不运行。

临时测试使用真实 `useDeviceScreen` 与 `useDeviceInput`：Down→安排 Move RAF→收到
generation 2 配置→执行旧 RAF，实际发送顺序为：

```text
GESTURE_AFTER_RESET [ 'down', 'release-all', 'move' ]
```

最后一个 Move 已使用新 generation，却没有新的 Down；手机侧原手势已被释放。
用户会在自动恢复过程中遇到拖动中断，旧移动还可能在恢复后继续注入。该输入状态清理问题
先前也可能随旋转出现，本次新增普通滑动中的主动编码器重建使其进入本轮修复路径。

建议方向：重同步/代次改变时同时取消本地手势、移动 RAF 和跨恢复的组合输入；不要只向
设备发送释放消息。补充“恢复后旧 Move/Up 不补发，新 Down 仍正常”的组合回归。

## P2-2 没有后续视频包时，重建请求不会按 3 秒节拍重试

位置：`src/main/scrcpy/ipc.ts:83-86`、`src/main/scrcpy/media.ts:50-55`；
重试入口为 `src/main/scrcpy/session.ts:57-85`。

主动重同步先清空缓存和 outbox，置 `waitingResync=true`，然后发送一次 `resetVideo`。
若设备没有回送新配置，且此后因静态画面或息屏不再送包，`runSession` 会停在
`await reader.read()`；所谓 3 秒看门狗只在下一次 read 完成后检查，没有独立计时器。
因此恢复请求没有响应时，既不会到时重试，也没有超时错误通知，画布会保留旧画面等待下一次设备变化。

临时接缝验证模拟 reset 已写入但没有新配置/视频包，推进 fake clock 10 秒：

```text
NO_MEDIA_RETRY { requests: 1, waiting: true, timerCount: 0 }
```

这是恢复触发机制的存量限制；本次新增接收端主动清链、停发后进入该路径，且 plan 声称
“看门狗负责失败后的节拍重试”，目前该保证对零帧场景不成立。正常返回新配置的真机验收
通过，不能覆盖这个失败分支。

建议方向：恢复中的会话使用独立、受限的重试/超时机制，绑定会话与 view 归属，取消或
销毁时清理；耗尽后呈现可重试错误态。补“零帧 + 首次无响应/失败”的域层回归。

## P3-1 非法 throughSeq 也能清缓存并重建编码器

位置：`src/main/scrcpy/ipc.ts:70-86`。

当前仅用 `Number.isFinite` 与最大序号比较，负数、小数也能通过。此前普通 ACK 的
整数域校验已经不足，本次新增 `resync:true` 后会直接清 GOP 并执行 `resetVideo`，
使非法确认值产生停流/重建副作用。

在合法 sender、viewToken、generation 下，分别传 `throughSeq=-1`、`1.5` 且
`resync:true`，临时测试均观察到一次 reset，原可回放 GOP 被清空：

```text
INVALID_SEQ_ACCEPTED -1
INVALID_SEQ_ACCEPTED 1.5
```

仅影响已登记主窗的非法调用，不据此宣称存在外部权限绕过。
建议方向：序号先限制为非负安全整数，再校验已发送范围；新增负数、小数、边界值的拒绝用例。

## 检查与证据边界

| 检查项        | 结果                                                     |
| ------------- | -------------------------------------------------------- |
| 重复代码      | 未见新增的实质重复；显式恢复复用现有通道与 sendResync    |
| 授权/权限     | sender、活动视图、generation 守卫保留；数值域不足见 P3-1 |
| 竞态          | 恢复与本地手势交叉见 P2-1                                |
| 事务/状态边界 | 清链与恢复确认之间缺独立超时见 P2-2                      |
| 通知          | 零帧无响应时缺失败通知，纳入 P2-2                        |
| 输入边界      | 负数、小数 ACK 序号见 P3-1                               |
| 复杂度        | 未引入新通道或依赖；需要补齐恢复状态的失败出口           |
| 范围          | 本次 diff 与批准的投屏修复范围一致；review 未修改实现    |

- 相关正式回归：3 个文件、51 项通过。
- 临时故障注入：2 个文件、4 项验证通过，断言的是上述缺陷确实存在，不是修复完成。
  文件位于忽略目录 `node_modules/.msd-review/`，未纳入产品测试树。
- 临时配置合并时也跑过完整产品测试，1243 项通过、6 项按原条件跳过；与 4 项诊断验证
  合计显示为 1247 项通过。该结果不表示本轮 3 个发现已被正式回归覆盖。
- 没有为此次 review 再操控真机；此前 8 次切换和息屏解锁首滑的验收证据保持有效，但不覆盖上述故障注入条件。

对应 [实现 plan](../../../plans/2026-10-16-unlock-stream-resync.md)。

## 修复与复审（2026-10-16）

- P2-1：`useDeviceInput` 统一订阅代次变化，按新信封释放设备输入，同时清除本地触点、
  按键、移动 RAF 和跨代次 IME；两处画布删除重复释放监听。正式回归覆盖旧 Move/Up 不补发、
  新 Down/Up 正常、旧按键与 IME 丢弃，以及真实 screen/input hook 组合下强行执行已取消的旧 RAF。
- P2-2：新增独立恢复计时器，0/3/6 秒共请求 3 次，9 秒无新配置则报告本地化错误并停止。
  新配置、有效回放、切换、退订、销毁均取消；回调校验实例、代次、视图归属。
  错误态保留会话，重试时保留活动视图；清理期间用户切换或退订不会被重建覆盖。
  正式回归覆盖零帧、控制写入失败、耗尽无残留、迟到配置不复活、成功取消、切换/退订/销毁取消与重试交接。
- P3-1：`throughSeq` 须为非负安全整数且小于下一待分配 seq；负数、小数、NaN、Infinity
  和未发送的边界序号均被拒绝，不清链、不请求重建。
- 新回归先确认旧实现失败；最终 typecheck、lint、全量 `1254 passed | 6 skipped` 通过。
  重新按八项检查单走查最终 diff 与调用方，三项均关闭，未发现本批新增阻断问题。
- 实窗冒烟另遇到 [真机初次建流超时后切回没有重试入口](2026-10-16-无线投屏建流失败后切回缺少重试入口.md)。
  该路径在 ready 之前失败，与本轮 ready 会话恢复分开记录，未扩改。
