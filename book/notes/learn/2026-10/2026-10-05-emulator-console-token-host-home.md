---
description: console token 路径不随 ANDROID_EMULATOR_HOME 重定向——恒为 $HOME/.emulator_console_auth_token，缺失时 emulator 会写宿主 home；共享 adb 靠 smart-socket 只读探测保不重启
tags: [android, emulator, adb, macos, isolation, spawn]
---

# console token 恒在宿主 home；共享 adb server 只读探测

- **Scenario**: 多实例 runner 启动 emulator 时做目录隔离，或需要与 IDE/宿主 adb server 共存而不得重启它。
- **Why**: emulator 37.2.12 实测（macOS arm64，两台 AVD 各冷启动一次）：`ANDROID_EMULATOR_HOME` 只重定向 `adbkey`、feature flags、`modem-nv-ram-*` 等；**console token 始终解析 `$HOME/.emulator_console_auth_token`**（console banner 直接报宿主路径，auth 用宿主 token 可通过、错 token 被拒）。宿主已有 token 时零写入（hash/mtime 不变）；**缺失时会生成新 token 写进宿主 home**。理论上改 spawn 的 `HOME` env 也能重定向该路径，但会波及 qemu 的所有 HOME 依赖，未验证不采用。共享 adb：无 server 时 emulator 会自行从 `ANDROID_SDK_ROOT/platform-tools` 拉起 server（协议版本 41，platform-tools 37.0.1）；对 5037 发 `host:version`（长度前缀 + `host:version`）是只读探测，返回 `OKAY` + 4 位十六进制长度 + hex 版本串。
- **怎么用**: runner 设计成不依赖 console——停止走 `detached` 进程组信号（SIGTERM→3s→SIGKILL），启动检测走 `adb -s <serial> shell getprop`。隔离结论：token 已存在的机器零触碰；全新机器会多一个 16 字节宿主文件（emulator 内建行为，env 无法关掉）。共享 server 存续策略：任何会连 server 的 CLI 之前先 smart-socket 探测版本，协议相容直接复用，不相容报可操作错误；spawn adb 时从 env 筛掉 `ADB_SERVER_SOCKET`、`ANDROID_ADB_SERVER_PORT` 等远端 endpoint 变量，锁定 `127.0.0.1:5037`。
