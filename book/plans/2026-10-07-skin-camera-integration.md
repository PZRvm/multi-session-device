---
description: 接通真实皮肤投屏、兼容新版摄像头枚举与权限反馈，并按画像精确获取固定版本官方皮肤后缓存复用
status: completed
created: 2026-10-07
---

# 皮肤显示、摄像头与官方皮肤获取

当前约定已更新：用户随后明确允许有边框时遮住画面，按 [前景遮挡计划](2026-10-07-skin-foreground-occlusion.md) 恢复圆角和摄像头挖孔。以下完整视频约定与截图保留为当时实施记录。

## Requirements brief

依据：[调研报告](../think-report/20261006223636-机型皮肤与宿主摄像头.md)。用户确认自动精确匹配、摄像头优先实施，以及保留完整视频、不以皮肤圆角/挖孔遮挡内容（2026-10-07 “好的，按照你的建议走”），作为本轮实施批准。

范围：摄像头新旧输出解析/权限状态与申请；皮肤 layout/资源读取/投屏几何；固定官方资源目录、下载校验、缓存和默认选择。

排除：镜像 package.xml、Quick Boot、SD 卡、折叠多屏、视频协议；不重建既有 AVD，不修改 Studio，不自动重置系统权限，不覆盖旧设备皮肤。

## Impact range

main emulator 的 cameras/settings/skins/source 清单、SDK IPC、devices 只读皮肤查询与摄像头重核验；shared/preload 契约；DeviceWizard/SettingsForm/DeviceCanvas/geometry；mac camera entitlement 与用途文案。

## Design

- 摄像头兼容 36/37 输出，返回友好名称、稳定宿主 id 与 webcamN；新设置绑定宿主 id，启动拒绝排序变化/丢失，旧 webcamN 兼容。能力附权限与诊断；用户按钮调用受控授权/系统设置入口，之后刷新能力但保留用户设置。并发申请合并。
- layout 按 name 找 display part，解析官方 quarter-turn，接受横屏首布局；表示背景的摆位/旋转。共享几何以视频比例选择方向，缺方向旋转基础布局，尺寸不匹配明确拒绝；位图在 canvas 下绘制，不覆盖屏幕。
- 主窗 `sdk:device-skin-presentation` 只收 deviceId，注入 devices 的已保存引用查询；main 重扫匹配资源、realpath 限定库目录、限额、只读 data URL，renderer 无路径能力。装饰不接收输入，切换忽略旧响应。
- 官方来源固定 `c500183b708aedf521b05e304e0e7f8d771d22b1`，随源码存 58 个白名单目录，按需从固定提交读取 Git blob 清单，拒绝任意 URL/未知名。按需获取前说明来源条款；按白名单逐文件获取，核验文件数/限额、每文件 Git blob、布局/图片格式后原子入库（renderer 再做完整解码）；避免解包远端 tar 条目。缓存引用稳定，同资源并发复用；本机 Studio 文件若匹配固定 blob 可直接复制，否则官网下载。
- 设置能力给出精确推荐皮肤；有缓存预选，缺失显示按机型获取按钮，不手填路径。保留用户手选及通用外框，失败显示可重试原因；官方不支持的机型明确说明。进度用现有事件，创建前不能有皮肤任务。

## Build order

1. 新旧摄像头 fixture/权限诊断测试，兼容解析与权限接口、友好选择和稳定绑定。
2. 修真实 layout 的偏移/横屏/rotation 测试，再接受控资源接口、统一几何及位图渲染。
3. 官方目录生成固定版本清单，资源完整性/缓存/幂等测试，再接精确推荐与获取 UI。
4. typecheck、lint、相关及全量测试；真实资源/CLI 与 UI 冒烟，记录系统权限/取景尚未验证项。
5. Phase 5 review 只记发现；Phase 6 同步计划、issue、learn、索引。既有向导和六类验收 plan 不以本轮代替完成。

## Test plan

