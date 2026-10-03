---
description: 手机图标接入主窗、向导窗、macOS Dock、全部原生提示框和各平台打包配置
status: completed
created: 2026-10-04
---

# 应用图标接入

用户要求将已生成图标用作项目 icon，应用内提示框也用同一图片。

## 范围与现状

资源 PNG/ICNS/ICO 已就位。当前主窗只在 Linux 传 icon，向导窗和原生提示框未指定 icon；macOS 开发运行仍沿用 Electron 的 Dock 图标。

范围：主进程应用入口、两个窗口、dialog 通道、图标资源入口和 electron-builder 配置。不改变设备业务、提示框按钮/返回值、renderer/preload 白名单、界面布局或依赖。

## 设计

- `src/main/app-icon/index.ts` 从 `resources/icon.png?asset` 创建一个 NativeImage，窗口、Dock、提示框共用。
- 主窗和向导窗均传入 icon；macOS 在 ready 后设置 Dock icon。
- dialog 运行时守卫保持原状，通过校验后主进程统一追加 icon，覆盖调用者自行传入的图片。有父窗/无父窗两条路径均使用它。
- 打包配置明确指定 Windows ICO、macOS ICNS、Linux PNG。

## 验证与收尾

运行 typecheck、lint、现有测试和生产构建。隔离运行构建产物，验证图片解码、Dock 调用、对话框父窗/无父窗分支和非法输入拒绝，并查看原生提示框实际图标。review 只记录；完成后翻状态、补阶段结果、重刷 book 索引。

结果：typecheck、全仓 lint、变更文件格式检查、47/47 测试和生产构建通过。隔离冒烟确认图片非空且为 512×512、Dock 与 dialog 共用图片、父窗/无父窗分支均注入图标、调用者 icon 被覆盖、原有取消按钮和返回值保留、非法输入继续拒绝，向导可打开关闭。

macOS 未签名目录包生成成功，包内运行时 PNG 与资源字节一致；实际打开包内应用，经原有 preload API 调用中文原生提示框，确认手机图标、正文和「知道了」按钮正常显示并关闭。验证实例已退出。Windows/Linux 配置已指定图标，未在对应系统运行验收。review 未发现新增问题；未改 renderer 或设备数据。
