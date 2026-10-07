---
description: 已修复 P2 启动挂起：ADB 分段/断开有界收口，启动准备可取消；受控窗口及回归验证通过
status: resolved
tags: [emulator, startup, ipc, smoke, adb, fragmentation, pending-promise]
---

# P2 — ADB 版本应答分段后断开，设备启动挂起并丢失 IPC 回复

状态：已修复下述已确认缺陷，详见 [修复 plan](../../../plans/2026-10-07-adb-probe-and-start-cancel.md)。以下调查内容保留修复前证据；上次自然异常缺少收包记录，具体触发仍未确认。

2026-10-07 按用户要求复现并写报告，未修复源码。普通操作重新启动两次均成功；通过临时诊断注入“版本应答分两段到达后关闭连接”，已在实际 Electron 窗口复现原报错和无模拟器进程的现象。主进程 `probeServer` 的分段读取与连接关闭处理存在缺陷，代码与 HEAD 一致。

优先级建议 P2：正常应答可启动，但合法分段应答或应答未完整即断开会阻断启动；取消也不能恢复，用户需要重启应用。影响范围是共用 ADB 启动前探测，尚未逐个验证其他 API/机型。

## 首次观察

- 场景：2026-10-07 本轮输入丢弃修复完成自动检查后，重启 dev（localhost:6174），应用当前仅登记 Pixel 8 API 32，id 为 5e5b1d65-19e0-4e9e-bbdc-615ed2370762。
- 观察：从左侧点击启动，界面持续“启动中”，随后原生提示 `Error invoking remote method 'devices:start': reply was never sent`；关闭提示后仍为启动中。进程列表没有该 AVD 的 emulator/qemu，adb devices 只有原本存在的外部 API 34 emulator-5554。
- 影响：本轮无法进入设置页复验旋转或电源关闭。自动测试 428 项通过，不能替代这次设备回归。
- 限制：未定位原因，未用 HEAD 做对照，尚不能判定是环境、既有启动问题还是其他进程/窗口时序。不把观察直接归因于旋转输入修改。
- 收尾：结束该 dev 进程并重新 npm run dev，已在实际窗口确认停止占位和左侧启动入口；没有修改设备元数据、SDK 或 AVD，也未停止外部 API 34 进程。
- 后续方向：在单独任务中复现并追踪 devices:start 的 IPC 生命周期和 runner.start 中的启动前等待，确认实际异常来源；本轮仅记录。

任务与验收范围见 [plan](../../../plans/2026-10-07-discard-input-during-rotation.md)。

## 本轮环境与边界

- macOS 15.8.1（24H32）、arm64；Electron 实际安装版本 39.8.10；诊断 Node v22.20.0。
- 分支 feature/stage04-emulator-integration，HEAD d49b7c0，保留前轮未提交改动；dev 为 localhost:6174。
- 设备 Pixel 8 API 32，id 同上，legacy 配置 advancedSettings=null；正常启动避开原有外部 API 34 emulator-5554，使用 emulator-5556。
- 应用自有 adb 37.0.1-15733141，协议 41。共享 server 和外部 API 34 进程全程保留，没有 kill-server，也没有修改设备元数据、SDK、AVD 配置或生产代码。
- 诊断仅在本次 Electron 主进程将 JS 的 host:version 连接定向到临时本地 server。SDK adb 子进程仍访问真实共享 server。两组均在连接关闭后执行 GC 以缩短 IPC 报错等待；GC 不参与组件层挂起复现。

## 复现步骤与预期

可执行诊断脚本与清理步骤见 [复现附录](2026-10-07-api32-start-repro-procedure.md)。

1. 关闭前一个 dev 实例，按附录以 `MSD_REPRO_ADB_MODE=split-close` 启动诊断 dev，确认日志 `ready mode=split-close`。
2. 设备为“停止”时，从左侧点击“启动 Pixel 8 API 32”。
3. 临时 server 收到 `000chost:version`，先回 `OKAY`，约 30ms 后回 `00040029` 并结束连接。
4. 观察到“启动中”，没有 serial，没有该 AVD 的 qemu；关闭连接后触发 GC，实际窗口弹出：

   ```text
   Error invoking remote method 'devices:start': reply was never sent
   ```

