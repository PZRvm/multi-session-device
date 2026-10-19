---
description: 按方案 A 重建两页模拟器向导：六类画像、完整镜像选择、附加设置、机型皮肤、真实摄像头与 Quick Boot；SD 卡暂缓、跨架构二期
status: in-progress
created: 2026-10-05
---

> **当前状态（2026-10-08，阶段 4 基础交付收尾）**：实现经 feature/stage04-emulator-integration 合入 dev；官方固定源皮肤获取、真实位图投屏和输入几何已由后续 completed plan 接通。Quick 稳定性、Android 摄像头取景/签名版及完整分类验收仍未完成，本 plan 保持 in-progress。当前遗留以 [验收清单](../notes/issue/2026-10/2026-10-06-wizard-plan-remaining-acceptance.md) 和 [运行快照](../docs/architecture/2026-10-08-android-runtime.md) 为准；下面各进度段与设计保留为原始记录。

> **进度（2026-10-06，feature/wizard-category-settings）**：批次 1–9 已实现——真实 fixture 与 PRD 同步、六类画像元数据（本机 96 画像分布验证）、六源精确镜像目录（276 条目实测）、store v2 与写保护、两页向导、设置契约/能力 IPC/config patch/runner argv、皮肤解析+导入+SDK 扫描、webcam 枚举与占用核验、Quick 实现路径。全部单测绿（272 过）、typecheck/lint 0 错；AVD 创建+config patch+回滚真机冒烟通过。**未完成**：皮肤独立下载源（核实无果，源清单为空）、皮肤投屏显示（挂通用外框几何依赖）、Quick 稳定性门槛（选择器保持禁用）、六类真机验收——详见 issue 2026-10-06-wizard-plan-remaining-acceptance；plan 不翻 completed。设计 3/9 的「重开可查询状态」当日补齐：sdk:images 附带进行中任务快照（activeDownload），向导重开自动恢复进度，后台下载失败经进度通道广播错误与重试入口。
>
> **修复轮（2026-10-06 晚）**：集成分支并入（外框/主题随迁，profileMetadata 按向导版融合）+ 总体 review 全量修复——P1 能力构建单一入口、P2×4、P3×12+2 全闭环（五提交 b602f09..e66f9d6，详见 [review-findings 全量修复轮段](../notes/issue/2026-10/2026-10-06-wizard-category-settings-review-findings.md)）；377 测试过、typecheck/lint 0 错 0 警。真机冒烟未跑——下个真机窗口验证：选皮肤/真实摄像头后创建可过（P1）、能力加载不再秒级卡顿（P2-3）、解压瞬间取消（download-cancel 尾巴）。

# 模拟器向导分类与附加设置 — plan

依据：[已确认的调研报告](../think-report/20261005221831-模拟器向导分类与附加设置.md)。三个单元均采用方案 A：官方画像 XML 与 Studio 分类规则、官方镜像目录与本地安装信息、avdmanager 创建后白名单配置加 runner 参数适配。界面用现有 React + styled-components 实现。

用户已确认功能范围，本轮要求创建计划。此文件是后续开发的输入，当前未实施。关联 [stage04](../notes/summary/2026-10/2026-10-09-模拟器对接.md) 的新建/启停/投屏能力；新向导属于其后续扩展，不把已完成步骤重新勾选，也不自行添加正式阶段步骤。

## Requirements brief

### 背景与目标

当前画像只有名称，手机和平板混列，Wear OS 等带标签画像被过滤；镜像只支持整数 API、三种变体和最近五个正式版本。向导仍是「画像 → 镜像 → 命名」三步，创建和 runner 没有附加设置链路。

改为「选择画像 → 配置设备」两页：先按形态搜索和选设备，再选择精确系统镜像、命名和修改附加设置。用户能看见能力限制、下载状态和兼容原因；提交的每个设置都必须在实际 AVD 中生效。

### 本期范围

