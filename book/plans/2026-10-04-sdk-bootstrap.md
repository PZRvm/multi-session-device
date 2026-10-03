---
description: stage04 步骤 2 施工图——SDK bootstrap：检测/下载 JRE+cmdline-tools+platform-tools+emulator 四件套到应用自有 SDK 根，许可应用内确认写哈希，路径以 IPC 参数可自定义
status: approved
created: 2026-10-04
---

# SDK bootstrap 全量 — plan

> 批准记录：2026-10-04 用户下令执行 stage04 前三步并编写开发计划（批准同 poc-gate plan，分支 `feature/stage04-emulator-integration`）。前置：PoC 闸门过线。

## Requirements brief（Step 0）

**背景**：PRD E 要求零 Android Studio 依赖——应用把 SDK 四件套备到**应用自有 SDK 根**（默认 `userData/AndroidSDK`，即 `~/Library/Application Support/<产品名>/AndroidSDK/`），对用户 `~/.android` 与已有 SDK 零污染。stage 04 概述圈定 bootstrap 范围为 **JRE + cmdline-tools + platform-tools + emulator** 四件；系统镜像不在此步（步骤 3 向导内按需下载）。安装包内置 bootstrap 产物是打包期工作，本步先落**检测 + 下载**运行时路径。

**范围（影响什么）**：

- `src/main/emulator/`：新建模块（architecture 模块地图已规划 `main/emulator/sdk`）——SDK 根解析、四件套探测、许可确认与哈希落盘、下载解压、sdkmanager 子进程封装、进度事件
- `src/shared/`：SDK 状态/进度类型 + `sdk:*` 通道名
- `src/preload/`：`window.api.sdk` 白名单（status / bootstrap / onProgress 订阅）
- 新增 dev 级验证路径：真实 bootstrap 到临时根跑通一次
- `book/stage/04` 步骤 2 勾选回写

**排除项（明确不影响）**：

- 不做设置窗与 SDK 路径自定义 UI（stage 05）——本步「可自定义」落在**能力层**：bootstrap/detect 接受显式根参数，缺省 `userData/AndroidSDK`；持久化偏好随 stage 05 设置窗落地
- 不做全新机器首启自动 bootstrap 的 UX 流程（首次体验属 stage 05/向导接线步）；调用方拿到明确的「未就绪」状态
- 不下载系统镜像（步骤 3）
- 不复用用户已有 SDK 做 avd/emulator 来源（PRD F：存储层隔离；adb 共享 5037 是运行时行为，属步骤 4/5）
- 不做断点续传、多镜像源（下载失败可整段重试即可，PRD 风险表口径）
- electron-builder 打包集成（extraResources 内置 JRE/cmdline-tools、包体增量验收）不在本步——`bootstrap` 留 `sourceDir` 接缝（本地目录直接解压安装），打包轮填

**边界**：许可必须应用内确认后才写哈希（PRD 4.5：不静默接受）；拒绝则 bootstrap 中止且不写任何文件的一部分之外的东西（先下后解压，解压到临时目录完成后原子改名）；探测口径 = 各组件特征路径存在即已安装（version 可缺）。macOS-only（一期 Non-Goal 明确；解压用系统 bsdtar，Windows/Linux 二期重评估）。

**learn/ 检索**：无 SDK 域既有经验（本 stage 新域）；`2026-10-03-devices-persist-failure-divergence` 的教训反向适用——落盘与内存状态不分叉，全部以磁盘特征路径为准。

## Impact range（Phase 1）

| 文件 | 动作 |
| --- | --- |
| src/shared/types.ts | SdkComponent/SDK status/进度类型 |
| src/shared/ipc-channels.ts | `sdk:status` / `sdk:bootstrap` / `sdk:progress` |
| src/main/emulator/sdk.ts | 新建（探测/许可/下载/解压/sdkmanager 封装） |
| src/main/emulator/__tests__/sdk.test.ts | 新建 |
| src/main/ipc/index.ts | 挂载 sdk handler |
| src/preload/api/sdk.ts + api/index.ts | 新建 + 挂载 |

**风险**：sdkmanager 是 Java 程序且吃 `JAVA_HOME`（JRE 先装是硬顺序）；dl.google.com 的 cmdline-tools zip 固定 URL 带 build 号（版本钉死在常量，升级走显式改）；下载中途失败留半个目录（解压一律进 `<root>/.tmp-<组件>` 完成后 rename）；license 哈希写错导致后续镜像安装全挂（写 CI 惯例的标准三哈希，实测校验）。

