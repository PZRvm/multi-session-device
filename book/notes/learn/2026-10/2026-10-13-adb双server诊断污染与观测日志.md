---
description: 排查「真机先插、应用后起读不到」的三条经验——双 adb server 会互相抢 USB 接口造成假盲区、后台长连接客户端必须带观测日志否则故障不可归因、全新 server 的 USB 枚举是异步的需要 devices 逼一次落地
created: 2026-10-13
tags: [adb, usb, 双server, 诊断, 观测日志, 竞态]
---

# adb USB 排查三课：诊断污染、观测缺口、异步枚举

用户报「手机先插、应用后起就读不到；应用先起再插手机正常」。排查过程沉淀三条：

1. **双 adb server 的诊断污染**。为隔离复现在 `-P 5038` 起了第二个 server，观察到
   「新 server 看不到已插设备、`adb devices` 也为空、track 无推送」——一度误判为
   根因。实际是 5037 的 server 已占用手机的 USB 接口，第二个 server 枚举不到。
   **复现 adb USB 行为必须单 server 洁净验证**（kill 唯一 server 后由被测路径自起），
   隔离端口只隔离了端口、没隔离 USB。洁净验证后三个场景（server 在场带手机 /
   server 中途被杀 / 冷启动无 server）全部正常——失败来自用户的旧实例被卡死
   （35 秒零连接、连退避重试都没有），进程已不可解剖。

2. **后台长连接客户端必须有观测日志**。external 域原本零日志，用户报障时无法区分
   「server 没推」还是「客户端卡死」，只能靠 `lsof -iTCP:5037` 数连接反推。已补常驻
   日志：connect（含长/短格式）、close、handshake FAIL（带原因）、devices changed
   （serial+state 列表）、ensureSharedServer 失败。后台客户端的静默失败在用户侧就是
   「列表凭空消失」，日志是唯一的事后归因通道。

3. **全新 server 的 USB 枚举是异步的**（folklore 级竞态）：server 刚 start 就连
   track 可能拿到空首帧且等不到补推。ensureServerDefault 在自起 server
   （reused:false）后主动跑一次 `adb devices` 逼扫描落地；失败不阻断，热插拔推送
   仍是兜底。另注意 track 首帧可能被 TCP 拆成 `OKAY` 与载荷两段——帧解析器的缓冲
   设计必须本就覆盖（我们的覆盖了，冷启动日志当场验证）。
