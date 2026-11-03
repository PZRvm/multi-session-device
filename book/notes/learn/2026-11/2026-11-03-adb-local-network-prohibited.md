---
description: 手机 Wi-Fi 与 5555 端口正常仍报 No route to host 时，检查共享 ADB 服务的 macOS 本地网络权限；本次重启服务后恢复
tags: [adb, wireless, macOS, local-network, No-route-to-host, investigation]
---

# ADB 的 No route to host 可能来自 macOS 本地网络权限

2026-11-03，三星 SM-A155F（Android 14）转无线失败。USB 读取到 wlan0 地址 `192.168.31.162/24`，`service.adb.tcp.port=5555`，手机确实监听 `*:5555`，也能 ping 通电脑 `192.168.31.134`。电脑 `nc` 能连接该端口，但 `adb connect` 立即返回 `No route to host`。

系统日志给出了直接证据：

```text
adb[20687] ... libinfo check path: unsatisfied (Local network prohibited), interface: en0[802.11], ipv4, uses wifi
UserEventAgent ... LocalNetwork: found bundle id dev.warp.Warp-Stable by UUID E616C3A8-6FE4-38B3-8B85-FBBA092CAD03
```

共享 5037 服务运行的是 Homebrew adb 36.0.2；应用使用 SDK adb 36.0.0 作为客户端，仍通过同一个服务连接手机。客户端换路径不能改变服务进程的网络权限归属。

系统设置中 Warp 和多开模拟器的本地网络开关都显示开启；系统权限归档另有同 bundle id 的不同记录。已确认旧服务被本地网络策略拦截；重复记录是否为直接触发条件，本次未进一步验证。

手工执行一次 SDK `adb kill-server`，共享服务重新出现后，`adb connect 192.168.31.162:5555` 成功，无线 shell 返回机型和 Android 版本，应用显示 Wi-Fi 已连接。未改权限、路由、代理或代码；未确认究竟哪个后台客户端抢先重建了服务。

下次遇到同类问题：

1. 分开验证手机地址、端口、电脑路由与 `adb connect`，保留 stderr。
2. 用 `/usr/bin/log show` 查 `Local network prohibited` 及相邻的 `LocalNetwork: found bundle id`；zsh 中裸 `log` 可能命中 shell 内建，必须写绝对路径。
3. 设置页开关开启不等于当前服务进程可访问；以失败进程的日志为准。
4. 必须重启共享服务时，先确认连接设备并说明短暂中断。应用日常流程仍遵守只 start、不自动 kill 共享服务的约束。

Apple 对子进程权限归属的说明见 [TN3179](https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy)。