## Design（Phase 2）

**SDK 根布局**（全部相对 `root`，缺省 `userData/AndroidSDK`）：

```
<root>/jre/                              Temurin 21 JRE（tar.gz 解压，bin/java 即 Contents/Home/bin/java）
<root>/cmdline-tools/latest/             官方 zip 原样结构（bin/sdkmanager、bin/avdmanager）
<root>/platform-tools/                   sdkmanager 装
<root>/emulator/                         sdkmanager 装
<root>/licenses/android-sdk-license      确认后写两行标准哈希
<root>/licenses/android-sdk-preview-license
<root>/.tmp-*/                           解压临时目录（完成后 rename，失败清走）
```

**数据流**：

```
preload sdk.bootstrap(root?) → main sdk 域
  1 detect(root) → 已齐四件则直接 ready
  2 缺许可 → dialog 确认框（主窗，列许可要点）→ 同意才写 licenses（拒绝：抛错中止）
  3 缺 JRE → 下载 Temurin 21 JRE tar.gz（GitHub adoptium 固定 release）→ tar -xf 解压 .tmp → rename
  4 缺 cmdline-tools → 下载 commandlinetools-mac-<pin>_latest.zip（dl.google.com）→ 同上
  5 缺 platform-tools / emulator → spawn sdkmanager（JAVA_HOME=<root>/jre/Contents/Home，
     ANDROID_USER_HOME 隔离）逐包装，stdout 百分比行解析成进度
  每步推 sdk:progress（{ stage, percent?, message }）；终态推 sdk:status
```

**接口**：

- `SdkSnapshot`：`{ root, jre, cmdlineTools, platformTools, emulator, licensed }`，组件项 `{ present, version? }`；`licensed` = licenses 两文件存在。
- `detectSdk(root?)`、`bootstrapSdk(opts: { root?, onProgress })`（导出纯函数供其他域复用，IPC 只是薄壳）。
- 下载器接缝：`fetcher`（URL → Buffer 流，可注入 fake）与 `unpacker`（spawn `tar -xf`，测试用 fixture 目录替换）——单测不碰网络。
- 版本常量集中文件顶：`TEMURIN_JRE_URL`、`CMDLINE_TOOLS_URL`（本机实测 cmdline-tools latest 为 16.x，pin 到当下 build 号）、许可哈希三个常量。

**许可确认**：dialog（沿用 `dialog:show` 既有通道的MessageBox 直调不新开通道——sdk 域在 main 内直接调 dialog 模块的函数）。文案列明：Android SDK 条款要点 + 对应许可名；按钮「同意并继续 / 拒绝」。

## Build order

1. shared 类型 + 通道——验证：typecheck 绿
2. sdk.ts 探测与根解析 + 单测（fixture 目录）——验证：组件测试绿
3. 许可确认 + 哈希落盘 + 单测（fake dialog）——验证：测试绿
4. 下载 + 解压 + 进度（fetcher/unpacker 注入）+ 单测——验证：测试绿
5. sdkmanager spawn 封装（fake runner 单测进度解析）——验证：测试绿
6. IPC + preload 挂载——验证：typecheck/lint 绿
7. 真机集成：bootstrap 到 `<userData>/AndroidSDK` 真根——验证：四件套齐、`<root>/jre/.../java -version` 出 21、licenses 两文件在、`sdkmanager --sdk_root=<root> --list_installed` 列出两包；全程进度推送可见（dev 页或 CDP 调用）
8. Phase 5 review 只记录 → Phase 6 回写

## Test plan（Phase 4）

- 单测：detect 布局判定（全缺/半缺/全齐 fixture）；许可守卫（拒绝不写文件、同意写两文件内容逐字节）；进度解析（sdkmanager `[===  12%]` 行、下载字节流回调）；bootstrap 计划器（组件缺失矩阵 → 期望步骤序列；全齐 → no-op）；解压临时目录失败清理路径
- 回归：既有测试全绿不削断言；typecheck/lint/prettier
- 真机集成（Build order 7）：一次真实 bootstrap，产物被步骤 3 的接真集成测试复用

## Done criteria

四件套真实落进应用自有 SDK 根且许可文件在案（真机集成通过）；单测/回归/typecheck/lint 全绿；「SDK 路径可自定义」以参数化根落地并在导出函数签名可见（设置 UI 记 stage 05）；`sdk:progress` 事件链路 IPC → preload 可订阅；review 发现只记 issue；stage/04 步骤 2 勾选附结果；`npm run book:index` 重刷。
