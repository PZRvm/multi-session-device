---
description: 无线连接失败后自动诊断、用户确认后重启共享 ADB 并重试当前目标，含任务保护、会话恢复和验收步骤
status: in_progress
created: 2026-11-05
---

# 无线连接诊断与显式修复 — plan

方案依据：[调研报告](../notes/think-report/20261105134112-无线连接失败诊断与修复.md)。2026-11-05 用户选择 B，并要求创建开发计划。`approved` 表示 B 的功能方向已裁决；用户随后要求在独立 worktree 执行，实现与自动门禁已完成，人工验收待补（分支 feature/wireless-diagnostics-recovery，端口 6175）。调试临时绕过单实例锁，交付前恢复。SDK 共享，轻量 userData 隔离，避免双进程写同一状态文件。

## Requirements brief — Step 0

### Background

本次故障中手机 USB 在线、无线 5555 监听、Mac 独立 TCP 探测成功，共享 ADB connect 却持续返回 `No route to host`。应用重启未改变共享服务，重启共享 ADB 后无线连接与 shell 均成功。恢复方法已验证，底层失效原因未确定。

当前通用提示只让用户检查 Wi-Fi 和地址，没有区分手机网络与共享服务异常，也没有应用内恢复入口。

### Scope

- Affects：无线 promote/connect 的诊断与结果契约；显式重启共享服务的入口；任务保护和重启互斥；真机与 AVD 的流会话恢复；两处无线入口反馈、诊断复制；macOS 局域网使用说明；相关契约文档。
- Does NOT affect：5037 共享架构、设备元数据/持久化、无线扫描算法及配对流程、断线后台找回、SDK 签名体系、iOS、设备网络设置；不调整默认启动/退出时的服务存续策略，不自动停止录屏或安装，不重启模拟器实例。
- Boundaries：仅用户点“修复连接”并在原生对话框确认后可重启；单次操作最多一次 kill/start；只重试本次目标；不恢复全部历史无线地址，不承诺 IDE 调试/端口转发恢复。外部使用状态不可完全获知，确认必须说明全局影响。

### Requirement

1. 转无线和手动连接失败后自动诊断一次；保留有限重试，所有诊断有总期限，不引入常驻检测。
2. 提供“重试”“修复连接”“复制诊断”。修复可用性以 main 为事实源；no-wifi、not-found、unauthorized 等已有明确处理方向时优先显示对应引导，不建议重启。
3. 端口可达但 ADB 持续失败只标“疑似服务异常”；no-route 不等于权限被拒绝，网段前缀不等于实际连通性。
4. 修复前展示影响；录屏、安装、SDK 迁移等任务未结束时禁止重启。确认期间开始新任务也须在执行前拦截。
5. 重启期间界面显示工作状态并阻止重复操作；结束必须给出成功、失败或取消结果，不能留下永久 busy。
6. 成功以目标 transport 为 device 且轻量 shell 正常为准；仅有 `connected to` 不算完成。验证失败保留准确的阶段与诊断。
7. 补 NSLocalNetworkUsageDescription；核验正式包启动的 ADB 与权限归属。无确切拒绝证据时仅建议检查权限，不宣称已检测到拒绝。

## Impact range — Phase 1

影响链：主窗 USB 行/无线连接窗 → preload → external promote/connect → runAdb → 共享 server → 手机。失败分支增加诊断，修复分支由 main 确认后协调 server、任务与会话恢复。

