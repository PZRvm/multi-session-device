---
description: 复查确认创建临时行落盘、残留事务后改名误冻结、旧设备摄像头漏计和相机编号重排误拦截四项缺口
status: resolved
created: 2026-10-09
---

# 配置安全修复后的补充复查

复查 [1–14 项修复计划](../../../plans/2026-10-09-emulator-config-safety-fixes.md) 的配置保存、创建、恢复和摄像头资源边界。确认 4 项仍可复现：3 项 P2、1 项 P3。其中创建临时行落盘是 [既有记录](2026-10-08-device-commit-baseline-findings.md) 的确认，其余为补充发现。本轮只记录问题。

检查期间另有 [配置偏差采用与同步](../../../plans/2026-10-09-config-mismatch-reconcile.md) 在开发。以下 4 项于 2026-10-09 02:17（UTC+8）按当时最新代码再次复现；该功能的完成状态不由本报告判定。本次未启动或修改用户的模拟器、配置和数据盘。

## P2：创建失败可能留下不存在的设备记录（已修复）

**触发**：A 正在创建，等待 avdmanager；此时保存 B 的网络配置；随后 A 创建失败。

**实测**：内存列表撤回 A，但模拟的 devices.json 仍同时包含 A、B。若再次提交前重启，会载入没有对应 AVD 的 A，形成无效设备记录。

**原因**：`src/main/devices/index.ts` 的 `commitMetas`（约 692 行）和 `commitMetasWithConfig`（约 1851 行）均从 `devices.map(toMeta)` 构造持久化内容，把其他创建事务的临时行一并写入。创建失败只撤回内存行和 AVD，没有撤回其他提交已写入的记录。

**建议**：区分已提交元数据与创建中的临时行；每个事务只发布自己的已完成变更，内存仍可显示创建进度。补创建失败 × 其他设备保存/改名/创建完成的交错回归。

## P2：事务清理失败后正常改名，重启误冻结配置编辑（已修复）

**触发**：RAM 保存成功，但删除已提交事务记录失败；随后仅修改设备名称并保存；重启恢复。

**实测**：两次保存均成功；仅改名没有重试清理旧记录。调用真实恢复函数后，目标被报“设备元数据与事务记录不一致（外部修改）”，冻结配置编辑。复现过程没有外部修改。此结果不代表模拟器启动也被冻结。

**原因**：`pendingJournalCleanup` 只在 `commitMetasWithConfig` 内处理（约 1829 行）；仅改名走 `commitMetas`，使当前元数据与残留 journal 的 old/new 都不一致。恢复模块保护第三种内容的判断本身正确，应用自己的后续提交破坏了前提。

**建议**：所有可能改动目标元数据的提交共用残留事务处理；清理持续失败时，在进一步改动前中止并给出重试说明。覆盖仅改名、独立 rename、启动后状态标记等写入路径，保留对外部第三种内容的保护。

## P2：旧设备的真实摄像头绑定没有计入占用（已按设计决定修复）

**触发**：B 为旧设备，`advancedSettings=null`，实际 config.ini 已配置 `hw.camera.front=webcam0`；给 A 选择同一个 webcam0。

**实测**：A 保存成功，未触发“已被其他设备占用”。确认的是重复绑定未被拦截；未实测两台安卓同时预览时的硬件表现。

**原因**：`reserveDeviceCameras`（约 1715 行）遇到其他设备 `advancedSettings=null` 就跳过，只统计应用元数据，没有读取其实际配置。创建与编辑共用预留解决了并发竞争，仍漏掉这一类既有绑定。

**建议**：按下文设计决定改为启动时仲裁：数据源读所有运行中设备的实际 config.ini 相机绑定，不再依赖应用元数据，旧设备天然纳入；读不到或无法确定的绑定不能视为空闲。不为统计占用向旧设备写默认值、不阻断无关编辑的要求不变。

## P3：摄像头编号重排后，不同摄像头被误判占用（已按设计决定修复）

**触发**：B 记录旧相机为 webcam0；拔掉旧相机后，新 USB 相机枚举为 webcam0。两条记录的宿主相机标识不同，给 A 选择新相机。

**实测**：保存被“摄像头 webcam0 已被其他设备占用”拦截。已有设备的失效绑定会阻碍选择当前可用的新相机。