- 画像：手机、平板、Wear OS、桌面、电视、车载；名称搜索、弃用画像开关、单选表格、屏幕与 API/Play 信息。
- 系统镜像：名称、API/服务筛选、推荐与完整列表、SDK 扩展/Preview/不支持项展示、准确包身份、安装检测、下载与设备摘要。
- 附加设置：皮肤、前后摄像头、网络速度/延迟、初始朝向、Cold/Quick Boot、内部存储、CPU/GPU/RAM/VM heap、Optimal/arm64 ABI。
- 具体机型皮肤：本地导入、受控下载、AVD 配置和应用内投屏显示。
- 真实摄像头：枚举、权限与不可用反馈、配置及模拟器实际取景。
- 新设备的设置持久化与重启后恢复；旧设备仍可读取、显示、启停和删除。

仅支持新建设备配置。SD 卡全部功能暂缓，包括 Custom/Existing image/None、文件选择、创建与挂载；不自动排入二期。跨架构放二期，本期以 macOS Apple Silicon 与 arm64 验收。排除已有设备配置编辑、内部存储扩容、AVD 修复/导入、XR、硬件画像新建/导入、折叠姿态控制，以及无关 SDK/日志/设置窗改造。

### 已有计划与边界

- [清单加载反馈](2026-10-05-wizard-catalog-loading.md) 已 completed：复用独立资源状态、请求代次、关闭保护及下载/创建同步守卫，重做布局时保留这些回归。
- [动作图标对齐](2026-10-05-device-action-icon-alignment.md) 独立交付，不重复施工。
- [工作台与通用外框](2026-10-05-device-frame-and-canvas.md) 当前 draft：其主题工作台、通用手机/平板外框和统一屏幕矩形是本计划机型皮肤的基础。画像元数据共用 `profileMetadata.ts`，不得维护两份分类规则。可先完成基础外框，具体机型显示随本计划交付。
- [AVD 对账草案](2026-10-05-avd-reconciliation.md) 仍为 draft/suggested：协调元数据读取契约，不借本计划扩展为全量对账、清理孤立目录或修复用户 AVD。

所有已确认的非 SD 功能都在本期内分批开发。未通过真实运行验证的类别/选项必须显示不可用原因，不能以只做布局代替功能完成。

## Impact range

数据流：应用 SDK 画像资源 + avdmanager 列表 → 结构化画像；官方 manifest + 本地 package.xml/source.properties → 精确镜像目录；main 生成兼容性与设置能力 → preload → 两页向导 → main 再校验 → 官方创建/配置与资源准备 → 元数据提交 → runner → scrcpy 画面/输入。

| 文件或模块                                                                                                                        | 改动                                                                    |
| --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `src/shared/types.ts`、`src/shared/ipc-channels.ts`                                                                               | 画像、镜像、兼容性、设置/能力、皮肤/摄像头契约及受控通道                |
| `src/main/emulator/profiles.ts`、新增 `profileMetadata.ts`                                                                        | 保留分类标签，读取官方元数据，按 id/厂商关联                            |
| `src/main/emulator/catalog.ts`、新增 `compatibility.ts`                                                                           | 完整包目录、本地核验、版本/筛选语义与兼容判定                           |
| 新增 `src/main/emulator/settings.ts`                                                                                              | 默认值、字段能力、归一化、config/argv 白名单映射                        |
| 新增 `src/main/emulator/skins.ts`、`cameras.ts`                                                                                   | 皮肤目录/导入/下载/布局解析；摄像头能力与枚举                           |
| `src/main/emulator/index.ts`、`avd.ts`、`runner.ts`                                                                               | SDK 能力 IPC、下载守卫、创建后 patch、实际启动参数                      |
| `src/main/devices/index.ts`、`src/main/store.ts`                                                                                  | 创建事务、精确身份/设置落盘、旧版本兼容与回滚错误                       |
| `src/main/window/wizard.ts`                                                                                                       | 可缩放独立非模态窗口（2026-10-06 修订）、原生皮肤选择、向导 sender 守卫 |
| `src/preload/api/sdk.ts`、`src/preload/api/wizard.ts`、`src/preload/index.d.ts`                                                   | 严格类型 API、进度订阅、资源句柄                                        |
| `src/renderer/src/components/DeviceWizard.tsx`                                                                                    | 两页流程与完整创建状态，按职责拆出向导子组件                            |
| 新增 `src/renderer/src/components/wizard/`                                                                                        | 画像表格、镜像选择、设置表单、固定摘要                                  |
| `src/renderer/src/components/DeviceCanvas.tsx`、`src/renderer/src/screen/geometry.ts`、`src/renderer/src/hooks/useDeviceInput.ts` | 机型外观与同一 screenRect 的渲染/输入                                   |
| `src/shared/types.ts`、`src/main/scrcpy/` 的输入映射                                                                              | 按新类别实际需要补 D-pad/确认键等；不把手机触控当作全部类别的验证       |
| 相应模块的 `__tests__/`                                                                                                           | 解析、守卫、配置生效、事务、布局/输入和回归                             |
| `book/docs/PRD.md` 及受影响契约/快照                                                                                              | 实施时同步两页流程、非 SD 设置、本期 Quick Boot 与二期边界              |

