---
description: book 总索引——每篇文档的地图。book 有改动后跑 npm run book:index 重新生成
---

# book — multi-session-device 总索引

> 脚本生成——勿手改。book 有任何改动后跑：`npm run book:index`。
> 每篇新文档必须带 frontmatter `description`（一行说内容不说体裁的摘要）；缺一个构建就以退出码 1 失败。

## 怎么用这本 book

- **AI agent**：先读本文件拿全书地图，再顺着链接去要去的目录。动笔写 book 文档前，先读 `guidelines/writing-style.md`。
- **人**：按下面的目录表浏览。规则在 `guidelines/`，进度在 `stage/`，施工图在 `plans/`，经验在 `notes/learn/`，决策在 `docs/decisions/`。
- **按时间**：`notes/{learn,issue}/` 按 `YYYY-MM/` 归档——月份只是物理分组，别按功能嵌套更深。变更记录不设 changelog，看 git log。
- **按功能**：在本索引里搜功能名、关键词或 frontmatter 摘要；`notes/learn/` 的条目还能按 `tags` 搜。
- **Obsidian**：把 `book/` 直接当 vault 打开。链接都是普通相对 Markdown；挪了文件就重跑索引。

## 目录地图

| 目录 | 用途 |
|------|------|
| `docs/` | 参考快照：系统现在长什么样、当时为什么这么定 |
| `docs/api/` | 接口契约：对外/模块间接口长什么样 |
| `docs/architecture/` | 架构快照：模块划分与数据流的当前状态 |
| `docs/decisions/` | ADR 决策记录：一条记一个选择及其理由 |
| `docs/poc/` | PoC 实测报告：闸门验收的原始数据、方法与结论 |
| `guidelines/` | 规则书：人和 agent 永远怎么工作，长期稳定 |
| `notes/` | 过程笔记：开发中发生了什么，只增不改 |
| `notes/issue/2026-10/` | 归档于 notes/issue/，按月份分组 |
| `notes/learn/2026-09/` | 归档于 notes/learn/，按月份分组 |
| `notes/learn/2026-10/` | 归档于 notes/learn/，按月份分组 |
| `plans/` | 施工图：一个功能一篇，Phase 2 设计确认后落盘，agent 照着施工 |
| `stage/` | 开发阶段：项目接下来走哪、每步做完没；人定阶段和步骤，勾选附一行结果（替代原 summary 机制） |
| `think-report/` | 可行性调研报告：立项前的调研结论（本仓库自定义分类） |

## 全部文件

### docs/

- [PRD.md](docs/PRD.md) — 一期 Android 需求唯一依据——应用内新建隔离模拟器、左侧列表管理、右侧投屏全量操控、测试辅助、SDK 独立引导，含验收标准、技术规格与路线图
- [README.md](docs/README.md) — docs/ 的地图——产品需求、架构快照、API 设计、架构决策记录

### docs/api/

- [README.md](docs/api/README.md) — API 设计文档——接口契约在实现之前和之中写下来的地方

### docs/architecture/

- [README.md](docs/architecture/README.md) — 架构快照——带日期的文档，描述模块和数据流在当时的真实状态
- [项目骨架.md](docs/architecture/项目骨架.md) — 多会话模拟器的项目骨架——技术栈、三进程结构、目录职责与规划模块落点（stage 01 改造后快照）

### docs/decisions/

- [ADR-001-adopt-bocode.md](docs/decisions/ADR-001-adopt-bocode.md) — 本仓库运行在 BoCode 工作流上——book 驱动 code，code 回写 book，六阶段关卡守住每个功能
- [ADR-002-adopt-bowrite.md](docs/decisions/ADR-002-adopt-bowrite.md) — 我们把 shuorenhua 加上自己的 review 模式蒸馏成 bowrite（薄写）——一个仓库内的写作 skill：写薄，写好
- [ADR-003-intent-gates-vs-distrust-gates.md](docs/decisions/ADR-003-intent-gates-vs-distrust-gates.md) — 我们按理由给工作流关卡分类——意图关卡保持硬，不信任关卡随模型改进而软化；Phase 2 的确认制改为缺口制停车
- [README.md](docs/decisions/README.md) — 这里怎么写 ADR——章节、命名、编号，以及什么决定需要一份记录

