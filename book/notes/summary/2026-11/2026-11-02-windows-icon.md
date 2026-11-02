---
description: Windows 使用无底板、屏幕镂空的三手机透明图标，覆盖窗口、可执行文件与关于页，黑屏版已覆盖，macOS 原图保留
---

# Windows 透明图标

## 背景

用户要求 Windows 图标去掉 macOS 版的底板，让图案撑满。

## 做了什么

用 Codex 内置 imagegen 生成三手机透明图标，保留橙黄前层、深灰中层、浅灰后层。用户先尝试白屏、黑屏，最终选用三块屏幕都镂空的版本；外部背景和屏幕内部都能透出桌面颜色。

- 母版：`resources/logo-multi-session-device-windows.png`，1254×1254 RGBA。
- 应用图：`resources/icon-windows.png`，512×512 RGBA。
- 打包图：`build/icon.ico`，包含 16/24/32/48/64/128/256px 七档。

主进程统一图标入口按平台选图，覆盖各窗口与原生对话框。关于页复用设置窗传入的平台值选择图片，尺寸与布局不变。

## 为什么这样选

Windows 打包配置已引用 `build/icon.ico`，直接替换即可。运行时单独增加 PNG，避免改动 macOS/Linux 现有图片；所有主进程消费方已经共用入口，无需逐窗修改。图片导出只做缩放与格式转换，保留生成结果的 alpha。

## 结果

平台接入时，类型检查、lint、源码格式检查、生产构建和 Windows 目录打包通过。三个相关测试文件的 21 项测试通过；真实 Electron NativeImage 检查构建输出与 asar 中三个平台分支，共六项通过；Windows 从 EXE 提取的图标已确认是新图。四份旧 PNG/ICNS 与 HEAD 字节一致。

全量测试在替换前已有 153 项失败，已另记 [Windows 测试基线问题](../../issue/2026-11/2026-11-02-windows-test-baseline.md)，未扩大本次修复范围。未执行安装器安装验收。

独立评审按八项清单检查本次资源与平台接入，未发现需记录的 P0–P3 问题。

黑屏修订只替换图片，未修改源码。三个屏幕抽样 RGB 均为 0/0/0、alpha 为 254，四角完全透明，七档 ICO 均可解码；生产构建、Windows 目录打包、六项 NativeImage 检查再次通过，EXE 提取图标为黑屏版。本轮未重复运行源码类型/lint/单元测试。原尺寸复核发现的少量 [母版边缘杂色](../../issue/2026-11/2026-11-02-windows-icon-master-edge.md) 按 P3 记录，未在评审阶段继续修改。

本地免安装验证产物：`dist/windows-icon-check/win-unpacked/multi-session-device.exe`；NativeImage 检查记录：`dist/windows-icon-check/native-icon-verification.json`。这些产物被 git 忽略。

透明屏幕版已正式替换。母版直接复制获选生成原图，字节一致；仅使用 Electron NativeImage 缩放导出 PNG 和封装七档 ICO，未使用 Python、未修图。母版及运行时图三屏抽样 alpha 都为 0，框体仍有实体像素；七档 ICO 帧可解码。生产构建、Windows 目录打包和六项平台图标检查通过，从 EXE 提取的 32px 图标三屏抽样 alpha 也为 0。四份 macOS/Linux 原图字节未变；本轮未重复执行源码类型/lint/单元测试。

原黑屏母版、PNG 和 ICO 已被同名透明版覆盖；已采用的 `logo-multi-session-device-windows-transparent-preview.png` 删除，不保留重复资源。项目仍使用的原 macOS/Linux 图片保留，Codex 生成缓存不在本次清理范围内。

## 后续

透明版已供应用使用。后续如调整图案，从正式母版 `resources/logo-multi-session-device-windows.png` 开始，不再依赖已删除的预览副本。

重新启动开发应用或使用新打包产物可加载新图；本任务未替换机器上已有安装。计划与定稿提示词见 [Windows 透明图标计划](../../../plans/2026-11-02-windows-icon.md)。