**原因**：`reserveDeviceCameras`（约 1728 行）把“宿主标识相同”与“webcam 编号相同”并列为占用条件；即使两边都有不同的宿主标识，编号相同仍命中。

**建议**：按下文设计决定：启动时现场枚举 webcamN 与宿主身份的对应后再比较，旧绑定失效按“摄像头不存在”处理并回退虚拟场景，不用旧编号拦截当前可用摄像头。仍需补拔插、编号重排、旧绑定失效的回归。

## 验证与边界

- 4 个隔离诊断用例均未满足预期断言，分别复现上述 4 项。创建、存储、AVD 与摄像头使用受控 mock；第二项使用临时目录中的 journal 调用真实恢复函数。
- 临时诊断文件已移出仓库，保留于 `/var/folders/r8/m81f7g6102x8s3fg8fjrpbv00000gn/T/msd-config-safety-review-ohaw8rf0/`；含诊断代码、运行说明、源文件 SHA-256 和常规检查日志。临时目录可能被系统清理，复现步骤以本文为准。
- 移除诊断文件后，02:17:56 的全量测试：47 文件通过、3 文件跳过；670 项通过、6 项跳过。typecheck 通过；lint 退出码 0、0 error、1 warning，warning 来自并行开发的临时 `.tmp-config-reconcile-vite.mjs`。本轮未改生产代码或既有测试。
- 原临时行 issue 中 `startedAt` 丢失已修复，`rebuildDevices` 保留该字段且现有回归通过，不计入本次未修列表。
- 原清单 15–19 仍是延期验收：Quick Boot 稳定性、其他设备形态、安卓相机预览与签名权限、解压时取消、能力查询耗时。未验收不等于已确认故障。`-skin` 弃用继续按 [升级监测记录](2026-10-08-deprecated-skin-display-args.md) 跟踪。

建议先处理前两项持久化与恢复问题，再补摄像头占用边界。

## 2026-10-09 02:38 复核

按用户本次 code review 请求审查当前未提交改动，包括 1–14 项修复、配置偏差采用与同步、提示分割线。八项检查单均已检查；新增交互暂未发现新的功能缺陷，上述 4 项仍未修复。

- 02:37 使用原隔离诊断重新运行，4 个断言均再次失败，分别确认临时行残留、改名后误冻结、legacy 摄像头漏计、编号重排误拦截。诊断文件随后移除，没有修改生产代码、既有测试或用户 AVD。
- 对应代码位置：`src/main/devices/index.ts:1851`（临时行进入持久化草稿）、`:1902`（仅改名绕过残留事务清理）、`:1715`（legacy 占用跳过）、`:1728`（宿主标识与临时编号并列比较）。
- 移除诊断后，02:38 全量测试 671 项通过、6 项跳过，47 文件通过、3 文件跳过；typecheck、lint 退出码均为 0。现有测试全绿不代表这 4 个尚未纳入回归的边界已解决。
- 本轮仅补充复核记录，报告继续保持 open。未重做真实 SDK 启动验收，保留前次实测和延期验收的边界。

## 2026-10-09 摄像头设计决定（改启动时仲裁，已实施）

经讨论确认第 3、4 项按新方向处理：摄像头不再保存时独占，改为启动时仲裁加虚拟场景回退。

- 绑定放宽：允许多设备绑定同一宿主摄像头；保存时“摄像头已被其他设备占用”从阻断错误降级为非阻断提示，说明同时运行时后启动的一方会回退模拟画面。
- 启动仲裁：只对本应用管理的运行中设备做先到先得判定；冲突方本次启动以 `-camera-front/-camera-back emulated` 覆盖（命令行参数优先于 config.ini，文件保持用户原绑定不动），UI 透出本次为运行时覆盖及原因。
- 对第 3 项：仲裁数据源改为所有运行中设备的实际 config.ini 相机绑定（`hw.camera.front/back`），不再依赖应用元数据，旧设备天然纳入；读不到或无法确定的绑定不能视为空闲。
- 对第 4 项：启动时现场枚举 webcamN 与宿主身份的对应后再比较；旧绑定失效按“摄像头不存在”处理并回退虚拟场景，不用旧编号拦截当前可用摄像头。