新增模块以这份职责划分为准，不重构无关代码。`wizard/` 若只作为源码组件目录，不新增 book 分类。

主要风险：目录格式与版本变动、缺字段误判支持、镜像半安装、旧元数据被过滤丢失、设置被固定 argv 覆盖、配置串台、皮肤屏幕位置与输入不同步、摄像头授权归属、快照恢复崩溃，以及新类别可创建但不可操控。

## Design

### 1. 官方画像与缓存

main 从选定 SDK 的 cmdline-tools JAR 等受控资源读取画像 XML，使用能处理 namespace/属性的结构化 XML 解析，复用 SDK 现有解包能力；不依赖安装 Android Studio，不硬编码本机路径或设备名单。与 avdmanager 当前可创建画像按 id/厂商关联。

`DeviceProfile` 保留 id/name，增加 manufacturer、原始 tag、formFactor、screen（宽高、对角线、逻辑 dpi、round）、foldable、软件 API 范围、Play 支持、deprecated 和默认硬件/摄像头能力。缺失字段用 unknown/null 表达，不伪造数值。

分类规则：特殊标签决定 Wear/TV/Desktop/Automotive；无特殊标签、默认屏幕 ≥7 英寸且非折叠才是 Tablet，其余 Phone。车载 Play 标签规范化；折叠手机归 Phone，未知标签保留未知，不塞进手机类。逻辑 dpi 按官方 density 定义读取，不以 xdpi/ydpi 替代。

缓存键包含 SDK 根、cmdline-tools/资源版本；切 SDK、升级或重新加载时失效。未关联画像可以展示已知信息，但兼容性不足时不能创建。

### 2. 精确系统镜像身份与兼容性

`ImageEntry.packageName` 是唯一选择/下载/创建键。新增 displayName、结构化 API（major/minor、codename/preview、原始标记）、extension/baseExtension、原始 tags、services、ABI、channel、revision、下载大小、安装状态和来源。

API 小版本逐段比较，不能转成浮点数；平台目录段、API 显示值和 SDK extension 分别存储。服务类型用于筛选与展示，不能代替完整 packageName。同 API/服务的 16KB、扩展或不同 revision 不被错误合并；同包的远端/本地信息按包身份合并并保留版本差异。

目录读取官方仓库索引发现或受控登记的形态源；main 保留支持筛选所需的完整条目，最近五个正式 API 是默认推荐视图，不再提前丢弃旧版/Preview/扩展。非 arm64 项可在不支持视图中解释原因，不进入本期创建或下载链路。

安装检测按完整包定位，核对 package.xml/source.properties、声明 ABI/revision 与所需镜像文件；空目录、残缺文件和安装中不是 installed。离线返回本地完整安装项与带时间/来源的上次可信缓存，远端失败和本地不可用分别显示。部分源失败保留其他来源并显示警告。

