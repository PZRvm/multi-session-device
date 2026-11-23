---
description: 按多会话测试浏览器的 Sparkle、electron-updater 与 NSIS 机制规划多开模拟器的更新、发布和设备保护
status: in_progress
---

# 多开模拟器应用内更新开发计划

分级 **L**。跨主进程、共享 IPC、两平台安装和发布信任，涉及设备数据保护。本文覆盖 Step 0、Phase 1 和 Phase 2 的设计草案。用户已确认按多会话测试浏览器现行实现移植，用户已授权开发和临时密钥隔离升级验收，正式密钥和发布留待后续。[调研报告](../notes/think-report/20261123152107-应用内更新.md)

## Step 0 · 需求简报

- **背景**。当前用户从 GitHub 手动下载 Preview 安装包。多会话测试浏览器已经把稳定版检查、版本日志、下载和重启安装接在同一流程中。
- **范围**。按参考项目移植更新控制器、平台引擎、交互和稳定版发布链。Mac 使用 Sparkle，Windows 由 electron-builder 构建 NSIS，运行时由 electron-updater 检查、下载和交接安装。首期按本项目现有安装包矩阵规划 macOS Apple Silicon 和 Windows x64，沿用 `dev → main` 合并发布。
- **排除**。预览版应用内渠道、Intel Mac、Linux、Windows ARM、Electron 大版本升级、差分强制要求、强制更新和自动回滚功能。应用升级包只替换应用，不搬迁 SDK、系统镜像、AVD、录制文件或用户数据。
- **边界**。只接受比当前版本新的稳定版本。手动检查只接受受信窗口或主进程菜单发起，只有用户明确确认并通过设备保护后可授权安装。开发构建、两入口全关和不支持平台均不加载平台引擎或请求更新源。
- **验收体验**。启动只检查。用户从板头、关于页或 macOS 菜单查看版本说明，选择下载；下载就绪后询问「稍后 / 重启安装」。普通退出不触发安装。忙态显示可重试原因；安装成功后打开新版，设备与设置仍可正常读取。

## Phase 1 · 影响范围

| 区域 | 接入点 | 主要风险 |
| --- | --- | --- |
| 主进程、IPC | [main/index.ts](../../src/main/index.ts)、[ipc/index.ts](../../src/main/ipc/index.ts)、[设置窗口归属](../../src/main/window/settings.ts)、[preload](../../src/preload/index.ts) | 安装授权与退出竞态，多窗口重复操作，错误或迟到事件推进状态。 |
| 设备与数据 | [自有设备清理](../../src/main/devices/lifecycle.ts)、[写队列与配置事务](../../src/main/devices/persistence.ts)、[设备存储](../../src/main/store.ts)、[录制管理](../../src/main/recording/manager.ts) | 录制封装未完成，设备配置半写、AVD 休眠事务中断、重启中断共享 ADB。 |
| 用户入口 | [板头](../../src/renderer/src/components/BoardHead.tsx)、[关于页](../../src/renderer/src/components/settings/PaneAbout.tsx)、[三语字典](../../src/shared/i18n) | 更新状态跨窗口不同步，窄板头占位，重复或失焦的原生确认。 |
| 打包与发布 | [打包配置](../../electron-builder.yml)、[Mac 签名钩子](../../scripts/adhoc-sign-mac.cjs)、[发布工作流](../../.github/workflows/release.yml) | 当前只有 Preview，Mac 原生输入与参考 Electron 不同，CI 可能上传不完整的更新资产。 |

## Phase 2 · 设计

移植以多会话测试浏览器 `ccf53f0` 为准。浏览器的状态机、引擎行为、更新资产格式与发布校验直接作为对照，模拟器保留自己的窗口、安全边界、应用标识、设备退出流程和文档目录。