| 已核实位置 | 当前能力与需要补的接缝 |
| --- | --- |
| `src/main/devices/external.ts` | TCP 失败有限退避、/24 粗分类、CNXN 扫描探测、track 重连代次；补失败证据和修复门，扫描探测不直接充当诊断事实 |
| `src/main/emulator/adb.ts` | require/probe/ensure/run；补受控重启与服务复验，默认 ensure 仍只复用或启动 |
| `src/main/apkInstall/index.ts` | activeDevices 在注册闭包内；增加只读忙碌查询及入口保护，经装配注入，不复制安装状态 |
| `src/main/recording/index.ts`、`manager.ts` | snapshot、isRecordingActive、冻结能力；保护 starting/录制/暂停/停止等采集阶段及确认中的 start 请求，避免重用退出冻结时错误解冻 |
| `src/main/emulator/sdkMigration.ts`、`sdkSourceSwitch.ts`、`sdkIpcSource.ts` | 已有 migration journal 门；修复与迁移/SDK 来源变更互斥，禁止重启时发生二次停服务或迁移 |
| `src/main/ipc/index.ts` | 持有 recording、scrcpy、logcat、network 与两条生命周期桥；在此组合任务查询和恢复回调 |
| `src/main/devices/lifecycle.ts`、`startup.ts`、`queries.ts` | AVD 启停与运行视图；修复期间禁止新增启停竞争，恢复不改变实例运行状态 |
| shared / preload / 两处 UI | 新结果与修复 IPC、main 状态镜像、按操作保留反馈 |

风险：其他应用可抢先重生 server；旧 track/会话回调可能迟到；新任务可跨过确认窗口；恢复同 runId 的已死会话可能被幂等跳过；诊断输出可能包含私密路径。设计按下节处理。

## Design — Phase 2

### 1. 诊断与分类

在 main 收集失败阶段（读取 IP/tcpip/connect/transport/shell）、退出码与限长输出摘要、错误类别、目标、transport 状态、独立 TCP 探测结果、选中 ADB 路径/版本及可得的 server-status。正常连接不执行额外全套诊断。

失败诊断的额外总期限为 5 秒；单 TCP 探测 1.5 秒；辅助查询并发且取消后关闭 socket/计时器。单项不可用标 unknown；server-status 不支持时静默降级，不覆盖原始错误。原有连接命令和退避仍各有期限，不计入这 5 秒。

| 证据 | 提示与操作 |
| --- | --- |
| wlan0 无 IP / USB 不在场 | 沿用无 Wi-Fi / 设备离场引导，不提供重启建议 |
| transport unauthorized 或认证失败证据 | 手机授权/核对配对信息；不自动重启 |
| tcpip 非零退出或明确失败输出 | “开启无线端口失败”，保留原文；不能继续当作普通网络失败 |
| TCP refused | 端口未就绪或未监听，允许重试；不判定服务异常 |
| TCP timeout/no-route/unknown | 网络或访问受阻/原因未确定；网段仅附提示 |
| 独立 TCP 可达但 ADB 持续失败 | “手机端口可达，疑似 ADB 服务异常”，可建议修复；仍不能证明对端就是手机或权限正常 |
| 已连接但 offline / shell 验证失败 | 标明失败阶段，允许用户诊断与修复，不伪报成功 |

不改变扫描用 CNXN 判据。诊断只用 TCP 可达性作辅助，不向 TLS 端口发明文 CNXN；AUTH 应答不能被解释为网络不通。进程年龄不参与故障分类。

### 2. 跨进程契约

以下为拟定接口名称，实施时与 shared 命名保持一致，不新增通用命令执行 API。

- 扩展 `WirelessConnectOutcome`：失败携带结构化 diagnosis 和可用于本次操作的 `attemptId`，明确取消、忙碌、阶段失败和成功。
- `getWirelessRecoveryState()`：返回 idle/confirming/restarting/reconnecting、任务阻塞原因和当前操作标识；状态变化通过专用 changed 通道推送给主窗与无线窗。
- `repairWirelessConnection({ attemptId })`：main 从临时上下文解析目标并确认，renderer 不传任意 shell/命令，也不以 `confirmed: true` 绕过确认。
- `copyWirelessDiagnostics({ attemptId })`：main 按白名单生成脱敏文本并写剪贴板；不接受 renderer 拼接命令或任意路径。
- 新通道遵循既有主窗/无线窗 sender 守卫，并核对 mainFrame；设置窗、iframe、其他窗口不可触发。
- 临时 attempt 绑定发起窗口与目标，至多保存 32 项、10 分钟过期；同入口新请求替换旧结果，窗关闭释放。过期提示重新连接生成诊断；不落盘，不跨应用重启恢复。
- 复制内容只含所需字段：不含配对码、授权密钥、APK 路径、无关日志；用户主目录作占位，输出限长。完整原始输出不直接交给 renderer；未知错误仍须脱敏。

### 3. 显式恢复时序