main 返回 `supported | unsupported | unknown` 与中文原因：画像 API 范围、Play 支持、形态/tag 匹配、镜像 ABI、emulator 版本、该类别运行/输入支持。Preview 是否可创建按实际能力判定；显示不支持项不会绕过守卫。

新 `CreateDeviceInput` 使用 profileId、imagePackageName、name、advancedSettings 和能力上下文标识。名称以用户输入为准；画像/镜像标签、API 与服务由 main 可信数据派生。创建时重新核验画像、镜像完整安装、兼容性及能力版本，拒绝陈旧选择。下载同样从可信目录核验包身份，不把旧正则简单改成任意参数；继续使用 spawn 参数数组和单下载互斥。

### 3. 两页向导

原生窗口初始约 900×680、可缩放；最小尺寸随实际屏幕工作区验证。搜索/表头/页脚固定，列表和设置表单独立滚动。采用产品中文、亮暗主题、橙色选中与现有 tokens；实施使用 impeccable 技能，保留现有原生窗口单例（2026-10-06 修订：模态改独立非模态窗口，见 [向导独立窗口 plan](2026-10-06-wizard-independent-window.md)）。

- 画像页：左侧约 180px 类别导航与「显示弃用画像」；右侧搜索与名称、Play、API、宽、高、密度列。搜索不自动创建选中项；更改类别清除不属于该类别的选择。支持键盘选行、可见焦点和空/加载/错误/重试状态。
- 配置页：左侧「设备 / 附加设置」标签，右侧约 210px 固定摘要；设备标签包含名称、API/服务筛选、镜像表格、完整/Preview/SDK 扩展/不支持项开关。摘要显示设备轮廓、尺寸、厂商、API 范围、选中镜像服务/ABI/API 和实际下载大小。
- 附加设置按皮肤、摄像头、网络、启动、内部存储、模拟性能分组；没有 SD 卡分组。控件旁说明单位、限制和禁用原因；错误定位到字段。底部提供取消、上一步、下一步/完成，当前页面不存在的动作禁用。

自动名称沿用「画像名 + API」；用户改过名称后切镜像保留输入。返回画像页/切标签保留可复用字段；改画像或镜像重新检查能力，不静默覆盖已编辑且失效的设置，显示需要重新选择的字段。

完成门槛：清单与能力就绪、选择仍存在、兼容性 supported、镜像完整安装、名称合法、设置无错误且无相关下载/创建事务。下载进度 100% 仅表示进度信号，需任务成功并刷新核验后才能创建。关闭后忽略迟到结果，重新打开按任务状态读取；不宣称关闭窗口取消了后台下载。

### 4. 设置契约与实际映射

`DeviceAdvancedSettings` 使用封闭类型，包含 skinRef、front/rearCamera、networkSpeed/networkLatency、orientation、bootMode、internalStorageMiB、cpuCores、graphics、ramMiB、vmHeapMiB、preferredAbi。摄像头为 none/emulated/virtualScene/webcam 等已验证枚举及资源 id；不开放任意 config 键、命令字符串或宿主路径输入。

`WizardCapabilities` 按 SDK/工具版本、宿主、profileId/imagePackageName 返回 defaults、枚举、数值 min/max/step、字段禁用原因、可创建状态与上下文标识。基础默认值来自画像和已明确 PRD：内部存储 6GB、RAM 跟随画像并核验镜像最低要求；其他缺失默认值从官方生成配置/当前 schema 确定。新设备默认 Cold Boot；不得把截图的 Quick/4 核/2GB/228MB 当默认。

main 在接入字段前锁定所装 emulator schema/help 的有效枚举和边界，并写成可测能力 fixture。CPU 是正整数且受工具范围/宿主逻辑核数限制；RAM/heap 统一 MiB、拒绝 NaN/溢出/负值及违反镜像或 RAM 关系的组合；存储按支持范围和可用磁盘条件检查。选择 MB/GB 按 1024 换算并注明，无法准确表示的输入明确报错，不截断或静默改值。产品资源防线保持其独立 stage 范围，本计划只做创建参数的必要校验。