### docs/poc/

- [2026-10-04-投屏链路PoC报告.md](docs/poc/2026-10-04-投屏链路PoC报告.md) — stage04 步骤 1 PoC 实测报告——Tango + scrcpy-server 3.3.3 + WebCodecs 全链路在 host GPU 下交互 59fps / 触摸延迟中位 75ms，过验收线

### guidelines/

- [README.md](guidelines/README.md) — 六篇 guideline 的索引与按需查阅路由表——什么任务先读哪篇，无需通读
- [architecture.md](guidelines/architecture.md) — multi-session-device 的长期架构规则——边界不变量、模块地图、技术基线、数据归属
- [coding-style.md](guidelines/coding-style.md) — 编码基线——目录与组件结构、命名、样式与图标、IPC 纪律、错误处理、依赖政策
- [git-workflow.md](guidelines/git-workflow.md) — Clean Commit 提交信息格式与 Clean Flow 分支、PR、合并规则（单人及团队开发）
- [review-checklist.md](guidelines/review-checklist.md) — 每个改动必须通过的八项 code review 检查——发现只记录，绝不顺手修
- [workflow.md](guidelines/workflow.md) — 六阶段关卡工作流、八条 code↔book 交互规则与文档路由表
- [writing-style.md](guidelines/writing-style.md) — 所有 book 文档的说人话书写标准——忠实契约优先，然后是极简风格规则、强度分级与回读检查

### notes/

- [README.md](notes/README.md) — 三类笔记（learn、task、issue）、各自何时写、检索顺序，以及每类的模板

### notes/issue/2026-10/

