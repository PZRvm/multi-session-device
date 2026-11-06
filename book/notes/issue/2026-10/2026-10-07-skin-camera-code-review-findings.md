---
status: open
description: 皮肤/摄像头集成（feature/wizard-category-settings 未提交轮）的 Phase 5 code review——无阻塞项；P3 三项（主动取消被当失败警示、无背景图皮肤可入库但投屏必报错、启动核验文案叠加），另含门禁复核与安全/几何核对结论
tags: [review, skin, camera, wizard, geometry]
---

# 皮肤与摄像头集成轮 code review 发现

2026-10-07 对 feature/wizard-category-settings 工作树未提交改动（三份 plan：[皮肤摄像头集成](../../../plans/2026-10-07-skin-camera-integration.md)、[手选保留](../../../plans/2026-10-07-wizard-skin-choice-preservation.md)、[前景遮挡](../../../plans/2026-10-07-skin-foreground-occlusion.md)）的整体 review。按纪律只记录不修复。

## 门禁复核

- 实测复现声明：全量 398 通过、5 项既有跳过；typecheck 0 错；lint 0 错 0 警。
- `DeviceSkinSummary.portrait` 改可空、新增 `landscape`：grep 全仓无直接消费方（renderer 只消费 presentation，main 侧 summarize 已同步），无破坏。
- 皮肤下载互斥三层（main `skinDownloading` + renderer `skinBusyRef` + `skinSource.inFlight` 按(userData,name)合并）核实闭环；同意框期间重入被拒。

## 安全面与几何核对（无发现）

- `readSkinPresentation`：realpath 后按库根包含校验、文件名白名单、单文件 16MB/总量 64MB 限额、MIME 嗅探不信任扩展名；符号链接逃逸有测试覆盖（[skinSource.test.ts](../../../../src/main/emulator/__tests__/skinSource.test.ts)）。
- `skinSource`：固定提交 + 目录白名单 + 逐文件 Git blob 核验 + 暂存原子落位；缓存复核含 layout/imageAssets（[imageAssets 收集含 foreground.mask](../../../../src/main/emulator/skins.ts)，遮罩文件在核验范围内）。
- presentation IPC 仅主窗 sender；camera-access/settings 仅向导 sender；`savedDeviceSkinRef` 经注入隔离 devices→sdk 依赖方向。
- quarter-turn 数学独立推导一致：main 侧 part/display 旋转补齐（rotation 1: `(x,y)→(-y,x)` 族）与 renderer 侧 `computeSkinLayout` 的 rotated 重映射、`skinMaskStyle` 的 translate+rotate 覆盖矩形、`SkinShell` 背景逐 part 旋转，三者同约定；`toNormalized` 1e-7 容差与 learn「浮点角点」口径一致。

## 发现

### P3 — 主动取消被当失败警示

- [DeviceWizard importSkin/downloadSkinByName 的 catch](../../../../src/renderer/src/components/DeviceWizard.tsx) 现在把所有拒绝写入 `skinError`：取消文件选择器会显示「未选择皮肤压缩包」红色 alert；[同意框取消](../../../../src/main/emulator/index.ts) 也把「已取消获取皮肤，可继续使用通用外框」当 FieldError 呈现。旧代码注释口径是「取消保持清单、错误由对话框域呈现」（即静默）。
- 影响：用户主动取消得到失败样式的反馈，属噪声；真实失败（网络、核验）的警示被稀释。
- 方向：main 侧取消返回可识别哨兵（或 renderer 按固定取消文案过滤），仅在真实失败时置 `skinError`。

2026-10-07 已修（[修复 plan](../../../plans/2026-10-07-review-p3-fixes.md)）：两处取消改走 IPC 契约 `DeviceSkinSummary | null`，renderer 收 null 静默早退（不 absorb、不解锁字段、不置 skinError）；真实失败仍走错误通道。

### P3 — 无背景图的皮肤可入库可选，投屏必报错

- `importSkinArchive`/`scanSdkSkins` 不要求 `imageAssets` 非空（[官方下载路径要求 >0](../../../../src/main/emulator/skinSource.ts)），这类皮肤能入库、能预选、能创建设备；但 [readSkinPresentation](../../../../src/main/emulator/skinPresentation.ts) 对零图片固定抛「皮肤没有可渲染的背景图片」，DeviceCanvas 回退通用外框并显示诊断。
- 影响：「可入库/可选」与「可渲染」口径不一致；有可见诊断、不冒充成功，故仅 P3。
- 方向：扫描/导入时就拒绝零背景皮肤，或能力侧禁用该条目，避免创建后才暴露。

2026-10-07 已修：`renderableArtFiles`（两方向背景 + 前景遮罩）成为可渲染口径单一来源，presentation/导入/SDK 扫描/库扫描/官方下载核验五处共用；零素材条目导入即拒、扫描跳过，不再进入可选清单。

### P3 — 启动前摄像头核验失败的文案叠加

- [devices/index.ts 启动核验](../../../../src/main/devices/index.ts) 把底层错误再包一层：格式异常时最终为「启动前无法核验摄像头：摄像头输出格式无法识别，请检查 emulator 版本，请检查权限或改用模拟画面」——两个建议从句拼接。
- 行为本身正确（枚举失败不静默启动是本 plan 明确决定）；仅文案需分支。

2026-10-07 已修：底层错误已含建议从句（含「请」）时不再追加通用建议，裸错误（如 spawn ENOENT）保留原错误并附行动建议；devices 域补 mock cameras 的核验文案三分支回归（含缺摄像头透传，此前无覆盖）。

## 核实过不构成问题的点

- `boundedFetch` 的 `FILE_LIMIT*1.4` 对 base64 TEXT 不误伤（16MB 二进制 → 22.37MB < 23.49MB 上限），解码后仍有单文件硬限。
- `parseWebcamList` 现代格式正则对含撇号友好名（如 John's Camera）经贪婪回溯仍解析正确；重复输出按 webcamN 去重。
- 启动核验的 `includes('不可用')` 透传守卫与新分支互不吞：缺摄像头消息含「已不可用」原样透传，枚举失败消息不含该词落入新分支。
- 手选保留（`skinChoicesRef`）只记 onChange 的显式变化与导入/下载成功，defaults 直接 set 不误记；失败测试先复现覆盖。

## 边界重申

> 待验与排查项已并入 [待修问题清单](../../task/2026-10-09-待修问题清单.md)追踪，此处仅作证据存档。

本轮 review 通过不改变以下待验状态：Android 内真实摄像头取景、正式签名版权限责任链、A2/A3/B 六类真机验收、直连下载 `buildPackageXml` schema 修复（P1 原样）。Pixel 7/API 34 卡顿的 GPU 怀疑维持只读排查结论，等用户对照结果，未授权不实施修复。