| 字段             | 配置/运行路径                                          | 生效证据                                       |
| ---------------- | ------------------------------------------------------ | ---------------------------------------------- |
| Skin             | skin.name/path 等所装 schema 对应键 + 应用皮肤资源引用 | AVD 配置与应用皮肤均可用，投屏输入命中一致     |
| Camera           | hw.camera.front/back 与必要 camera 启动参数            | 模拟/虚拟场景可用；真实摄像头设备内取景        |
| Network          | 持久化后 runner `-netspeed/-netdelay`                  | 速度与延迟独立传入，设备内请求行为变化         |
| Orientation      | hw.initialOrientation                                  | 首次冷启动和投屏尺寸一致，工具条旋转可用       |
| Boot             | 经验证的 fastboot 配置与 snapshot 参数                 | Cold 不加载旧快照；Quick 保存/恢复通过门槛     |
| Internal storage | 首次启动前 disk.dataPartition.size                     | userdata 初始容量符合设置；不改已有设备        |
| CPU              | hw.cpu.ncore                                           | 配置与来宾可见核数核对                         |
| GPU              | hw.gpu.mode 与必要 `-gpu`                              | 用户 auto/host/software 选择不被固定 host 覆盖 |
| RAM / VM heap    | hw.ramSize / vm.heapSize                               | 配置与来宾内存/属性核对，区分整机 RAM 和 heap  |
| ABI              | Optimal 解析为选中包 ABI；显式仅 arm64                 | 与实际包 ABI 相同，不能声称转换为 x86_64       |

优先级：当前工具/镜像能力限制 → 经校验用户设置 → 画像/官方默认。创建时写 config 的硬件值不再被 runner 重复覆盖；运行字段从设备自己的已验证设置构造 argv。legacy 缺字段仍沿用现有 Cold/host 路径，不因新默认改变已有设备行为。

### 5. 创建事务与元数据兼容

创建顺序：校验输入/资源 → 生成新 UUID → avdmanager 官方创建 → 保留未知键的原子 config patch → 皮肤资源准备 → 元数据原子提交 → 状态转 stopped。校验/资源准备失败不提交设备；写盘成功前保持 creating，不提前广播完成。

patch/复制/元数据失败回滚仅本次新 AVD 和新资源引用；共享已安装镜像、已有皮肤与其他设备不删除。回滚失败返回主错误与残留路径，记录可重试诊断；不能继续吞掉清理错误。创建/下载同步互斥及设备运行代次继续生效。

新 store schema 保存精确镜像身份、API 显示信息、formFactor/屏幕摘要、已归一化设置和受控 skinRef。采用显式 v1/v2 读取：旧 apiLevel/variant 派生 legacy 身份，只对合法旧记录兼容读取；新类型不得强迫新服务伪装成 aosp。更新 `toMeta` 等所有投影，防止重命名/删除另一设备时丢失新增字段。

迁移只针对成功读取且校验通过的文件，首次必要写入前保留旧文件备份，不在启动时重建 AVD。未知版本或迁移失败停止写入并报告，不能当空库覆盖。[读取错误问题](../notes/issue/2026-10/2026-10-05-device-store-read-error-as-empty.md) 若仍未解决，应先落地对账计划的读取诊断/写保护契约或在独立修复任务处理，再启用新版本写入；不以本计划顺手执行全量对账。

### 6. 机型皮肤导入、下载与显示

提供 SDK 已安装皮肤、受控下载目录、本地导入入口。支持经验证的 Android Emulator `layout` 与关联位图资源格式；同时解析纵向/横向布局、外框尺寸和屏幕矩形。缺布局/缺素材/尺寸不匹配或暂不支持的多屏格式明确报错，不用通用外框冒充成功导入。

