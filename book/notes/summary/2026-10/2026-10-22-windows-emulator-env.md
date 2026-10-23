---
description: Windows 模拟器环境适配落地——镜像按宿主 ABI 过滤（x86_64）、WHPX 失败识别与深链引导、摄像头隐私设置入口；win32-only 分支 mac 零回归
---

# Windows 模拟器环境适配（P5）功能报告

## 背景

Windows 适配 P5（plan 2026-10-22-windows-emulator-env，依据外围调研 §5 D1-D3）。调研时已知的问题之外，写 plan 的 agent 又核出三处调研未暴露的 arm64 硬编码 gate（`compatibility.ts:51` 兼容性判定、`sdkIpcImages.ts` 下载守卫、`SettingsForm` 按钮渲染条件）——不做这三处，ABI 过滤等于白做。

## 做了什么

- **ABI 单源与过滤链**：`shared/compatibility.ts` 新增 `hostImageAbi`（win32 → x86_64，其余 → arm64-v8a），`assessImageCompatibility`/`profileHasSupportedImage` 增可选 `hostAbi` 参数（缺省即现状）；`catalog.ts` 的 `ImageCatalogDeps` 增 `platform` 接缝，两条装配路径（localOnly 与全量）在 `mergeCatalog` 之后单点过滤；下载守卫、创建守卫（main）、逐镜像判定与共享态收窄（renderer，经 `window.api.platform` 注入）全部改走单源；`compatCrossArch` 三语文案改为双平台措辞。
- **WHPX 识别与引导**：新增 `emulator/whpx.ts` 纯匹配器（锚定官方致命句式 + 「产品名 ∧ not installed」组合，明确排除宽匹配防运行期警告误伤）；`devices/startup.ts` 的 `handleUnexpectedExit` 头部挂 win32 分支 → `lastError.code = 'whpx-missing'` + 指引文案；新增受控深链通道 `shell:open-windows-features`（固定 URI `ms-settings:windows-optionalfeatures`、仅 win32、无 renderer 入参面），`DeviceRow` 错误行随该 code 渲染「去开启 Windows 虚拟化」按钮。
- **摄像头**：`cameras.ts` 出 `cameraSettingsUrlFor`（darwin 原串逐字节不变 / win32 → `ms-settings:privacy-webcam` / 其余 null）与 `cameraListEmptyMessage`（win32 空列表恒指向 Windows 隐私设置文案）；`sdkIpcSkins` 深链改走单源；`SettingsForm` 的「打开摄像头权限设置」按钮渲染条件扩为「mac denied/restricted（原状）或 win32 空列表」。

## 为什么这么选

WHPX 分类挂 devices 层而非 runner——`UnexpectedExitInfo` 是纯进程事实、错误语义词表（lastError code）全在 devices 层，给 P3 刚定型的 runner 加环境语义会污染进程池抽象。摄像头权限探测维持「非 darwin 恒 granted」——Windows 对桌面应用只有全局相机开关、无 Electron 可查 API，假装可探测反而撒谎；空列表即事实，只补引导。ABI 缺省参数钉 arm64——所有未改调用点（含全部既有测试）行为逐字节不变，mac 零回归是构造性保证。

## 结果

1379 测试全过（新增 21：compatibility 4 / catalog 3 / whpx 3 / cameras 2 / dialog 2 / lifecycle 2 / DeviceRow 2 / SettingsForm 3）、typecheck/lint 0 错。两处实现偏差（记录于 plan）：`SettingsForm` 新建了 `wizard/__tests__/` 独立测试目录（此前无先例，纯展示组件直测最省）；`DeviceWizard.test` 补了 beforeEach 默认平台桩——组件新增 `window.api.platform` 读取后，注入式用例缺 api 桩会 TypeError，这是测试基建适配而非为过关改断言（既有断言零改动）。调试中还实证了一次 ABI 链路本身：win32 平台覆写下创建 arm64 设备被正确拦截。

## 后续

真机项（WHPX 错误输出真实样本采样回填匹配清单、深链真实拉起、x86_64 镜像全链）归统一集成验证阶段；win32 过滤后本地非 x86_64 镜像不可见（卸载入口随之隐藏）已按 plan 风险承诺记 issue。