5. 点击“知道了”，仍为“启动中”。点击“取消启动 Pixel 8 API 32”，实际窗口又提示：

   ```text
   Error invoking remote method 'devices:cancel-start': Error: 设备没有运行中的实例
   ```

   关闭后变为“停止中”，行内显示“取消失败：设备没有运行中的实例”，没有启动入口。

6. 对照组使用同一脚本、同一 GC 行为，只把模式改为 `whole-close`，一次返回 `OKAY00040029` 后结束连接：正常进入“运行中”、生成 emulator-5556、投屏可见。

预期：完整合法应答无论如何分段都应解析为协议 41；应答不完整或连接提前关闭应在有界时间内失败并恢复可启动状态；取消应覆盖启动前准备阶段。

## 结果与证据

| 检查                                       | 实际结果                                                              |
| ------------------------------------------ | --------------------------------------------------------------------- |
| 无诊断注入的普通左侧启动 → 停止 → 再启动   | 两次成功，原启动报错 0/2；均有 emulator-5556 与投屏                   |
| 分段后断开的实际窗口受控复现               | 1/1 复现原报错、持续启动中、无该设备进程；取消失败 1/1                |
| 完整应答一次到达并断开的实际窗口对照       | 1/1 正常运行；同样执行 GC，未出现该 IPC 错误                          |
| 真实共享 adb server 只读 host:version 采样 | 30/30 一次收到完整应答；本轮未捕获自然分段                            |
| 生产 probeServer，完整应答一次到达后断开   | 2ms 返回 `{running:true, protocolVersion:41}`                         |
| 生产 probeServer，分两段后断开             | 收到两段并在 31ms close；4202ms 时 Promise 仍 pending，未触发 timeout |
| 生产 probeServer，仅首段后断开             | 33ms close；4202ms 时 Promise 仍 pending                              |
| 生产 probeServer，分两段但保持连接         | 3034ms 超时返回 `{running:false}`，丢失已经完整收到的合法应答         |

受控窗口日志原始时间为 UTC，换算北京时间的启动请求为 22:40:06：

```text
[adb-repro] 2026-10-07T14:40:06.282Z request=000chost:version
[adb-repro] 2026-10-07T14:40:06.283Z data=OKAY
[adb-repro] 2026-10-07T14:40:06.318Z data=00040029
[adb-repro] 2026-10-07T14:40:06.318Z probe socket closed
[adb-repro] 2026-10-07T14:40:07.603Z force gc
```

同一时段进程检查没有 `-avd 5e5b1d65-19e0-4e9e-bbdc-615ed2370762`；`adb devices -l` 只有原有 emulator-5554。窗口的 AX 文本与截图均确认原报错；关闭提示后的 AX 文本仍为“正在启动模拟器，等待系统 boot 完成”。完整应答组日志在 22:42:13 收到 `OKAY00040029`，立即打印“复用共享 adb server（协议 v41）”，随后窗口进入运行。

## 已确认原因与尚未确认的部分

