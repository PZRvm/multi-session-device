---
description: scrcpy 取流传输要走 adb forward + 裸 TCP（官方客户端同款路径）——Tango 的 adb server 直连 localabstract 会卡死服务端取帧
tags: [android, scrcpy, adb, tango, yume-chan, streaming]
---

# scrcpy 传输路径——adb forward + 裸 TCP，不走 adb server 直连

- **Scenario**: Electron 主进程接 scrcpy-server 取流（Tango 只用协议面：options 序列化、流元数据解析、媒体流变换、控制消息编码），传输层选型。
- **Why**: 同一 server（3.3.3）、同一参数，两条传输路径表现不同——`AdbServerClient` 经 adb server 协议直连 `localabstract:scrcpy_<scid>` 时，server 建好虚拟屏后停止送帧（官方客户端同期对照正常）；改走 `adb forward tcp:0 localabstract:...` + 裸 TCP 双连接（video 先、control 后）后满帧。前向隧道握手：server 对 video socket 先发 1 个 dummy byte；**host 侧 forward 连接总是立即成功**，设备侧 adbd 若早于 server 监听会静默失败挂死——必须以 dummy byte 到达为准做超时重连（约 100 次 × 1s）。
- **怎么用**: push server（`adb push` → `/data/local/tmp/`）→ spawn `adb shell CLASSPATH=<path> app_process / com.genymobile.scrcpy.Server <ver> <options.serialize()>` → `adb forward tcp:0 localabstract:scrcpy_<scid hex 补零 8 位>`（stdout 即宿主端口）→ 连两次裸 TCP；video 流先读 1 字节 dummy，再交给 `options.parseVideoStreamMetadata` + `createMediaStreamTransformer`；control socket 包 `Consumable.WrapWritableStream` 后交给 `ScrcpyControlMessageWriter`。静态画面 server 不出帧是正常行为（按变化编码），量 fps 必须持续制造内容变化。
