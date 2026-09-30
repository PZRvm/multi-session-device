# multi-session-device

多会话模拟器：面向软件测试人员的 Electron 桌面工具。左侧管理多个完全隔离的模拟器实例（Android AVD / iOS Simulator），右侧以 tab 方式切换当前实例的嵌入画面并直接操控——每台设备登录态、应用数据互不影响。

> 当前处于骨架阶段：仓库内是 electron-vite 脚手架，模拟器管理、画面嵌入等模块按计划逐步落地，进度见 `book/stage/`。

## 功能（规划）

- **多实例隔离**：新建会话即创建一台全新模拟器实例，每会话独立 AVD（克隆产生）或独立 Simulator 设备，数据互不污染
- **画面嵌入**：安卓走 scrcpy 协议视频流 + WebCodecs 解码；iOS 无公开帧流 API，走 ScreenCaptureKit 窗口采集
- **直接操控**：点击嵌入画面即操作设备，触摸/指针事件反向注入
- **多台并行**：Android 官方 emulator 支持最多 64 台并发（控制台端口 5554–5682）；iOS Simulator 实测 Apple Silicon 16GB 每台约 1.3GB 内存，10 台最优、14 台可达（需调系统 fd 上限）

## 技术栈

Electron 39 + electron-vite 5 + React 19 + TypeScript 5.9，只用 npm。

三进程结构，数据流单向，主进程是唯一事实源：

| 进程 | 目录 | 职责 |
|------|------|------|
| 主进程 | `src/main/` | 窗口创建、模拟器实例生命周期、画面流编排、IPC handler |
| 预加载桥 | `src/preload/` | contextBridge 暴露白名单 `window.api`，不暴露原始 ipcRenderer |
| 渲染进程 | `src/renderer/` | React 纯 UI，禁止直接访问 Node/Electron API |

跨进程共用的类型与通道名单源在 `src/shared/`（规划中）。

## 平台依赖

- **Android**：SDK 四件套（cmdline-tools、emulator、system image、platform-tools），应用内引导安装，不需要 Android Studio；已有 `ANDROID_HOME` 可直接复用
- **iOS**：仅 macOS，依赖本机 Xcode（Simulator runtime 不可随 App 分发，只能检测/引导安装）；画面采集需「屏幕录制」授权，触控注入需「辅助功能」授权

## 本地开发

```bash
# 安装依赖
$ npm install

# 开发模式
$ npm run dev

# 类型检查 + lint（提交前必过）
$ npm run typecheck
$ npm run lint

# 打包
$ npm run build:win     # Windows
$ npm run build:mac     # macOS
$ npm run build:linux   # Linux
```

## 仓库结构

```text
multi-session-device/
├── src/         # 源码：main / preload / renderer 三进程
├── book/        # 文档与知识库：规则、阶段、笔记、架构快照、施工图
├── skills-zh/   # BoCode 工作流的四个 agent skill（bocode / boscope / book-writeback / bowrite）
├── resources/   # 随包静态资源
└── build/       # electron-builder 图标
```

## 文档

代码回答"它现在怎么跑"，`book/` 回答"它为什么长这样、做过什么决定、踩过什么坑"：

| 想知道 | 去看 |
|--------|------|
| 目录结构与模块落点 | `book/docs/architecture/项目骨架.md` |
| 技术可行性与选型依据 | `book/notes/think-report/` |
| 项目走到哪、下一步做什么 | `book/stage/` |
| 这个仓库怎么干活（六阶段关卡） | `book/guidelines/workflow.md` |

AI agent 从根目录 `AGENTS.md` 进入。

## 同系列

姊妹项目 `multi-session-browser`（多会话测试浏览器），壳层与交互语言同源。