导入经向导所属原生文件选择器完成，main 验证 realpath、相对引用和压缩包条目；阻止越界路径/符号链接逃逸，限制资源数量/体积，复制至应用自有目录。renderer 只接收 skinId 与受控素材 URL，不获得任意文件读取能力。

下载前核实至少一种实际可用的官方或明确许可来源，记录来源、版本、许可、资源完整性依据；只能选 main 受控目录中的 skinId，不接收任意 URL。复用许可确认和下载状态设计，经临时目录下载/校验后原子入库，失败可重试；有校验值的来源必须校验，无校验值时需固定版本和资源核验。源码许可证不代表皮肤素材可直接打包，用户截图不作为产品素材。

SDK skin 配置和应用投屏外观分别接入。皮肤布局先按有效方向计算统一 `frameRect/screenRect`，视频完整适配到屏幕，输入使用同一 screenRect；装饰不接收触摸，也不遮挡/裁掉视频像素。切设备、旋转、缩放与视频格式变化重新计算，取消旧手势；没有机型皮肤的旧设备使用通用外框。

通用外框继续由前述独立计划交付。本计划必须完成至少一个合法机型皮肤的导入、下载和应用内显示验收；不能把「暂无可下载」视为下载功能完成。

### 7. 真实摄像头与权限

main 使用所装 emulator 的真实枚举/能力入口读取宿主摄像头，不假定固定 webcam0 永远存在。支持前/后分配，重复占用、拔出/不可用、枚举失败与权限拒绝都给出字段级原因；切换画像重新核验。

明确摄像头由实际取流进程请求 macOS 权限。若需要 Electron 预览/授权，单独核验其权限及打包用途说明；不能以 Electron 获授权推断 emulator/QEMU 已获授权。列出设备不直接启用取景，用户选择后进入实际生效链路。

新设备启动时重新检查摄像头 id 仍存在。配置真实摄像头失败不能静默改成模拟图像；向导内说明恢复授权/重新选择的方法。真 AVD 打开相机验证前后选择和真实画面；同时覆盖相机已经被其他实例占用的反馈。

### 8. Quick Boot 稳定性门槛

Quick Boot 本期开发，解决固定 `-no-snapshot` 覆盖，适配正常停止的快照保存与后续恢复。首启无快照是明确的冷启动路径；配置、镜像或工具变化造成快照失效时，提示并执行已验证的冷启动恢复，不静默丢失用户数据。

保留已有进程组停止/超时回收/取消代次。强制终止后的快照不作为可用快照；正常停止需验证保存完成，有界等待不得遗留 qemu。失败恢复不能自动循环启动，必须进入可解释错误或一次有边界的冷启动恢复。

开放门槛：官方创建的测试 AVD 连续完成 10 次正常停止/Quick 恢复，两台同时运行各完成 5 次恢复；覆盖首启、取消启动、异常杀进程、应用退出再打开、失效快照和工具/配置变化。每次核对 boot、投屏、输入、设备归属与进程清理，已知 SIGABRT 无复现。未过门槛保持 Quick 不可选并说明原因，本计划保留未完成，不将该能力悄悄挪到二期。

### 9. IPC、权限和状态反馈

尽量复用 sdk:profiles/images/download-image 和 devices:create；新增受控 `sdk:wizard-capabilities`、`sdk:device-skins`、`wizard:choose-device-skin`、`sdk:download-device-skin`、`sdk:skin-progress`、`sdk:camera-capabilities`。参数使用 profileId/packageName/skinId，能力结果带上下文标识。

向导专用通道仅登记向导窗调用；皮肤素材读取可另给登记主窗只读能力。main 校验 sender、类型、范围、资源归属和路径，preload/shared 声明同步。镜像/皮肤进度按任务 id、资源 id 关联，只处理当前任务，重开可查询状态，不把别的下载进度显示到当前选择。