1. 验证 sender/attempt → 检查任务 → 将全局状态改为 confirming。并发修复立即返回 busy，不排队，不弹第二个确认框。
2. 以发起窗口为父窗弹原生确认：“将重启共享 ADB，所有设备连接和 Android Studio 调试会短暂中断，其他无线设备可能需要重新连接。”按钮“取消 / 重启并重试”，默认取消。外部调试状态不作“空闲”保证。
3. 取消或父窗关闭：退出且零 kill/start。确认后同步取得修复执行门，重新检查任务与 SDK 状态；遇阻返回具体原因，不执行重启。
4. 关门后禁止新录屏/安装/迁移/AVD 启停和其他无线操作。暂停本应用 track 自动重连、连接/扫描在途工作和流会话重建；短命令等待结束或取消，不能在 kill/start 之间自行拉起 server。安装不强杀，已在途则拒绝修复。
5. 先保留诊断；关闭本应用受影响的投屏/日志 transport 与网络轮询，等待旧会话清理完成。既有 AVD 进程保持运行，设备元数据不变。
6. 通过当前选定 adb 执行一次 kill/start（每步现有 10s/30s 上限），再探测协议。若外部工具抢先启动兼容服务则复用；不兼容返回明确错误，不再次 kill。
7. 在门内只放行恢复操作拥有者：重新枚举、对当前 host:port 做有限连接重试并执行有界 shell（5s）。转无线已开启端口，不再次执行 tcpip，避免再触发手机 adbd 重启。
8. `finally` 释放执行门、恢复跟踪和相关后台机制；即使启动/验证失败也不能残留冻结状态。失效的 operationId/epoch 回调不得覆盖新状态。
9. 已连接 USB 由新 track 帧和新代次重建；AVD 从当前 running 视图显式销毁旧流后重新 ensure，避免同 runId 幂等掩盖死会话。恢复 logcat/network 的既有活跃订阅，不重建无用户订阅的额外工作。失败显示到对应设备，不影响其他设备的恢复。

修复执行门仅服务本功能，不搭建通用任务框架。低层命令检查与高层入口检查共同覆盖：runAdb 默认拒绝修复窗口内的新 CLI 命令，恢复路径持私有执行许可；Tango/track 非 CLI 路径由现有装配接缝暂停。runAdb 的在途计数/收尾在 finally，恢复许可不暴露到 IPC。实施前逐项核对所有自行 start-server 的路径，不能只加 UI disabled。

### 4. 任务保护

- APK：读取安装域 activeDevices 事实源；新安装在同步登记前检查修复门，修复检查时已登记的任务算 busy；保留原有安装 finally 清理。
- 录屏：`isRecordingActive` 覆盖的状态都阻塞；包含异步确认/启动尚未登记的在途 start。纯离线生成/已保存素材不依赖 ADB，无须阻塞。利用注入的门检查，不修改录屏成片逻辑。
- SDK：保留 journal 门；修复不能覆盖/清除 migration 标记。SDK 迁移和来源切换在进入异步过程前检查修复门，门关闭后不得新开迁移。
- AVD：已有 starting/stopping 时拒绝修复，执行期间拒绝新启停，避免 runner 把服务中断误结算为崩溃。普通运行中的 AVD 允许修复，实例进程保持。
- 确认阶段允许其他正常工作，故执行门建立后必须二检；确认阶段只预留修复互斥，不长时间冻结所有任务。

### 5. 界面与权限

主窗设备行和无线窗共用失败展示逻辑、诊断分类和恢复状态。操作区使用已有组件，实施时读 impeccable；不扩展为独立设置中心。失败文本可换行，按钮不能随窄行挤出；三语文案齐全。

状态：连接中 → 诊断中 → 失败/可操作 → 确认中 → 修复中 → 成功/失败。旧异步响应不覆盖新请求。USB 行暂时消失时，修复进度保留在主窗真机分区的稳定反馈位置；不能随 USB 行卸载丢掉结果。窗关闭后不向已销毁窗口发送或操作剪贴板。

修复前点击重试只重试本次用户目标，不触发全局重启。复制成功有轻量反馈；诊断过期给出重试指引。只有确切权限拒绝证据才显示“被拒绝”，否则显示检查局域网权限的建议。

