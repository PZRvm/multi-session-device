---
description: adb forward 隧道下 scrcpy 控制连接的 server→client 读方向在真机上静默——设备消息（剪贴板 ACK/同步推送）收不到，控制写方向正常
tags: [android, scrcpy, adb, forward, tcp, streaming]
---

# forward 隧道控制读侧静默

- **观察**：2026-10-05 投屏真机并测（emulator 37.2.12 + scrcpy-server 3.3.3，`adb forward tcp:0 localabstract:` + 裸 TCP 双连接，与 PoC 同构）。控制连接 client→server 方向正常（服务端日志出现 `Device clipboard set`、按键/文本注入生效），但 server→client 方向**零字节**：SET_CLIPBOARD 的 ACK_CLIPBOARD 收不到、autosync 的剪贴板推送也收不到；video 连接的同方向数据完全正常。PoC 阶段从未读控制连接，此问题此前不可见。
- **复现条件**：forward 隧道 + 双连接握手完成后，对 control socket 挂 `data` 监听并触发 setClipboard（sequence≠0）——2s 内无任何字节。
- **影响**：剪贴板粘贴的协议级 ACK 不可用（粘贴本身已由服务端执行）；autosync 的设备剪贴板推送读不到。runner/投屏主链路（视频、注入、旋转、resetVideo）不受影响。
- **建议方向**：① 换 adb server 协议直连 `localabstract`（Tango 的 AdbServerClient 路径）重试读侧——PoC 时期该路径有「取帧卡死」的另一问题（learn 2026-10-04），需分开验证读写两个方向；② 查 scrcpy 官方客户端 forward 模式的 device message 读取实现对照；③ 当前缓解：粘贴 ACK 按 300ms 宽限尽力而为（超时视为已派发），中文输入功能可用但失去协议级确认。属 P2（有可用缓解，阻塞协议级确认与未来剪贴板同步）。

严重级：P2（缓解可用；阻塞剪贴板 ACK 确认与 stage05 剪贴板共享特性）。
