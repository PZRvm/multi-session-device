# multi-session-device

面向软件测试人员的 Electron 桌面工具。每台 Android 设备使用独立 AVD，左侧列表管理与切换设备，右侧显示当前设备画面并直接操控。

阶段 4 已完成基础 Android 链路，当前验收平台为 macOS Apple Silicon + arm64 镜像。阶段 5 的日志、截屏/录屏、APK 安装、剪贴板、断网和设置窗仍待实施；iOS 属二期。

## 当前能力

- 应用内引导 SDK、选择画像与精确系统镜像、下载镜像、配置并新建独立 AVD。
- 启动、准备期取消、停止、删除与重命名；运行状态实时推送，运行中的 serial 可复制。
- scrcpy 视频流与 WebCodecs 画布；触控、滑动、双指操作、键盘/IME、返回/主页/概览、音量和手动旋转。
- 电源按钮停止设备并显示停止占位，重新运行从左侧启动；旋转期间的新输入直接丢弃，已有按键和触点释放。
- 具体机型皮肤导入、固定官方源获取、缓存与投屏几何；宿主摄像头枚举、配置和权限入口。

Quick Boot 稳定性、Android 摄像头取景和六类设备的完整验收仍待完成；Quick 选择器保持禁用。验收范围和遗留见 [阶段 4](book/stage/04-模拟器对接.md) 与 [当前运行说明](book/docs/architecture/2026-10-08-android-runtime.md)。

## 技术栈

Electron 39 + electron-vite 5 + React 19 + TypeScript 5.9，只用 npm。

三进程结构，数据流单向，主进程是唯一事实源：

| 进程     | 目录            | 职责                                                          |
| -------- | --------------- | ------------------------------------------------------------- |
| 主进程   | `src/main/`     | 窗口创建、模拟器实例生命周期、画面流编排、IPC handler         |
| 预加载桥 | `src/preload/`  | contextBridge 暴露白名单 `window.api`，不暴露原始 ipcRenderer |
| 渲染进程 | `src/renderer/` | React 纯 UI，禁止直接访问 Node/Electron API                   |

跨进程共用的类型与通道名单源在 `src/shared/`。

## 平台依赖

- SDK 与 AVD 默认放在应用 `userData` 下的 `AndroidSDK/`、`avd-home/`；新建不依赖 Android Studio，当前没有设置窗供用户更换 SDK 根。
- 运行设备使用本机共享 adb server（127.0.0.1:5037），已有 adb 可执行文件优先；协议不相容时拒绝启动，不自动重启共享服务。
- 宿主摄像头需要本应用的 macOS 权限，Android 内取景与正式签名版仍待人工验收。

## 本地开发

```bash
# 安装依赖
npm install

# 开发模式
npm run dev

# 类型检查 + lint（提交前必过）
npm run typecheck
npm run lint
npm test

# 三进程构建（含类型检查）与 macOS 打包
npm run build
npm run build:mac

# 文档索引与卫生检查
npm run book:index
npm run book:release-check
```

## 仓库结构

```text
multi-session-device/
├── src/         # 源码：main / preload / renderer 三进程
├── book/        # 文档与知识库：规则、阶段、笔记、架构快照、施工图
├── scripts/     # book 索引、卫生与提交主题校验
├── .codex/skills/ # BoCode 工作流 skills
├── resources/   # scrcpy-server 与随包静态资源
└── build/       # electron-builder 图标与权限配置
```

## 文档

代码回答"它现在怎么跑"，`book/` 回答"它为什么长这样、做过什么决定、踩过什么坑"：

| 想知道                         | 去看                                                                       |
| ------------------------------ | -------------------------------------------------------------------------- |
| 当前模块、状态机与排查入口     | [Android 运行说明](book/docs/architecture/2026-10-08-android-runtime.md)   |
| 技术可行性与选型依据           | [book 总索引](book/README.md) 的 think-report 分类                         |
| 本次交付、遗留与下一阶段       | [阶段 4](book/stage/04-模拟器对接.md)、[阶段 5](book/stage/05-功能完善.md) |
| 这个仓库怎么干活（六阶段关卡） | [工作流](book/guidelines/workflow.md)                                      |

AI agent 从根目录 `AGENTS.md` 进入。

## 同系列

姊妹项目 `multi-session-browser`（多会话测试浏览器），壳层与交互语言同源。
