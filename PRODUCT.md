# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

界面由 Electron 内的 React renderer 绘制；一期宿主为 macOS。Android 是被测设备平台。

## Users

移动端软件测试工程师，主要测试 Flutter / React Native 应用，需要并行使用多账号、多环境和多设备。用户懂设备画像与系统镜像，宿主不一定安装 Android Studio。

## Product Purpose

在同一桌面应用中创建、管理和操控隔离的 Android 模拟器。左侧列表管理设备，右侧显示当前设备；后台设备继续运行。

## Positioning

应用创建的 AVD 数据目录独立于 Android Studio，运行设备通过共享 adb 接受 IDE 部署。SDK 默认由应用托管，规划支持共享 Studio SDK 和自选可写目录。

## Operating Context

全本地 Electron 应用。用户选择画像与系统镜像、创建设备，再启动并投屏操控；设备列表是唯一切换入口。系统镜像按需下载。

## Capabilities and Constraints

- 一期需求以 `book/docs/PRD.md` 为准；实现进度以 `book/stage/` 为准，规划能力不等于已交付能力。
- 一期界面语言确定为简体中文、繁体中文、英文，在设置窗口选择。
- 设置规划含通用、模拟器、快捷键、关于和危险区；SDK 来源包括应用托管、共享 Studio 只读、自选可写。
- 默认并行上限为 2；内存提醒阈值的单位、默认值和合法范围尚未定稿。
- 危险区操作为删除本工具创建的全部设备，采用两步确认。
- 一期不支持 iOS、Windows/Linux、群控或工作区分组。
- renderer 通过 preload 白名单访问主进程；用户偏好由主进程持久化。

## Brand Commitments

沿用 `DESIGN.md` 与 `src/shared/themeSystems.ts` 的现有设计系统。产品中文名定为「多开模拟器」，与姊妹项目「多会话测试浏览器」同族命名；仓库名保持 `multi-session-device`，安装包文件名沿用 ASCII。

## Evidence on Hand

- `book/docs/PRD.md`：已批复需求及验收标准。
- `book/stage/05-功能完善.md`：设置窗口与 SDK 来源的阶段范围。
- `book/notes/think-report/20261009022552-SDK共享检测与真机投屏.md`：已确认的 SDK 来源边界。
- `src/renderer/src/`：现有设备列表、向导、编辑窗与主题组件。
- `resources/icon.png`：已有应用图标；正式产品名和正式发布版本不应由设计稿虚构。

## Product Principles

- 设备生命周期与投屏状态如实呈现。
- SDK 可显式共享，AVD 数据始终独立。
- 实现能力与规划能力在验收中分别核对。
- 配置事实源在主进程，renderer 负责呈现与发起请求。