`electron-builder.yml` 添加中文 NSLocalNetworkUsageDescription。沿用稳定签名优先策略，核验正式包的授权提示/拒绝/重新允许和升级；不改证书或读取凭据。

### 6. 文件改动清单

| 文件/位置 | 计划改动 |
| --- | --- |
| `src/main/devices/external.ts` | 诊断接缝、attempt 生命周期、结果、track 暂停/恢复、无线入口互斥 |
| `src/main/emulator/adb.ts` | 受控重启/协议复验、命令执行门、在途收尾；默认 ensure 不变 |
| `src/main/emulator/adbRecovery.ts`（新增） | 本功能的状态与私有恢复执行许可；不反向引用 UI/录屏/安装域，任务与恢复回调经装配注入 |
| `src/main/ipc/index.ts` | 安装/录屏/SDK/AVD 状态接线与两类设备会话恢复，必要时调整注册顺序 |
| `src/main/apkInstall/index.ts` | 暴露只读忙碌接缝、入口门；不调整安装策略 |
| `src/main/recording/index.ts`、`manager.ts` | 录制入口与在途 start 保护；不改媒体管线 |
| `src/main/emulator/sdkIpcSource.ts`、`sdkSourceSwitch.ts` | 来源切换/迁移入口的修复门检查 |
| `src/main/devices/lifecycle.ts`、`startup.ts`、必要的 `index.ts` 导出 | 启停入口检查、运行状态查询；不改 runner 生命周期算法 |
| `src/shared/types.ts`、`ipc-channels.ts`、`i18n/` | diagnosis/恢复状态/结果、IPC 常量与三语词条 |
| `src/preload/api/devices.ts`、`src/preload/index.d.ts` | 新白名单方法与声明 |
| `src/renderer/src/stores/externalStore.ts` | 恢复状态镜像和操作标识；不持久化 |
| `DeviceListPane.tsx`、`WirelessConnector.tsx`、`wirelessOutcome.ts` 及对应样式 | 两入口诊断/修复/复制、稳定反馈与窄宽度布局 |
| `electron-builder.yml` | macOS 局域网用途说明 |
| 上述模块相邻 `__tests__/` | 分类、权限、竞态、恢复与 UI 回归测试 |

文档随实现同步：PRD 的共享服务策略补“用户确认的显式修复”例外；旧无线 plan 保留历史裁决，追加新 plan 链接和修订说明，不篡改当时记录。阶段 6 再写 summary/learn/issue 并刷新索引。

## Build order

- [x] Step 0：需求简报与裁决记录。
- [x] Phase 1：调用链、影响范围、风险。
- [x] Phase 2：数据流、接口、任务保护、恢复时序、验收定义。仅完成文档。
- [x] Phase 3 / S1：先写分类、tcpip 失败与诊断超时测试，再实现诊断及共享结果契约；验证正常连接/扫描/配对回归。
- [x] Phase 3 / S2：先写互斥、取消、二检、许可与 finally 测试，再实现显式恢复协调和任务入口保护；验证全局 kill/start 次数与无旁路重生。
- [x] Phase 3 / S3：接装配和真机/AVD 会话恢复；验证不重启模拟器进程、旧代次不污染新会话。
- [x] Phase 3 / S4：接 preload、状态推送、两入口 UI、脱敏复制及 macOS 用途说明；验证 IPC sender/mainFrame、窄宽度和三语。
- [x] Phase 4 自动门禁与现有真机开发窗验证：1592 项通过、6 项跳过，build/typecheck/lint/Prettier 通过；正式包与其余硬件验收未执行，见待验 issue。
- [x] Phase 5：初次检查后，用户要求独立复审；发现并复现 3 项 P2，见复审 issue。本轮只记录未修复；状态保持 in_progress，建议修复后再合并。
- [x] Phase 6 文档返写：summary、learn、人工验收 issue、PRD 例外和旧 plan 链接；索引已刷新。人工验收未齐，状态仍为 in_progress。

S1—S4 每步运行对应测试与 typecheck；阶段 4 统一全仓 lint/test。需要提交时先确保项目规定门禁全绿，不自动 push。计划不要求为文档改动运行代码测试。