- [2026-10-01-book-infra-scripts-missing.md](notes/issue/2026-10/2026-10-01-book-infra-scripts-missing.md) — workflow/git-workflow 引用的 book:index、check-commit-message.mjs、.githooks、git-policy.yml 在本仓库均不存在，规则与基建脱节
- [2026-10-01-dialog-unhandled-rejection.md](notes/issue/2026-10/2026-10-01-dialog-unhandled-rejection.md) — window.api 对话框调用在守卫拒绝时会 reject，调用方不接住就是 unhandled rejection——调用约定要成文
- [2026-10-01-eslint-polluted-by-skills-dirs.md](notes/issue/2026-10/2026-10-01-eslint-polluted-by-skills-dirs.md) — npm run lint 被 .zcode/.agents 的 skills 目录污染出 1.6 万条问题，src/ 干净也过不了全仓关卡
- [2026-10-01-preload-sandbox-false.md](notes/issue/2026-10/2026-10-01-preload-sandbox-false.md) — preload 沿用模板的 sandbox: false；白名单 api 已就绪，具备评估开启 sandbox 的条件
- [2026-10-02-commit-msg-hook-comment-lines.md](notes/issue/2026-10/2026-10-02-commit-msg-hook-comment-lines.md) — commit-msg hook 直接取消息首行，不跳过空行与 # 注释行——模板残留或前导空行会以莫名的结构错误拦下提交
- [2026-10-02-git-policy-yml-hardening.md](notes/issue/2026-10/2026-10-02-git-policy-yml-hardening.md) — git-policy.yml 两处待加固：GitHub 表达式直接内插进 shell 有注入面，首推 main 会被方向守卫误伤
- [2026-10-03-delete-running-device-no-stop.md](notes/issue/2026-10/2026-10-03-delete-running-device-no-stop.md) — 删除运行中设备不先停机、不做运行态拦截——mock 阶段合理，stage 04 接真实 emulator 前必须补
- [2026-10-03-device-rename-no-keyboard-path.md](notes/issue/2026-10/2026-10-03-device-rename-no-keyboard-path.md) — DeviceRow 行内重命名只有鼠标双击一条入口，键盘用户（F2/Enter 二次）无法发起重命名
- [2026-10-03-devices-ensure-loaded-concurrent-double-read.md](notes/issue/2026-10/2026-10-03-devices-ensure-loaded-concurrent-double-read.md) — devices 域 ensureLoaded 无互斥——首个命令与并发 IPC 同窗口时可能双读落盘文件，后者覆盖前者
- [2026-10-03-devices-persist-failure-divergence.md](notes/issue/2026-10/2026-10-03-devices-persist-failure-divergence.md) — devices 变更先改内存再落盘，写盘失败时内存与磁盘分叉且 renderer 无感知——零部分成功在该路径不成立
- [2026-10-03-segmented-roving-focus.md](notes/issue/2026-10/2026-10-03-segmented-roving-focus.md) — SegmentedControl 方向键切换后 DOM 焦点未随 roving tabindex 移到新选中瓣——键盘用户连按方向键无效
- [2026-10-04-avdmanager-sdk-root-null.md](notes/issue/2026-10/2026-10-04-avdmanager-sdk-root-null.md) — avdmanager create avd 报 "Valid system image paths are: null"——根因是 SDK 的 cmdline-tools 符号链接把根推断带到了 Homebrew 空壳目录（2026-10-05 已修复并更正根因）
- [2026-10-04-emulator-snapshot-resume-crash.md](notes/issue/2026-10/2026-10-04-emulator-snapshot-resume-crash.md) — 手写 config 的 AVD 在快照恢复路径原生崩溃（SIGABRT）——PoC 固定 -no-snapshot 冷启动，快照加速在 v1.1 前需先解决
- [2026-10-04-messageport-bridge-no-delivery.md](notes/issue/2026-10/2026-10-04-messageport-bridge-no-delivery.md) — MessagePortMain 经 contextBridge 回传后 port 对象可达但不投递消息——视频包通道退回 webContents.send（每帧拷贝），产品化时可再评估
- [2026-10-04-wizard-create-no-double-click-guard.md](notes/issue/2026-10/2026-10-04-wizard-create-no-double-click-guard.md) — 向导窗创建按钮无创建中禁用/防连击——双击可建出两台同名设备，stage 04 真实创建变慢后会被放大
- [2026-10-04-wizard-window-singleton-race.md](notes/issue/2026-10/2026-10-04-wizard-window-singleton-race.md) — openWizardWindow 单例判断无互斥——极窄窗口内两次 wizard:open 可开两扇模态窗且第一扇引用被覆盖
- [2026-10-05-baseline-lint-errors-stage04-files.md](notes/issue/2026-10/2026-10-05-baseline-lint-errors-stage04-files.md) — stage04 基线上 npm run lint 有存量 10 errors / 7 warnings（react-hooks 渲染纪律 + 显式返回类型），全部位于已提交的 scrcpy 与投屏 renderer 文件
- [2026-10-05-console-token-escapes-avd-isolation.md](notes/issue/2026-10/2026-10-05-console-token-escapes-avd-isolation.md) — emulator 37.2.12 的 console token 恒读写宿主 ~/.emulator_console_auth_token，ANDROID_EMULATOR_HOME 重定向不覆盖——全新机器上首次启动会向宿主 home 写入新 token
- [2026-10-05-device-store-read-error-as-empty.md](notes/issue/2026-10/2026-10-05-device-store-read-error-as-empty.md) — readDeviceMetas 将读取错误与坏 JSON 当作空库，后续元数据写入可能覆盖原设备记录；对账草案设计了读取诊断和写保护
- [2026-10-05-forward-tunnel-control-read-silent.md](notes/issue/2026-10/2026-10-05-forward-tunnel-control-read-silent.md) — adb forward 隧道下 scrcpy 控制连接的 server→client 读方向在真机上静默——设备消息（剪贴板 ACK/同步推送）收不到，控制写方向正常
- [2026-10-05-lint-baseline-unclean.md](notes/issue/2026-10/2026-10-05-lint-baseline-unclean.md) — npm run lint 存量 17 项未清（10 errors / 7 warnings）——react-hooks/set-state-in-effect 为主，集中在 DeviceCanvas 等既有效应
- [2026-10-05-wizard-download-no-tick-guard.md](notes/issue/2026-10/2026-10-05-wizard-download-no-tick-guard.md) — DeviceWizard download() 跨 tick 无互斥守卫——下载按钮是 disabled 行内的 span，jsdom 与极端竞速可穿透，两次并发 download 互相覆盖进度状态

