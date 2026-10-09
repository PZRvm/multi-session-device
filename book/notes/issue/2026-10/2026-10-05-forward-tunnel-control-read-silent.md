---
description: 历史控制读侧零收包观察；2026-10-09 当前链路证实收到 ACK，协议字段及库 resolver 接线错误已修复
tags: [android, scrcpy, adb, forward, tcp, streaming]
status: resolved
---

# forward 隧道控制读侧静默

- **观察**：2026-10-05 投屏真机并测（emulator 37.2.12 + scrcpy-server 3.3.3，`adb forward tcp:0 localabstract:` + 裸 TCP 双连接，与 PoC 同构）。控制连接 client→server 方向正常（服务端日志出现 `Device clipboard set`、按键/文本注入生效），但 server→client 方向**零字节**：SET_CLIPBOARD 的 ACK_CLIPBOARD 收不到、autosync 的剪贴板推送也收不到；video 连接的同方向数据完全正常。PoC 阶段从未读控制连接，此问题此前不可见。
- **复现条件**：forward 隧道 + 双连接握手完成后，对 control socket 挂 `data` 监听并触发 setClipboard（sequence≠0）——2s 内无任何字节。
- **影响**：剪贴板粘贴的协议级 ACK 不可用（粘贴本身已由服务端执行）；autosync 的设备剪贴板推送读不到。runner/投屏主链路（视频、注入、旋转、resetVideo）不受影响。
- **建议方向**：① 换 adb server 协议直连 `localabstract`（Tango 的 AdbServerClient 路径）重试读侧——PoC 时期该路径有「取帧卡死」的另一问题（learn 2026-10-04），需分开验证读写两个方向；② 查 scrcpy 官方客户端 forward 模式的 device message 读取实现对照；③ 当前缓解：粘贴 ACK 按 300ms 宽限尽力而为（超时视为已派发），中文输入功能可用但失去协议级确认。属 P2（有可用缓解，阻塞协议级确认与未来剪贴板同步）。

严重级：P2（缓解可用；阻塞剪贴板 ACK 确认与 stage05 剪贴板共享特性）。

## 2026-10-09 当前链路复核与修复

历史“原始字节为零”的观察保留，当前隔离 API 32、emulator 37.2.12、scrcpy-server 3.3.3 的生产链路可收到回包。旧实现连续 10 次均收到对应 ACK 和同步消息（共 522 字节），但仍等待 2000–2003ms。确认手写 reader 错把 ACK 的 64 位序列读成 32 位、把同步消息长度偏移读错，且未接入库内部 ACK resolver；不能继续把当前故障归于 forward 传输。

已保留传输，改用已安装协议库解析设备消息，持续消费同步流但不写宿主剪贴板；匹配 ACK 后完成粘贴 Promise。保留 2 秒派发降级，限制单消息 1 MiB、缓冲 2 MiB、未确认写入 64 条，关闭时结算等待。

三个核心回归在旧实现失败；manager 25 项通过，覆盖分片/粘包、UTF-8、完整序列、迟到/未知 ACK、双会话、长度预算及断开。真实同场景 10 次耗时 4–10ms，收到序列 1–10；同一临时 AVD 上两个生产会话均收到自己的 ACK、视频保持出包。结束后本次 forward 为零，临时 emulator 已退出，未停止其他设备或重启共享 ADB server。

当前解析故障已修复；socket 写失败后的库内 ACK Promise 未处理 rejection 另见 [review 留项](2026-10-09-remaining-fixes-review-findings.md)。双向剪贴板产品功能和历史零收包条件仍未由此次验收证明。见 [计划](../../../plans/2026-10-09-remaining-issue-fixes.md)。
