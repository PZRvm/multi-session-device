---
description: 皮肤不能覆盖机型分辨率；修复 QVGA 图标过小，并移除画面顶部皮肤提示
status: completed
created: 2026-10-08
---

# 保留机型分辨率，移除顶部提示

## Step 0：需求

- 背景：用户截图里的 QVGA 桌面图标极小，画面上方还有皮肤降级提示。
- 结果：桌面按机型原本的屏幕比例显示；顶部没有皮肤提示文字。
- 范围：启动时的皮肤参数、工作台的皮肤降级显示。
- 排除：不换机型、API、密度，不修改存储、用户数据、已有配置文件或皮肤素材；不修配置编辑审查中的其他问题。

## Phase 1：分析

QVGA 的 `config.ini` 是 240×320、120 dpi；选择 Pixel 7 皮肤后，生成的 `hardware-qemu.ini` 变成 1080×2400、120 dpi。Android 在更大的屏幕里按原来的低密度绘制，图标因此极小。`-no-window` 没有阻止皮肤覆盖显示尺寸。

本机 emulator 的 `-help-skin` 支持 `-skin WIDTHxHEIGHT`。隔离 AVD 使用同一套 QVGA 配置和不匹配皮肤，加 `-skin 240x320` 后成功启动：`wm size` 为 240×320，`wm density` 为 120，`sys.boot_completed=1`。

风险：新版官方文档已将 `-skin` 列为 deprecated；本轮验证的是当前安装版本。旧配置缺少有效屏幕尺寸时不猜尺寸，保留原启动行为。顶部提示移除后，皮肤失败仍须保留日志和通用外框，不能恢复不透明遮罩。

## Phase 2：设计

1. devices 启动预检通过后，受控读取 `config.ini`。若配置了皮肤且有有效的正整数宽高，本次启动附加 `-skin WIDTHxHEIGHT`；参数按设备和 runId 缓存，只匹配本次启动，重启重新读取，删除设备时清理。
2. 原有启动设置照常生成，合并屏幕参数；CPU、RAM、GPU、网络、摄像头和快照策略不重写。
3. DeviceCanvas 保留透明度检查和通用外框回退，取消顶部 SkinNotice；加载失败只记诊断日志。画面连接错误和输入错误维持原行为。
4. 文件：`src/main/devices/index.ts` 及其测试、`src/renderer/src/components/DeviceCanvas.tsx` 及其测试。

## Phase 3–6：验收与收尾

- [x] 回归先失败：6 项断言复现问题，最小修复后通过；覆盖皮肤尺寸、legacy、无效值、重启重读、读盘失败和 Quick 参数保留。
- [x] 顶部文字移除；坏遮罩、检查失败和比例不匹配均保留可见画面；正常皮肤继续显示。
- [x] 相关 108 项测试通过；`npm run build`（含两侧类型检查）和 `npm run lint` 通过。impeccable 检查仅报告既有 10px 圆角与 canvas 黑色两项 advisory，本轮未改动。
- [x] 桌面实测：QVGA 为 240×320 / 120 dpi，图标恢复比例，顶部无皮肤提示；Pixel 8 为 1080×2400 / 420 dpi，进程带 `-skin 1080x2400`，两台均 `sys.boot_completed=1`。隔离的不匹配皮肤案例也已启动成功。用户在本轮验证前已清除了 QVGA 皮肤，因此该错配组合用隔离 AVD 验证，没有改回用户配置。
- [x] Review 八项检查完成：无新增阻断项；弃用参数的升级风险单独记录。`devices.json` 和三个 `config.ini` 与实际应用验收前的 SHA-256 全部一致。测试用临时模拟器已停止，用户的其他模拟器进程未动。
- [x] 回写经验、升级风险和 plan，刷新 book 索引。本修复没有可直接勾选的 stage 步骤，保持人制定的阶段清单。

QVGA 本身只有 240×320，铺满工作台后仍会模糊；本轮恢复了原生尺寸和图标比例，没有提高机型分辨率。

参考：[Android 官方命令行文档](https://developer.android.com/studio/run/emulator-commandline)、[前一轮黑屏修复](2026-10-08-opaque-skin-black-screen.md)、[经验](../notes/learn/2026-10/2026-10-08-skin-overrides-display-size.md)、[升级风险](../notes/issue/2026-10/2026-10-08-deprecated-skin-display-args.md)。