摄像头两种输出、中文/空/异常、拒绝权限和宿主身份变化；真实 Pixel7 `(59,58)`、Tablet 横屏、四分之一圈，几何缩放与四角命中；资源路径逃逸/坏布局/坏位图、固定 blob、下载失败/重试/缓存/并发；向导默认与手选、异步切换不覆盖、同 tick 防连击。真资源和 renderer 截图验证完整画面、真实外框；真实摄像头取景与签名责任链单独留证据，未过不能声称通过。

## Done criteria

批准范围实现、相关检查全绿，真实资源获取/解析与 UI 冒烟有证据；外部权限/取景无法完成时明确保留待验状态；review/learn/issue 已回写，book:index 与 release-check 通过。不擅自增改 stage 步骤。


## 实施结果（2026-10-07）

摄像头 36/37 解析、名称与稳定宿主绑定、权限状态/申请/系统设置/刷新已接入；授权申请合并。创建与启动都重新核验宿主身份，枚举失败不静默启动。mac 打包增加 camera entitlement 与用途文案，签名版实际取景仍待验。

皮肤 display part 偏移、横屏首布局和 quarter-turn 已修正；保存的 skinRef 经主窗受控接口读取实际位图。视频在位图之上，几何与输入单源，旋转使用对应布局或旋转基础布局。丢失/坏资源/比例不匹配显示诊断并暂用通用外框，不冒充皮肤成功。官方固定版本按文件校验 Git blob、限额、暂存原子落位、缓存复核、并发复用；Studio 同版文件直接复用。首次获取说明来源，后续同机型缓存默认选中。只支持白名单和画像 id 精确同名，折叠多屏不在范围。

review 的手选覆盖问题另开 [独立修复任务](2026-10-07-wizard-skin-choice-preservation.md)：同机型换镜像后保留明确皮肤或通用外框。

### 验证证据

- 官方 Pixel 7 实取到隔离临时库，1805ms；元数据与 layout/back.webp/mask.webp 的 Git blob 均核验通过，屏幕 `(59,58,1080,2400)`。该流程可复现，不依赖临时目录。
- 真实 Tablet fixture：`(119,117,2560,1600)`，只有 landscape；真实 Nexus 5 rotation 3：`(261,65,1920,1080)`。
- 新鲜 Electron 39 主进程探针调用生产 readCameraSnapshot：`permission: not-determined`，列出 `webcam0` / `MacBook Pro相机`，宿主 id `6C707041-05AC-0010-0001-000000000001`。已证实 app 身份下枚举可用；没有点击系统授权、没有验证 Android 取景。
- 隔离 userData 的真实生产 renderer/preload/SDK IPC 冒烟：缓存预选、MacBook 名称与授权按钮可见；非向导调用 camera-access 被拒，未知 deviceId 被拒。投屏视频状态使用 fixture，canvas 绘制四角色块，没有启动用户 AVD，也没有声称真实视频链路通过。
- 截图：[竖屏](2026-10-07-skin-camera-portrait.png)、[横屏](2026-10-07-skin-camera-landscape.png)、[向导](2026-10-07-skin-camera-settings.png)。前三项界面在隔离探针中验证；截图中的测试设备列表占位字段与产品元数据无关。最后语义修订把空选项改为“通用外框”、来源标签中文化，布局未变。
- 全量测试、typecheck、lint 与 book 门禁结果见本节末尾；界面 detector 的 6 项 advisory 都来自原有 radius/color/font 值，未扩大本轮设计范围。

### 仍待人工验收

用户 dev 实例未重启，main/preload 改动重启后才全部生效。原测试 zip 是占位 PNG 素材，不能当官方外观验收；需按机型获取实际资源。既有设备不自动改写 skinRef。

Android 内真实摄像头取景、权限拒绝/放行的真实系统对话框、正式签名版权限责任链仍待验；此前“系统级阻塞”的判断不能代替修解析后的结果。镜像 package.xml P1、A2/A3/B 六类验收保持原任务状态。


最终门禁：392 测试通过、5 项既有跳过；typecheck 0 错，lint 0 错 0 警；electron-vite 三进程构建成功；book:index/release-check 131 篇、零警告、链接可解析。测试中既有 MaxListenersExceededWarning 已单独记录，未把它计为 lint 警告。代码未提交，交付位于 feature/wizard-category-settings 工作树。