### notes/learn/2026-09/

- [2026-09-30-perl-inplace-silent-skip-cjk.md](notes/learn/2026-09/2026-09-30-perl-inplace-silent-skip-cjk.md) — 本机 perl -pi 原地替换对以全角标点结尾的词会静默漏替换，管道 -pe 或显式 lookaround 才可靠
- [2026-09-30-skill-namespace-zcode-codex-opencode.md](notes/learn/2026-09/2026-09-30-skill-namespace-zcode-codex-opencode.md) — 同一套 SKILL.md 要在 ZCode/Codex/OpenCode 三家统一前缀命名：ZCode 想要冒号得走插件（本项目已弃），三家实际统一用 .agents/skills 的连字符前缀副本

### notes/learn/2026-10/

- [2026-10-01-electron-color-scheme-dark-text.md](notes/learn/2026-10/2026-10-01-electron-color-scheme-dark-text.md) — Electron renderer 开 color-scheme: light dark 跟随系统进深色后，硬编码的深色文字不可见——主题落地前锁 color-scheme: light
- [2026-10-02-eslint-return-type-on-zero-dep-mjs.md](notes/learn/2026-10/2026-10-02-eslint-return-type-on-zero-dep-mjs.md) — eslint 的 TS 推荐规则会打到零依赖 .mjs 脚本上要求返回类型标注——scripts/ 每个新脚本头部带文件级 disable
- [2026-10-03-cdp-port-stale-instance.md](notes/learn/2026-10/2026-10-03-cdp-port-stale-instance.md) — electron-vite dev 的 CDP 端口被残留 Electron 实例占用时，CDP 会静默连到旧 app——「新代码不生效」先查 9222 被谁占
- [2026-10-03-cdp-smoke-no-test-framework.md](notes/learn/2026-10/2026-10-03-cdp-smoke-no-test-framework.md) — 无测试框架时验证 Electron renderer 交互——dev 带 --remote-debugging-port，Node 内建 WebSocket 直连 CDP 点按钮/读状态/截屏
- [2026-10-03-electron-enable-logging-renderer-console.md](notes/learn/2026-10/2026-10-03-electron-enable-logging-renderer-console.md) — Electron dev 终端看不到 renderer 控制台——ELECTRON_ENABLE_LOGGING=1 让 console 进 stdout，是无测试框架时验证 preload/renderer 的主要手段
- [2026-10-03-styled-components-v6-ref-typing.md](notes/learn/2026-10/2026-10-03-styled-components-v6-ref-typing.md) — styled-components v6 对 styled(自定义组件) 的 ref 转发无类型通道——手动聚焦改用 autoFocus + onFocus 事件替代 ref
- [2026-10-03-vitest-testing-library-gotchas.md](notes/learn/2026-10/2026-10-03-vitest-testing-library-gotchas.md) — vitest + testing-library 两个必踩坑——RTL 自动 cleanup 依赖全局 afterEach，受控组件测试要用 useState Harness 回灌 value
- [2026-10-03-vitest5-vi-fn-single-generic.md](notes/learn/2026-10/2026-10-03-vitest5-vi-fn-single-generic.md) — vitest 5 的 vi.fn 泛型改成单个函数类型参数——旧写法 <Args, Return> 报 TS2558 Expected 0-1 type arguments
- [2026-10-04-avd-config-handwrite.md](notes/learn/2026-10/2026-10-04-avd-config-handwrite.md) — AVD 目录结构可以手写——emulator 只读 .ini + config.ini，最小配置冷启动 9 秒，绕开 avdmanager 依赖
- [2026-10-04-electron-runtime-icon.md](notes/learn/2026-10/2026-10-04-electron-runtime-icon.md) — Electron 打包图标、macOS Dock 和原生提示框分别配置；主进程共用 NativeImage 可统一运行时图片
- [2026-10-04-electron-vite-multi-page-wizard-window.md](notes/learn/2026-10/2026-10-04-electron-vite-multi-page-wizard-window.md) — electron-vite 加第二个 HTML 入口的三件套——rollupOptions.input、嵌套目录入口的相对路径（./ 还是 ../）、modal 子窗 dev/prod 双加载分支
- [2026-10-04-emulator-process-group-kill.md](notes/learn/2026-10/2026-10-04-emulator-process-group-kill.md) — macOS 上 emulator 是启动器、真身是 qemu 子进程——停止要按进程组整组 kill，否则残留实例抢 AVD 锁让新实例静默 exit 1
- [2026-10-04-generated-icon-alpha.md](notes/learn/2026-10/2026-10-04-generated-icon-alpha.md) — 生成式图标的透明外沿会残留杂点；同系列图标导出时复用参考 alpha 通道可固定圆角和留白
- [2026-10-04-scrcpy-transport-forward-tcp.md](notes/learn/2026-10/2026-10-04-scrcpy-transport-forward-tcp.md) — scrcpy 取流传输要走 adb forward + 裸 TCP（官方客户端同款路径）——Tango 的 adb server 直连 localabstract 会卡死服务端取帧
- [2026-10-04-titlebar-hidden-blur-traffic-lights.md](notes/learn/2026-10/2026-10-04-titlebar-hidden-blur-traffic-lights.md) — macOS titleBarStyle hidden 的失焦三灯整组消失怪癖——setWindowButtonVisibility 在 blur 抢不过系统，hiddenInset 是正解
- [2026-10-05-cdp-evaluate-page-destroy-hang.md](notes/learn/2026-10/2026-10-05-cdp-evaluate-page-destroy-hang.md) — CDP 驱动 Electron 页面时窗口在 evaluate 应答前关闭——WebSocket 无响应也不报错，pending promise 永不 settle，脚本静默悬挂
- [2026-10-05-emulator-console-token-host-home.md](notes/learn/2026-10/2026-10-05-emulator-console-token-host-home.md) — console token 路径不随 ANDROID_EMULATOR_HOME 重定向——恒为 $HOME/.emulator_console_auth_token，缺失时 emulator 会写宿主 home；共享 adb 靠 smart-socket 只读探测保不重启
- [2026-10-05-offscreen-electron-pixel-acceptance.md](notes/learn/2026-10/2026-10-05-offscreen-electron-pixel-acceptance.md) — jsdom 证不了像素对齐——离屏 Electron + 页内 getBoundingClientRect 几何断言 + capturePage 序列帧，一套临时 harness 覆盖状态矩阵、动画漂移与主题可见性
- [2026-10-05-tsx-generic-arrow-comma.md](notes/learn/2026-10/2026-10-05-tsx-generic-arrow-comma.md) — tsx 里泛型箭头函数必须写 <T,>——裸 <T>( 被解析成 JSX 起始标签，连环假错报到几百行外的 styled 段
- [2026-10-05-vitest-clearallmocks-impl-bleed.md](notes/learn/2026-10/2026-10-05-vitest-clearallmocks-impl-bleed.md) — vi.clearAllMocks 只清调用记录不重置实现——上一组 describe 末用例设置的持久 mockRejectedValue 会渗进下一组，报错栈指向别的用例的 setup 行

### plans/

- [2026-10-01-book-infra-scripts.md](plans/2026-10-01-book-infra-scripts.md) — book 基建脚本施工图——引入 BoCode 的索引生成与发版检查脚本并按本仓库适配（路径、目录表、检查语义、中文文案）
- [2026-10-01-stage01-骨架与规范.md](plans/2026-10-01-stage01-骨架与规范.md) — stage 01 施工图——骨架改造的 brief、影响面与设计：依赖接入、组件规范成文、main/preload 拆目录、原生 dialog/toast 通道、文档同步
- [2026-10-02-git-infra-scripts.md](plans/2026-10-02-git-infra-scripts.md) — git 基建施工图——Clean Commit 主题校验脚本、commit-msg hook、git-policy CI 工作流、dev 分支，收口 book-infra-scripts-missing
- [2026-10-03-stage02-设计系统.md](plans/2026-10-03-stage02-设计系统.md) — stage 02 施工图——impeccable 反推 DESIGN.md、themeSystems token 单源平移、styled-components 主题接入、亮暗三态可切、元素基线五件
- [2026-10-03-stage03-会话管理壳.md](plans/2026-10-03-stage03-会话管理壳.md) — stage 03 施工图——左右分栏壳（280px 可拖 220–420）+ 设备列表全量交互（新建向导/删除确认/行内重命名/启停）+ 主进程 JSON 元数据持久化，全程 mock 不接 Android
- [2026-10-03-test-file-layout.md](plans/2026-10-03-test-file-layout.md) — 测试文件布局转 __tests__/ 子目录共置（方案 B）并把约定成文进 coding-style 与项目骨架快照
- [2026-10-03-test-infra-and-roving-focus.md](plans/2026-10-03-test-infra-and-roving-focus.md) — 两笔挂账的施工图——vitest 测试基建接入（stage 01 挂账步骤）与 SegmentedControl roving focus 修复（stage 02 P3 issue）
- [2026-10-04-application-icon-integration.md](plans/2026-10-04-application-icon-integration.md) — 手机图标接入主窗、向导窗、macOS Dock、全部原生提示框和各平台打包配置
- [2026-10-04-application-icon.md](plans/2026-10-04-application-icon.md) — 应用图标沿用 multi-session-browser 的尺寸、圆角和配色，将三层浏览器窗口替换为三层手机
- [2026-10-04-avd-create-delete.md](plans/2026-10-04-avd-create-delete.md) — stage04 步骤 3 施工图——AVD 新建/删除接真：avdmanager 画像与 manifest 镜像清单（API × 变体 × arm64）、未装镜像向导内下载、create/delete + ANDROID_AVD_HOME 隔离
- [2026-10-04-native-traffic-lights-inactive-theme.md](plans/2026-10-04-native-traffic-lights-inactive-theme.md) — 将 macOS 原生外观同步到应用亮暗选择，修复浅色页面失焦时原生三灯不可见
- [2026-10-04-native-traffic-lights.md](plans/2026-10-04-native-traffic-lights.md) — 主窗恢复 macOS 原生红绿灯，保留无标题文字的板头布局，移除自绘按钮和专用 IPC
- [2026-10-04-poc-gate-投屏链路.md](plans/2026-10-04-poc-gate-投屏链路.md) — stage04 步骤 1 施工图——PoC 闸门：本机已有 SDK 下单 AVD 无头启动 + scrcpy 取流 + 触控注入最小链路，量帧率/延迟出报告，对照 ≥30fps/≤150ms 验收线决定过停
- [2026-10-04-sdk-bootstrap.md](plans/2026-10-04-sdk-bootstrap.md) — stage04 步骤 2 施工图——SDK bootstrap：检测/下载 JRE+cmdline-tools+platform-tools+emulator 四件套到应用自有 SDK 根，许可应用内确认写哈希，路径以 IPC 参数可自定义
- [2026-10-04-self-drawn-traffic-lights.md](plans/2026-10-04-self-drawn-traffic-lights.md) — 修复轮施工图——自绘三灯根治失焦消失（原生灯永久隐藏 + renderer 常绘圆点 + minimize/fullscreen IPC）、向导弹窗填满视口
- [2026-10-04-shell-fix-三灯与外观两态.md](plans/2026-10-04-shell-fix-三灯与外观两态.md) — 壳体验修复轮施工图——计数文案改「设备」、失焦三灯消失治理（setWindowButtonVisibility）、外观入口两态化（窄=弹出菜单/宽≥390=三段分段）
- [2026-10-04-shell-polish-原生向导与板头.md](plans/2026-10-04-shell-polish-原生向导与板头.md) — stage 03 优化轮施工图——新建向导改 Electron 原生模态子窗 + 主窗对齐姊妹仓库板头形态（hidden 标题条/板头三件套/底部橙底新建钮/选中行删除钮常显）
- [2026-10-05-avd-reconciliation.md](plans/2026-10-05-avd-reconciliation.md) — stage04 对账建议步骤的需求与设计草案：元数据与 AVD 核验、失效可见、孤立目录保留及读取错误保护
- [2026-10-05-device-action-icon-alignment.md](plans/2026-10-05-device-action-icon-alignment.md) — 统一设备行加载图标与动作按钮的尺寸和中心，修复启动中、停止中图标错位
- [2026-10-05-device-frame-and-canvas.md](plans/2026-10-05-device-frame-and-canvas.md) — 用主题工作台替换投屏黑色背景，为手机和平板增加不同外框并保持完整画面与触控坐标一致
- [2026-10-05-device-store-issue-batch.md](plans/2026-10-05-device-store-issue-batch.md) — 四个设备域 issue 的收口批次——三个已在 7099076 修掉待验证回写，键盘重命名本轮实现
- [2026-10-05-device-stream-control.md](plans/2026-10-05-device-stream-control.md) — stage04 步骤 5 的需求与设计：多设备 scrcpy 会话、后台停解码与关键帧恢复、等比画布和触控键盘输入
- [2026-10-05-emulator-runner.md](plans/2026-10-05-emulator-runner.md) — stage04 步骤 4 的需求与设计：真启停、端口避让、可取消状态机、崩溃回写及退出清理
- [2026-10-05-wizard-catalog-loading.md](plans/2026-10-05-wizard-catalog-loading.md) — 为新建设备向导增加画像与镜像清单的加载动画、独立错误重试及关闭后结果保护
- [README.md](plans/README.md) — plans 目录用法——Phase 2 批准后实现计划落在这里，含命名和计划模板

### stage/

- [01-项目骨架与规范.md](stage/01-项目骨架与规范.md) — 交付可开发的骨架：目录/组件书写规范成文，styled-components + zustand + lucide-react 就位，原生对话框通道打通，骨架文档同步
- [02-设计系统.md](stage/02-设计系统.md) — 交付「发信板」设计系统：impeccable 从 multi-session-browser 反推 DESIGN.md，tokens 平移到本仓库可用
- [03-会话管理壳.md](stage/03-会话管理壳.md) — 交付纯前端会话管理壳：左右分栏 + 模拟器列表全量交互（新建/删除/重命名/状态/启停按钮），数据假、不接 Android
- [04-模拟器对接.md](stage/04-模拟器对接.md) — 交付真模拟器全链路：SDK bootstrap 全量、PoC 过验收线（≥30fps/≤150ms）、向导接真 avdmanager、启停状态机、投屏触控物理键
- [05-功能完善.md](stage/05-功能完善.md) — 交付一期收尾：日志面板、截屏/录屏/拖拽安装/剪贴板/断网、设置窗、并行与内存水位防线
- [README.md](stage/README.md) — stage 目录用法——项目开发阶段的里程碑跟踪：人定阶段，勾选带结果，agent 可勾选和建议

### think-report/

- [20260929011713-安卓与iOS多实例模拟器工具.md](think-report/20260929011713-安卓与iOS多实例模拟器工具.md) — 多模拟器桌面工具可行性结论：安卓走 AVD+scrcpy 嵌入画面，iOS 走 Simulator+idb，官方并发上限与许可证均已核实可行
- [20261005221831-模拟器向导分类与附加设置.md](think-report/20261005221831-模拟器向导分类与附加设置.md) — 已确认的向导范围：画像分类、API镜像与附加设置，含机型皮肤和真实摄像头；SD卡暂缓，跨架构二期
- [README.md](think-report/README.md) — think-report 是立项前的可行性调研报告——写一次、供拍板，开发阶段不需要回读

<!-- 96 documents -->