实施前置与边界：

- 两台安卓同时预览的真实硬件表现未实测（原清单 15–19 延期验收中的“安卓相机预览”），实施前真机验证一次；emulator 通常不因摄像头打不开而启动失败，冲突到 guest 内 App 打开相机才暴露，宿主侧能做的是绑定仲裁而非硬件探测。
- 外部进程（会议、直播软件等）占用不可探测，macOS 摄像头本身允许多进程共享；仲裁范围仅限本应用管理的模拟器，UI 不承诺检测一切占用。
- 会话级启动参数覆盖是有意制造的配置偏差，须与 configDrift 与配置偏差采用同步机制协调标记，避免被当成待修复偏差。
- 实施另起 plan（含保存提示降级、启动仲裁、覆盖标记与回归：legacy 绑定、拔插、编号重排、旧绑定失效）；第 1、2 项持久化与恢复问题仍建议先行。

## 2026-10-09 修复收尾

四项已按[修复计划](../../../plans/2026-10-09-config-safety-followup-fixes.md)实施并回归，报告关闭。要点：提交器草稿基线改已接纳元数据（临时行只在内存）；`commitMetas` 对命中待清理 journal 的内容变更先重试清理、失败中止；摄像头独占预留移除，改启动先到先得仲裁 + `-camera-* virtualscene` 会话级覆盖（config.ini 不动）+ `cameraNotice` 行内通知；仲裁与提示均以实际 config.ini 绑定为数据源。全量 689 项通过、6 项跳过，typecheck/lint/build 通过。

边界如实保留：两台安卓同时预览的真实硬件表现仍未实测（原清单 15–19 延期验收不因单测通过关闭）；`verifyWebcamsFor` 对托管设置失效摄像头的启动阻断维持原语义；外部进程占用不可探测、仲裁仅限本应用管理的模拟器。

> 延期验收、virtualscene 第三方影响与孤儿进程等开放边界已并入 [待修问题清单](../../task/2026-10-09-待修问题清单.md)追踪。

## 2026-10-09 真机复核：virtualscene 参数兼容性（用户报启动死机）

用户把摄像头设为虚拟场景后模拟器一开就死。隔离实测（emulator 37.2.12，只读复用真实 SDK 工具与镜像，全新临时 AVD）：

- `-camera-front/-camera-back` **命令行参数不接受 virtualscene（任何大小写）**：进程 5 秒内 exit 1，错误 `Invalid value for -camera-front <mode> parameter` **只打在 stdout**（应用原来丢弃 stdout，行内只见 exit 1 无原因）。合法 argv 值：`webcam<N>/emulated/environment/videofile:imagefile:image360/none`。
- config.ini 的 `hw.camera.front=virtualScene`（camelCase，原 `settingsToConfigPatch` 写入形态）不被识别：**静默变成零摄像头**（`0 cameras are being emulated`），系统可启动。
- config.ini 小写 `virtualscene`：正常——虚拟场景摄像头（QemuCamera3）注册，10 秒级冷启动。
- argv `emulated`：合法可用（回退值实测启动正常）。

处置（当日修复，全量 691 项通过）：`settingsToConfigPatch` 摄像头值改写小写 `virtualscene`（经 `cameraConfigText` 单一映射）；`settingsToRunnerArgs` 对 virtualScene 与 emulated 同样**不传** camera 参数（由 config 承载）；仲裁回退值改 `emulated`、文案改“模拟画面”；`configDrift` 与 legacy 解析同时接纳小写与历史 camelCase；runner 补 stdout 尾部捕获（致命参数错误此前不可见）。用户设备当时已自行改回 emulated，重启应用后重新选择虚拟场景即可生效。另发现 avd-home 外有一个近两天的孤儿 qemu 占用 5554（其 AVD 目录已删），与本缺陷无关，待用户清理。

### 相机打开链路的真机验证（用户二次报“相机闪退”后）

> 更正：下文“时间戳是闪退的最可能解释”已被本日 13:40 的原配置复现否定。本次崩溃由编辑路径写入错误大小写、Android 摄像头数量为 0 导致，详见下一节。下文保留早期尝试及其局限，不能作为本次根因。