## Test plan

| 维度 | 必测内容 |
| --- | --- |
| 诊断 | TCP 可达/拒绝/超时/no-route/unknown；未知错误、非零 tcpip；offline/未授权；同网段不等于可达、跨网段不等于不可达；旧版本 server-status 降级 |
| 成功 | connect 成功但 transport 非 device 不算成功；shell 失败不算修复成功；无故障不杀服务、不跑全套诊断 |
| 授权 | 非法 sender、子 frame、伪造/跨窗/过期 attempt；取消不执行命令；复制脱敏且限长 |
| 并发 | 两窗双击仅一个确认与一次重启；确认期间新任务导致二检拒绝；修复与录屏/安装/迁移/AVD 启停双向互斥；异步 start 尚未登记也受保护 |
| 失败释放 | kill/start/协议/shell/恢复回调分别失败；所有锁、socket、timer、入口门最终释放；兼容服务被外部抢启时不再杀，不兼容时停止并报错 |
| 生命周期 | track 迟到帧/旧回调失效；USB 行消失进度仍可见；窗口关闭安全收尾；AVD 保留进程并恢复投屏/日志/网络观察；其他无线未恢复不得伪报在线 |
| 产品回归 | USB、无线扫描、配对、手动连接、正常转无线、APK 安装、录屏暂停/继续、SDK 迁移和正常启停行为不变 |

自动门禁：`npm run typecheck`、`npm run lint`、`npm test`；文档门禁：`npm run book:index`、`npm run book:release-check`。不削弱原有断言。

人工验收：正式 macOS 包分别测权限允许/拒绝/重新允许；USB + 经典无线真机 + 一个运行中 AVD，在无采集任务时执行显式修复，确认投屏/日志恢复与实例未重启；录屏/安装期间入口受阻；有 IDE 调试时确认影响提示真实。另测一个官方 TLS 手动连接目标，不误用明文探测。原故障难以自然复现时保留确定性替身测试与真机修复链结果，明确不能声称已自然复现底层故障。其他平台执行类型/单测及可用的共享服务冒烟，不调用 macOS 专属能力。

## Done criteria

- 两个入口都能自动诊断、重试、显式修复和脱敏复制；默认生命周期不新增 kill。
- 每次重启有主进程原生确认、全局互斥、任务二检与无旁路重生保护；最多一次重启，所有失败分支可结束。
- 真实设备完成 transport + shell 验证，USB/AVD 会话恢复通过；权限拒绝能解释，不能恢复时有明确反馈。
- 自动门禁全绿、人工验收有记录；尚未验证项如实列出，不以单测替代正式包权限验收。
- Phase 5/6 只记录问题；功能报告、经验/问题、PRD 例外、旧 plan 引用和索引已同步，才翻 completed。

## 2026-11-05 实施结果

- [验证与 review 记录](../docs/poc/2026-11-05-wireless-recovery.md)
- [功能报告](../notes/summary/2026-11/2026-11-05-wireless-diagnostics-and-recovery.md)
- [待补人工验收](../notes/issue/2026-11/2026-11-05-wireless-recovery-hardware-validation.md)

实际字段与方法按 shared/wirelessRecovery.ts 和 preload/api/devices.ts 定义。消息复制通道仅接受 attemptId；前端恢复状态由 externalStore 镜像，两入口共用反馈组件。保留单实例约束的原始实现；本轮临时 userData 和绕过条件未进入最终代码。无新依赖，未 push 或替换已安装应用。

### 复审结果（2026-11-05）

[三项 P2 复审 issue](../notes/issue/2026-11/2026-11-05-wireless-recovery-code-review.md)。截图执行门、修复中日志订阅、诊断请求代次尚待单独修复；本次 review 不顺手修。USB 通用入口扩展由用户决定暂缓。

### 复审修复完成（2026-11-05）

用户授权单独修复后，三项 P2 已销账；全仓 1597 项通过、6 项跳过，构建/类型/lint/格式通过。合并进 dev 的步骤与结果见 [修复计划](2026-11-05-wireless-recovery-review-fixes.md)。原功能的专项人工验收继续独立记录，不因代码销账而声称全部覆盖。
