---
description: emulator 37.2.12 的 console token 恒读写宿主 ~/.emulator_console_auth_token，ANDROID_EMULATOR_HOME 重定向不覆盖——全新机器上首次启动会向宿主 home 写入新 token
---

# console token 逃出应用隔离目录

- **观察**：2026-10-05 runner 技术门槛实测（emulator 37.2.12，应用自有 SDK）。`ANDROID_EMULATOR_HOME` 指向空目录启动两台 AVD：adbkey/flags 落应用目录，但 console banner 与 auth 均指向 `$HOME/.emulator_console_auth_token`；宿主已有 token 时 hash/mtime 零变化，把宿主 token 移走后再启动，emulator 生成新 token 写回宿主 home（实测复现，已恢复原文件）。
- **复现条件**：任意实例启动；宿主 home 无既有 token 时触发写入。读取侧则任何一次启动都会读宿主 token 做-console 认证。
- **影响**：隔离不变量在该文件上有缺口。读取侧风险与 Studio 管理的模拟器同面（console 仅监听 localhost）；写入侧是全新机器上首次使用本应用会多出 16 字节宿主文件。v1 runner 不使用 console（停止走进程组信号），功能不受影响。
- **建议方向**：换 `HOME` env 重定向对 qemu 行为波及面大，需单独设计验证（crash 报告、Qt 设置等路径）；或跟进 emulator 新版本对该路径的 env 支持。修复属隔离专项，不阻塞 stage 04 步骤 4/5。

严重级：P3（本机实测零写入；仅全新机器首次启动新增一个文件，不阻塞功能）。