用户报：修复后模拟器可启动，但打开相机功能闪退。隔离复现尝试（同镜像、同参数）：

- 全新 AVD × {virtualscene + gpu.enabled=no / yes、emulated 对照}：`am start -a android.media.action.STILL_IMAGE_CAMERA`（注意组件名应为 `com.android.camera2/com.android.camera.CameraActivity`），AOSP 相机 App 三场景全部正常打开、预览 Surface 建立、无崩溃。
- **用户自身用户数据的只读克隆**（复制 .avd 普通文件、ini 改指向、加 `-read-only` 绕开同 AVD 多实例检测、virtualscene 双槽）：相机 App 同样正常打开、进程存活、crash 缓冲为空。
- 用户当时正在运行的实例（emulated）：相机 App 由诊断方打开两次均正常，无崩溃记录。

**结论：闪退未复现**。但克隆测试抓到真实缺陷：virtualscene 场景摄像头输出帧**时间戳为负且不单调**（`Camera3-Stream: returnBuffer ... timestamp is not increasing` 连续刷屏，emulator 37.2.12）。AOSP 相机容忍该缺陷，时间戳断言更严格的相机类 App（第三方相机/扫码/会议）可能因此崩溃或预览异常——这是用户闪退的最可能解释，属 emulator 场景摄像头实现缺陷，非本应用可控。待办：若用户再次复现，记录具体 App 与当时的摄像头模式并拉取 crash 缓冲；虚拟场景在该 emulator 版本上的可用性维持“注册与 AOSP 打开已验、第三方消费方未验”口径。

## 2026-10-09 13:40：原配置复现相机闪退，编辑映射遗漏已修复

本次用户再次反馈后，先保留 Pixel 8/API 32 原始 `config.ini`，再复制 AVD 普通文件到临时目录，以独立端口、`-read-only` 运行。原文件前后摄像头均为 `virtualScene`；这一次未在复现前改写摄像头值。

- **原配置结果**：`dumpsys media.camera` 返回 `Number of camera devices: 0`；启动 `com.android.camera2/com.android.camera.CameraActivity` 后，crash 缓冲记录 `ArrayIndexOutOfBoundsException: length=0; index=0`，调用栈经过 `AndroidCameraAgentImpl$AndroidCameraDeviceInfo.getCharacteristics`、`CameraController`、`CaptureModule`。相机进程退出，模拟器进程和 Android 系统仍存活。
- **单变量对照**：只将副本前后摄像头的值改为 `virtualscene`，注册 1 个后置场景摄像头，相机进程存活、场景预览打开、crash 缓冲为空。没有改 GPU、系统镜像或用户数据。
- **根因链路**：创建已有 `cameraConfigText`，但编辑 `buildConfigEditPatch` 的独立 `cameraConfigValue` 直接输出内部枚举 `virtualScene`；此前创建修复没有覆盖编辑。`configMismatchesOf` 又把错误大小写视为等价，所以编辑页无法通过原样保存修正旧文件。
- **修复与复验**：编辑改用共享 `cameraConfigText`，偏差检测不再接纳错误大小写；沿用不可采用值的保存同步路径。调用实际修复代码从原配置生成结果，仅摄像头两行变为小写。重新启动同一 AVD 数据副本，注册 1 个摄像头、相机 PID 1502 存活、前台预览正常、crash 缓冲为空。新增 6 项回归在旧实现失败、修复后通过；全量 697 项通过、6 项跳过，build/typecheck/lint 和源码格式检查通过，见 [计划与 DEBUG REPORT](../../../plans/2026-10-09-virtual-scene-camera-edit.md)。

早期克隆测试已将摄像头值设为合法小写，跳过了用户原配置的故障条件；“时间戳是最可能原因”的推测不能解释本次零摄像头越界崩溃。时间戳警告本身仍是独立观察，第三方 App 的实际影响未验。

用户实际 AVD 的配置和数据盘未改动。原 config.ini 的 SHA-256 仍为 `5f07f94bd710fc0b640abe4d69b43158ee6e15162e1800918f6d402684e849d8`；修复在应用重启后通过编辑页保存生效。诊断副本均已停止，既有 5554 孤儿进程未动。证据临时目录见计划，可能被系统清理。