1. [adb.ts:69](../../../../src/main/emulator/adb.ts) 使用 `socket.once('data')`。首段不足 8 字节或不足声明长度时直接 return；监听器已经被移除，后续段不会进入解析。首次代码追踪提出这个假设，组件对照和实际窗口注入都支持它。
2. 同函数只处理 timeout/error，没有 end/close 收口。组件实测证明，连接先关闭后，3 秒 socket timeout 没有使 Promise 结束，4200ms 后仍挂起；保持连接的对照则能触发 timeout，但会误判合法分段应答。
3. [devices/index.ts:413](../../../../src/main/devices/index.ts) 先把状态设为 starting，再等待 runner；[runner.ts:129](../../../../src/main/emulator/runner.ts) 在创建运行 entry 前等待 ensureAdbServer。探测不结束时，设备状态已经变化，但 runner 没有 entry 或子进程。
4. Electron 39.8.10 的 ReplyChannel 在被销毁且没有回复时产生此错误；IPC 分发器等待 handler 的 Promise 后才回包。受控 GC 后窗口确实收到原报错，而 main 的启动 Promise 没有结束，其 catch 回滚也不会执行。[ReplyChannel 源码](https://github.com/electron/electron/blob/v39.8.10/shell/common/gin_helper/reply_channel.cc#L33-L35)、[IPC 分发源码](https://github.com/electron/electron/blob/v39.8.10/lib/browser/ipc-dispatch.ts#L68-L93)。
5. [devices/index.ts:495](../../../../src/main/devices/index.ts) 的取消把设备改为 stopping，再调用 runner.cancelStart；此时 runner 没有 entry，因此报错并留下停止中。本轮实际点击证实了这条连带影响。

缺陷代码在 HEAD 已存在：当前和 `git show HEAD:src/main/emulator/adb.ts` 的 SHA-256 都为 `f34e85f158d87b9515f187e66e032576b7c012de6801cdfbe454e01b1da00e4c`；adb.ts、runner.ts、devices/index.ts 都无本轮源码 diff。

上次自然异常没有留存 ADB 包或挂起栈，本轮普通启动和真实 server 采样也未再次出现分段。因此已证明“一条能产生相同症状的既有原因”，尚不能认定上次自然异常一定由同一条件触发，亦不能估算自然发生率。

## 建议方向与后续验收

- probeServer 持续累积 data 到完整帧后解析，end/close/error/总时限均应使 Promise 结束；统一幂等清理监听器和连接。首次连接建立也纳入有界等待。
- 启动前准备应有取消与失败收口，避免设备 starting 时 runner 尚无 entry 而无法取消。正常解析的改善不能单独覆盖取消竞态。
- 回归包含完整帧、多段完整帧、半帧断开、空连接关闭、无应答超时；真实 IPC/设备状态覆盖准备阶段取消与回滚。现有 adb 测试的假 server 一次写完整帧，未覆盖分段后关闭。
- 本轮仅复现和写报告，未修改源码、正式测试或依赖，未提交 git。诊断退出后恢复普通 dev 和设备停止状态，临时注入已移除。

## 同日修复与复验

probeServer 现在持续拼接 data，end/close/error 统一结束；3 秒总期限从连接前开始。runner 在准备前登记，可由取消和退出中止；端口等待被中止时清理预留，迟到回包不再 spawn。devices 提前登记 runId，主动取消不弹启动失败，旧回写不覆盖新启动；真实失败恢复停止并清掉运行字段。

| 修复后检查                                                        | 结果                                                                                             |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 原 split-close 窗口注入（同样含 GC）                              | 正常进入运行中、emulator-5556、投屏可见；电源停止后仅剩外部 5554                                 |
| 第二段延迟 2500ms，准备期间取消                                   | 立即回停止，无错误提示；迟到完整应答和 GC 后仍无本设备 qemu；随后重新启动成功                    |
| 仅回 OKAY 后关闭                                                  | 两次版本探测均立即结束，约 17ms 后正常返回 start-server 复验失败；界面恢复停止与启动入口         |
| 原组件脚本 whole-close / split-close / partial-close / split-open | 分别在 2 / 33 / 32 / 31ms 结束；合法完整帧均为协议 41，半帧关闭为 running=false                  |
| 自动回归                                                          | 旧代码先红 12 项，修复后相关 98 项通过；全量 443 通过、5 跳过；build/typecheck/lint/变更格式通过 |

分段组日志：

```text
[adb-repro] 2026-10-07T15:10:08.099Z request=000chost:version
[adb-repro] 2026-10-07T15:10:08.100Z data=OKAY
[adb-repro] 2026-10-07T15:10:08.132Z data=00040029
[devices] 复用共享 adb server（协议 v41）
```

取消组在 15:12:12.025Z 收到请求，15:12:14.531Z 才完成应答；窗口在完整应答前已恢复停止，随后进程与 adb 检查只有外部 emulator-5554。半帧组在 15:13:25.354Z 首次查询，15:13:25.369Z 复验，15:13:25.371Z 明确拒绝，出现正常业务错误而没有丢失 IPC 回复。

上述耗时仅为本轮记录。临时注入已移除，普通 dev 恢复停止占位；没有改设备元数据、SDK 或 AVD 配置，没有停止外部 API 34。review 未发现本轮新增的可确认缺陷，未提交 git。
