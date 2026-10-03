---
description: macOS 上 emulator 是启动器、真身是 qemu 子进程——停止要按进程组整组 kill，否则残留实例抢 AVD 锁让新实例静默 exit 1
tags: [android, emulator, process, macos, spawn]
---

# 模拟器停止要按进程组整组 kill

- **Scenario**: 程序化启停 Android 模拟器，或遇到「新起的模拟器秒退 exit 1、无 stderr」「连续两台实例抢同一端口」。
- **Why**: `~/Library/Android/sdk/emulator/emulator` 是启动器，实际虚拟机是它拉起的 `qemu-system-aarch64-headless` 子进程。只 kill 启动器（或启动器对 SIGTERM 无响应时）会留下 qemu 残留——残留实例占着 AVD 锁与 console 端口，下一个实例**静默 exit 1**（无 stderr、无崩溃报告），极难排查。
- **怎么用**: spawn 时 `detached: true` 建独立进程组；停止按组发信号：`process.kill(-child.pid, 'SIGTERM')`，3 秒未退升级 `SIGKILL`。启动前用 `adb devices` 检查目标 serial（`emulator-5554`）是否已被残留占用并显式报错，比事后排查看不出原因的 exit 1 划算得多。