| 参考实现 | 本项目如何落地 |
| --- | --- |
| [更新控制器](https://github.com/PZRvm/multi-session-browser/blob/ccf53f0/src/main/updateController.ts)、[引擎与 IPC 接线](https://github.com/PZRvm/multi-session-browser/blob/ccf53f0/src/main/updates.ts) | 复用状态迁移、版本绑定、进度、错误处理，以及下载就绪后的单次原生确认。主进程登记本项目的主窗与设置窗。 |
| [Sparkle 适配器](https://github.com/PZRvm/multi-session-browser/blob/ccf53f0/src/main/updates/macSparkle.ts)、[原生桥](https://github.com/PZRvm/multi-session-browser/blob/ccf53f0/native/sparkle/bridge.m) | 复用候选、显式下载、安装授权与取消时序。构建固定模拟器当前 Electron 版本的头文件，用目标仓库地址和目标项目的签名密钥。 |
| [安装准备](https://github.com/PZRvm/multi-session-browser/blob/ccf53f0/src/main/updatePreparation.ts)、[发布手册](https://github.com/PZRvm/multi-session-browser/blob/ccf53f0/.github/RELEASING.md) | 沿用确认、排空、严格保存、安装授权的顺序，保存和停机调用模拟器现有生命周期模块。沿用同版本归档、日志与清单对账，保留本仓库合并发布条件。 |

### 1. 更新状态、权限与入口

- 新增 `src/shared/updates.ts` 定义状态和版本绑定，新增 `src/main/updateController.ts`、`src/main/updates.ts` 装配单例与平台引擎。按 `disabled / idle / checking / up-to-date / available / downloading / ready / preparing / installing / error` 表达阶段。快照带当前版本、候选及就绪版本、日志、进度、错误码和递增 `revision`。检查、下载和安装互斥，同一就绪版本只主动弹一次确认。
- 在 `src/shared/ipc-channels.ts`、`src/preload/index.ts`、`src/preload/index.d.ts` 只增加读取状态、订阅、检查、查看详情、下载和安装意图。主进程核对已登记主窗或设置窗、当前本地顶层 frame 和请求参数。详情窗使用独立受限回执，动作绑定当前候选及窗口；迟到回执和旧 revision 不得覆盖新状态。Feed URL、文件路径和平台安装接口留在主进程。
- renderer 在主窗和设置窗按 `revision` 镜像快照。板头显示可用、进度或就绪，关于页「数据目录」下提供手动检查和状态；macOS 应用菜单在「设置…」下提供同一手动检查入口。以应用现有主题、三语字典、原生窗口和系统确认实现；详情只渲染限长的安全文本，版本日志读取失败有清晰回退。主窗后台检查失败不反复弹框。布局用 impeccable 设计，核对窄板头、键盘焦点、深浅主题和拖拽区。
- 构建策略由 `electron.vite.config.ts` 注入。按参考项目将板头和关于入口显隐固定为构建配置。两入口均关闭时菜单项随之隐藏，更新器零联网。日常 dev 和本地手动包仍可构建。已启用的隔离验收包使用独立身份与受限测试源，验收选项不成为发布版的运行时开关。

### 2. 两个引擎

| 平台 | 文件与行为 |
| --- | --- |
| macOS arm64 | 新增 `native/sparkle/bridge.m`、`src/main/updates/macSparkle.ts`、SDK pin 和编译脚本。以模拟器锁定的 Electron 头文件、Sparkle 2.10.1 和目标架构验证加载、部署目标及原生 helper。打包钩子在已有应用标识、权限说明、entitlements 和资源布局下嵌入 framework、bridge 和公钥，最后 ad-hoc 签包。候选回复留到用户授权下载，就绪回复留到安装准备完成。普通退出先等待原生取消结果；若取消状态不明，应用留在原版并说明原因。 |
| Windows x64 | 在 package/lock 中锁定 `electron-updater 6.8.9`，NSIS 继续使用现有 appId、可执行文件名、安装范围和安装包命名。由 builder 生成 GitHub provider 的 `app-update.yml`；沿用浏览器的 `autoDownload=false`、`autoInstallOnAppQuit=false`、`allowPrerelease=false`、`allowDowngrade=false`。准备通过后调用 `quitAndInstall(false, true)`，用安装专用状态避免再次走普通退出确认。检查无候选、更新源不可用与资源损坏分别反馈。 |

### 3. 安装准备与恢复

1. 检查和下载可在日常工作中进行。准备重启时如有空闲运行的应用自有 AVD，确认框说明它们会正常停止；真机保持连接。「稍后」不做关停。
2. 用户确认后，在主进程串行进入准备态，暂停接纳冲突命令并重新核对状态。至少覆盖录制采集和待封装、APK 安装、SDK 包下载与安装、迁移或写入型来源切换、ADB 修复、AVD 启停/休眠/恢复、配置事务。复用各域状态与入口守卫；已有任务忙时明确延后。更新过程不走普通退出的录制丢弃与设备强退分支。
3. 在冻结下等在途写入结算并检查每项结果，核对设备存储健康和配置事务是否已到可安全重启的状态。等队列尾不能代替校验任务结果。随后复用已有自有 AVD 清理与流收尾，只有无残留且清理成功时才允许引擎交接。不得关闭外部模拟器、拔掉真机连接或停止共享 ADB。
4. 交接前复核候选身份与准备状态。保存失败、清理失败、超时或撤销时继续运行旧版，待底层工作和原生撤销真正落定后再解锁，恢复命令与外部会话。已停止的 AVD 如实显示为停止；用户可手动再启动。普通退出和系统会话结束沿用项目规则，并覆盖 Mac 取消与 Windows 关窗的一次性仲裁。

### 4. 发布清单和信任

- 保留 `.github/workflows/release.yml` 的 PR 来源、合并 SHA、同版本不覆盖和 Windows/macOS 验证门禁。首期以明确授权的稳定发布为分界，验证完成前用隔离源；现有 Preview 继续手动分发。现有用户手动安装首个包含更新器的稳定版，再由下一版验证正式通路。
- 为每个启用更新的版本准备唯一 `.github/release-notes/v<version>.md`。正文非空且至多 12000 字符，同源生成 GitHub Release 正文、Windows `latest.yml.releaseNotes`、Mac Markdown 附件。版本号对齐 `package.json`、lock、Tag、实际安装包和清单。已有 Preview 说明留作历史或手动发布输入。
- Mac 在现有 DMG 基础上加 arm64 ZIP 并保留 Framework 符号链接、包内权限和最终签名；启用更新的包用目标仓库的 `releases/latest/download/appcast-arm64.xml`，清单内 ZIP 和版本日志固定到同 repo 的版本 Tag。项目独立的 Sparkle 公钥写进包，正式私钥仅流经 Mac 签名步骤；测试包使用独立密钥。生成清单后验证归档身份、版本、架构、长度、签名和 URL。Windows 验证 `latest.yml` 对应现有 EXE 及其 SHA-512、可选 blockmap 和日志；Windows 沿用参考项目现有的未签名 NSIS 分发，发布说明写明校验范围和可能出现的系统提示。
- 首个正式包打出前，由维护者用 Sparkle `generate_keys` 为多开模拟器单独生成一对密钥。在目标 GitHub 仓库设置 Actions Variable `SPARKLE_PUBLIC_ED_KEY` 和 Secret `SPARKLE_PRIVATE_KEY`。公钥进入 `Info.plist` 的 `SUPublicEDKey`，私钥供官方 `sign_update` 使用并由维护者在仓库外备份，后续发布复用同一密钥。CI 缺少密钥、密钥不匹配或归档验签失败即终止。此步骤在正式发布准备阶段执行，隔离验收使用测试密钥。
- 两个平台齐全后生成 `SHA256SUMS`，草稿上传并对账远程附件后才设为稳定 Latest。任何验证失败保持草稿，已公开版本保持不可覆写。发布后从无认证客户端复查 Latest 与平台资源实际可达。发现发布缺陷时暂停推广，用更高的修正版前滚；已有客户端继续拒绝降级。

## 实施顺序

| 顺序 | 阶段与工作 | 核对结果 |
| --- | --- | --- |
| 1 | Phase 2 核对目标 Electron 头文件、最低 macOS 与发布输入，记录项目 ADR。 | ADR 纳入已确认的浏览器双引擎和交互方案，明确目标仓库更新源、当前平台矩阵和安装授权。 |
| 2 | Phase 3 用独立的旧版和新版接通两种引擎、包结构与隔离清单。 | 两端能发现新版，普通退出不安装，显式许可后能实际替换并重启。 |
| 3 | Phase 3 接入主进程状态、可信 IPC 与安装保护，再接板头、关于页和 macOS 菜单。 | 不存在从 renderer 直达安装器的入口；失败时旧版可恢复使用。 |
| 4 | Phase 3 接入版本日志、构建资产、草稿对账与完整性门禁。 | 隔离发布演练只在产物齐备后允许公开；预览构建不指向稳定 feed。 |
| 5 | Phase 4 跑 Vitest 定向回归、项目测试、lint、typecheck、生产构建及两平台真实安装包升级。 | 按下表保留结果和证据。 |
| 6 | Phase 5 按项目审查表核对，发现问题登记 issue；Phase 6 写回架构、发布说明、summary 与必要的 learn，刷新索引。 | 各交付平台有证据；正式推送与发布按项目授权流程。 |

## Phase 4 · 测试计划

| 对象 | 需要验证 |
| --- | --- |
| 控制器与 IPC | Dev / 禁用 / 不支持平台零请求。正常检查、最新、断网重试、旧版与预发行拒绝。候选在日志窗开启期间变化时拒绝旧回执。拒绝未登记窗口、子 frame 和多余参数。并发下载、迟到事件和重开窗口不重复确认或倒退状态。 |
| 安装准备 | 录制封装、APK、SDK 写入、ADB 修复、AVD 状态变化期间只允许延后。读盘错误、只读、配置事务错误、残留 AVD、超时或迟到完成均无法越过门禁。检查确认后至冻结之间的竞态，故障退回后真机流可恢复且已停 AVD 状态如实。 |
| 发布夹具 | 预览版不进入稳定源；缺清单、错架构/版本、错 URL、错哈希/签名、缺日志或日志不一致拒绝发布。确认标准安装包、更新附件和现有 asar 校验均通过，发布不覆盖旧版本。 |
| Mac 真机 | ARM64 两个不同版本，隔离 appId、数据目录、SDK/AVD 与签名材料。覆盖下载、选择稍后、取消后普通退出、重开重下、篡改 ZIP、替换重启。验证设置、设备列表顺序、休眠清单、现有权限提示和基础投屏。 |
| Windows 真机或合格 VM | 已安装 NSIS 旧版到新版，覆盖升级与重启、安装目录与快捷方式、留在应用与正常退出、损坏下载或安装失败，以及设备配置、真机连接和基础投屏。记录未签名时实际系统提示；需要硬件的用例另留实机证据。 |

## 2026-11-23 实施与验收

- [x] 实现双引擎、更新入口和安装准备。决策记录见 [ADR-008](../docs/decisions/ADR-008-app-update-engines.md)。
- [x] Mac Apple Silicon 用独立测试应用、数据目录、loopback feed 和临时 Ed25519 密钥实测 `90.0.1 → 90.0.2`。启动只查，版本说明能打开，下载后原生确认可选「稍后」。普通退出仍为旧版，重开需要重下。确认后 Sparkle 真实替换并重新启动，隔离数据标记保留。相同归档用错误公钥校验失败。
- [x] Windows x64 两个隔离 NSIS 安装包及更新清单构建通过。检查 EXE 大小及 SHA-512、asar 与本地 feed。Mac 上通过 Windows NSIS 更新器的隔离验证确认它能读取实际 `latest.yml`、发现新版并在显式下载后校验实际 EXE。
- [ ] 在 Windows 真机或 VM 安装旧版，验证原生安装交接、进程退出重启和设备数据。当前测试机为 Apple Silicon，未执行 Windows 安装程序。
- [ ] 在专用测试设备验证升级忙态、设备配置保持、录屏和共享 SDK 边界。现有 Vitest 检查准备失败时不调用引擎，隔离 Mac 升级验证覆盖数据目录连续性。
- [ ] 发布前由维护者配置正式密钥和稳定渠道开关，按合并发布流程操作。当前没有推送、发布或改生产密钥。

## 完成标准

两端都用隔离的已安装旧版成功替换并启动新版，保存与任务门禁有可复核结果，逃逸路径和负向资产用例全部通过。PR 发布演练能生成准确资产，维护者确认正式渠道与密钥后才启用。审查结论和已验证范围写回书，未验证事项保留明确状态。实现已落地。Windows 的安装交接留待 Windows 环境验证，正式发布留待维护者授权。

## 更新界面校准

本轮为 M 级的现有更新界面修订。用户要求以多会话浏览器实际渲染为参照，并核对关于页按钮与文案。范围限于关于页和更新入口的状态呈现、原生子窗的版式与版本说明。沿用现有版本、发布开关、更新引擎与安装权限。

- Phase 1 已用隔离的浏览器开发实例渲染其详情组件和样式。现有模拟器详情用系统色、带边框的原文区和普通有框窗口，关于页的动作标签和描述也有差异。
- Phase 2 按浏览器的 480×420 内容、无框 macOS sheet、同层标题和版本、滚动说明、分隔底栏来实现。沿用本项目主题变量和最小权限静态页面。关于行把状态与右侧按钮分开，状态优先错误、候选、最新或进行中，动作在检查、更新、下载进度、重启和重试之间切换。
- 开发和验收使用隔离安装包及环回更新源。本项目的版本字段以运行时为准，普通开发/Preview 构建沿用现有更新策略。升级验收与发布工作继续由原计划跟踪。
- Phase 4 已在 Mac Apple Silicon 隔离包验证设置「关于」、`90.0.1` 显示和手动检查。环回源切换后出现 `90.0.2`，点击「更新」打开 480×420 的原生详情子窗，示例日志正确呈现标题与列表，琥珀主按钮与浏览器参考同色。点击「稍后」关闭，环回源没有收到 ZIP 请求。
- 本轮界面校准完成，原计划中的 Windows 真实安装和发布保持待验。

## 2026-11-23 代码审查

审查基线为更新分支 `30c4ded`。类型检查、lint、Actionlint 与 1,712 项 Vitest 测试通过，8 项跳过。补查的两条 Mac 边界路径已用隔离替身确认，详见[代码审查问题记录](../notes/issue/2026-11/2026-11-23-app-update-code-review.md)。退出折返后的取消遗漏阻塞稳定发布。Windows 实机或 VM 的安装交接验收仍待执行。