资源加载沿用已有状态机；设置能力、皮肤、摄像头分别表达 loading/ready/error，不由一个失败拖死全部界面。错误在相关区域显示并可重试；创建错误保留表单，成功依旧关闭向导、按 createdId 选中新设备并刷新主窗。权限相关错误显示修复方法，沿用现有原生提示，不增加外部通知。

## Build order

以下均属本期开发批次，每批通过自己的验证再推进。

1. **锁定契约与真实 fixture。** 同步 PRD B 的两页流程、设置清单与 SD/跨架构/Quick 边界；记录本机 schema 默认/范围、官方目录样本、摄像头入口与可下载皮肤来源。协调通用外框和 store 写保护依赖。验证：六类画像、整数/小版本/扩展/16KB/Preview 镜像、有效皮肤都有真实样本，许可/资源来源明确，所有本期字段有能力与映射表。
2. **画像分类元数据。** 扩展 shared、profileMetadata/profiles 和 SDK 缓存；移除 Tag 全过滤。验证：Pixel Fold/Tablet、Wear/TV/Desktop/Automotive、未知 tag、缺字段、弃用、SDK 切换；不能创建的画像不假定支持。
3. **完整镜像目录与精确创建身份。** 升级 XML/本地探测、兼容性模型、download/create 守卫，更新共享类型与 preload。验证：API 小版本/扩展不混淆、多包不覆盖、离线/部分失败可用、半安装拒绝、伪造 packageName 无效，真实 `avdmanager -k` 使用所选完整包。
4. **元数据版本与事务。** 接入旧记录读取、新身份/设置字段、toMeta、备份及失败写保护；扩展创建后 patch/资源准备和回滚。验证：旧库重启/重命名/删除正常；新库重启不丢字段；注入 patch/复制/写盘/清理失败，不出现假成功或串改其他设备。
5. **两页窗口与选择界面。** 调整原生窗，实现类别表格、设备配置标签、镜像筛选和固定摘要，复用 loading/下载/创建守卫。验证：真实窗口 900×680 和最小尺寸可用、键盘可达、两页返回/切标签保留输入、迟到响应不覆盖、下载核验前不可完成。
6. **基础与运行设置。** 完成能力接口、字段校验、config patch 和 runner 参数；先朝向/存储/CPU/RAM/heap，再 GPU/网络/模拟摄像头/ABI。验证：每字段有单元与真实 AVD 生效证据，两设备不同配置不串台，legacy 默认路径保持；软件 GPU 性能如实记录。
7. **机型皮肤。** 接入安装目录、原生导入、受控下载、资源解析、AVD 配置和投屏外观；与通用外框共用几何。验证：一个合法皮肤完成导入/下载/显示全链路，横竖屏/缩放/触控一致；缺素材、路径逃逸、下载失败、尺寸不匹配均有明确反馈。
8. **真实摄像头。** 完成枚举、权限归属与错误、持久化和启动重核验。验证：Mac 摄像头在 Android 相机内真实取景；权限拒绝/无设备/移除/占用可解释，前后配置不会互换。
9. **Quick Boot。** 实现保存/恢复、失效和异常冷启动路径，通过设计中的连续/双机稳定性门槛再开放。验证：旧 SIGABRT 问题有实测结论，状态/输入/进程清理回归通过。
10. **类别与整体验收。** 每类至少选一个合适 arm64 镜像，真实创建/下载（若未安装）、启停、投屏和必要输入。补最小 D-pad/确认键等必要映射；无法实测通过的类别保留不可用原因与证据，记录剩余能力，不冒充已支持。完成检查、Phase 5 review 记录和 Phase 6 book 同步。

## Test plan

### 自动化

