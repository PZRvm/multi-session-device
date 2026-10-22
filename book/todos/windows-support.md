---
description: Windows 支持的六份开发计划清单——每份做什么、解决什么问题
---

# Windows 支持：接下来的任务

调研依据：[外围问题调研](../notes/think-report/20261022110137-Windows兼容问题解决方案调研.md) · [主体工程调研](../notes/think-report/20261022125639-Windows适配主体工程调研.md)

- [x] **P1 SDK 引导平台化**（[plan](../plans/2026-10-22-windows-sdk-bootstrap.md)） — 让应用在 Windows 上能自己下载并装好运行所需的工具链（Java、命令行工具、platform-tools、模拟器）：下载包按平台选对版本、二进制路径补上 `.exe`/`.bat` 后缀、`.bat` 脚本用 `cmd.exe /c` 正确调用、解压改用 Windows 自带的 tar。
- [x] **P2 检测链 Windows 分支**（[plan](../plans/2026-10-22-windows-studio-detect.md)） — 让应用在 Windows 上能找到用户已装的 Android Studio 和 SDK：查默认安装位置、Studio 配置文件、环境变量、PATH 四条路径，全程不碰注册表。
- [x] **P3 进程管理 Windows 化**（[plan](../plans/2026-10-22-windows-process-mgmt.md)） — 让模拟器进程在 Windows 上能被完整停止（连同它拉起的 qemu 子进程一起，不留孤儿占端口）；关窗口时如果有设备在跑，先弹确认框再退出。
- [x] **P4 文件链路健壮性**（[plan](../plans/2026-10-22-windows-file-resilience.md)） — 下载/解压/挪目录时，遇到杀毒软件短暂锁文件或跨盘移动不再直接报错（自动重试、失败换复制）；下载校验改成边下边算，省掉一次 2GB 文件的整读。
- [ ] **P5 模拟器环境适配**（[plan](../plans/2026-10-22-windows-emulator-env.md)） — Windows 上只列出能跑的 x86_64 镜像并给出跨架构提示；模拟器起不来时识别是不是没开虚拟化（WHPX）并引导用户去系统设置开启；摄像头列表为空时给系统隐私设置入口。
- [ ] **P6 设置页收尾** — 设置页加「把 SDK 目录加入杀软白名单」的性能建议卡片；SDK 路径过长时提示；去掉 Windows 上系统标题栏与应用内标题重复的双标题观感。

## 备注

- 全部改动只加 Windows 分支，mac 行为零变化；单测都在 mac 上跑，全绿为准。
- 六份计划做完后，在你后续的 Windows 笔记本上做一次真机集成验证（真实下载、跑模拟器、WHPX、驱动差异）。
- 暂不排期：模拟器控制台优雅退出、Windows 窗体视觉统一（titleBarOverlay）。