- 画像/镜像 fixture：官方 namespace 变化、未知或缺字段、API major/minor/preview/extension、服务/tag 差异、同 API 多包、foldable/round、revision/完整安装、离线和缓存失效。
- 兼容与 main 守卫：错误 sender、伪造画像/包/皮肤 id、过期能力、非法数值/单位/ABI、资源路径越界；不支持镜像展示开关无法改变创建资格。
- 创建/runner/store：config 未知键保留、argv 不重复覆盖、每字段传递到最终配置、旧/新 store 读写、toMeta 不丢字段、原子失败/回滚失败、两设备设置隔离、取消与迟到回调。
- 向导 React：六类/搜索/弃用、空/加载/错误/重试、完整/扩展/Preview/不支持筛选、默认/手改名称、返回与切标签、设置失效、下载/创建防连击、任务进度归属、卸载保护。
- 皮肤几何/输入：横竖布局、缩放/窗口变化、设备切换、外框 down 拒绝、边缘命中、capture 出界释放、圆屏与非标准比例；视频不得被装饰裁切。
- Quick：按模式构造 argv、快照有效性、强制停止/恢复失败与有界 fallback；不靠 mock 宣称快照稳定。

用现有 Vitest 与各模块 `__tests__/`，先补能暴露错误的测试，再接实现。不同批次跑相关测试；最终 `npm test`、`npm run typecheck`、`npm run build` 和改动文件 prettier 检查。`npm run lint` 与现存问题基线比较，禁止新增错误；基线问题只记录，不顺手修。

### 真实 Electron / AVD 验收

| 场景       | 必留证据                                                                                              |
| ---------- | ----------------------------------------------------------------------------------------------------- |
| 两页布局   | 亮/暗、初始/最小窗口、表格滚动、长名称与字段错误定位截图；加载/下载动画可见                           |
| 六类画像   | 各类画像、精确镜像包、创建/boot/投屏结果；Wear 圆屏、TV D-pad/确认、桌面/车载所需输入的结果或禁用原因 |
| 镜像       | 至少一个未装兼容包真实下载/核验/创建；整数和可用小版本/扩展包不混淆，特殊项支持结果如实记录           |
| 设置       | config 与启动 argv，加设备内朝向/容量/核数/内存/网络行为；改变 GPU 后的实际结果                       |
| 皮肤       | 导入与下载来源/许可、实际布局与 screenRect、纵横屏显示和真实点击位置                                  |
| 摄像头     | 实际取景及授权/拒绝路径、不可用或占用反馈；mock 不替代宿主测试                                        |
| Quick Boot | 连续 10 次与双机各 5 次记录、应用重启、失效/异常恢复、投屏输入和进程清理                              |
| 旧设备     | 读取、重命名、启停/投屏、删除；旧设备的 AVD 配置和默认启动行为未被新建设置改写                        |

测试新建独立 AVD，不清理用户 SDK/镜像/皮肤来制造失败，不以已有用户设备测试存储覆写。需要特殊权限的人工路径注明已测/未测；未测能力保持验收待完成。

## Done criteria

- 两页向导和六类导航符合已确认布局，全部 loading/空/错误/重试路径可用，原防连击/关闭保护通过回归。
- 精确 packageName 贯穿选择、下载、安装核验、创建与落盘；API 小版本、扩展、服务和 ABI 不丢失，兼容性守卫不可绕过。
- 所有本期附加设置完成 UI → main → config/argv → 真 AVD 生效；机型皮肤导入/下载/显示、真实摄像头、Quick Boot 均有上述验收证据。门槛未过则记录未完成，不因基础布局完成将 plan 翻 completed。
- 六类逐项验证并开放通过项；不支持类别按用户确认规则可见且带原因。若真实环境没有可用包或输入能力未解决，记录具体限制与后续工作，不能静默删掉类别。
- legacy 数据和行为兼容、两设备互不串台、失败回滚和资源归属通过；不扩展 SD 卡、跨架构或已有设备配置编辑。
- 相关测试、类型、构建和格式检查通过，lint 无新增问题；review 发现进入 issue，不顺手修。实施收尾同步 PRD/契约、记录 learn 与遗留、按 stage 权限附实际结果，最后将本 plan 设为 completed 并运行 `npm run book:index` 与 `npm run book:release-check`。
