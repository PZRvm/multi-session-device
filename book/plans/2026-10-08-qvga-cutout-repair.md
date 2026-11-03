---
description: QVGA 的挖孔屏模拟占用顶部 136 像素，关闭该设备的错误 overlay 并验证重启保留
status: completed
created: 2026-10-08
---

# 修复 QVGA 内部排版

## Step 0：需求与范围

用户反馈 QVGA 应用列表破版。恢复可用的安卓布局；仅修复设备 `9c241f3b-3edc-4bd0-b616-ab5efb4a8fea`、用户 0 的挖孔屏模拟设置，不清应用数据，不换机型、API、分辨率、密度，不改其他设备或 AVD 文件。

## Phase 1：分析

ADB 原始截图也有顶部大块空白、搜索框遮住列表首行，因此问题发生在 Android 内部。实际显示为 240×320 / 120 dpi，尺寸和密度没有强制覆盖；`com.android.internal.display.cutout.emulation.hole` 却处于可变的 `STATE_ENABLED`。`dumpsys window displays` 显示状态栏与顶部 cutout 都高 136 像素，应用可用高度只剩 184 像素。

上次验收确认了分辨率和图标比例，漏查了安卓的 cutout/insets；本轮补查应用列表、状态栏和重启保留。

## Phase 2：设计

1. 操作前用 `emu avd name` 核对 serial 绑定，用 `am get-current-user` 核对用户；保存 overlay 状态和屏幕截图。
2. 对该设备执行 `cmd overlay disable --user 0 com.android.internal.display.cutout.emulation.hole`。这是 Android 设置修复，无需修改应用代码。需要回退时对同一包执行 `enable --user 0`。
3. 检查 overlay、状态栏、cutout、应用可用高度与原始截图；经应用正常停止/启动后复查，不清桌面数据。
4. Review 只记录其他问题，回写经验与本计划，刷新索引；没有可勾选的 stage 步骤。

## Phase 3–6：结果

- [x] 关闭指定 overlay。即时检查仍保留旧 cutout 缓存；正常停/开后 cutout 四边 inset 全为 0，状态栏从 136 像素恢复为 18 像素，桌面排版恢复。
- [x] 正常重启后 overlay 仍禁用，`sys.boot_completed=1`；实际尺寸为 240×320，密度为 120 dpi。`devices.json` 与三个 `config.ini` 的 SHA-256 均未变化，没有修改应用代码或清除应用数据。
- [x] 用户打开应用列表后回复「已经正常」。桌面工具的滑动操作报 `noWindowsAvailable`，没有把自动化未完成的应用列表验证记作通过；验证由用户完成。
- [x] Review 记录皮肤移除后的 overlay 残留风险，回写经验并刷新索引。没有可直接勾选的 stage 步骤，保持阶段清单。

机制参考：[AOSP Display cutouts](https://source.android.com/docs/core/display/display-cutouts)。另见[经验](../notes/learn/2026-10/2026-10-08-qvga-cutout-insets.md)与[残留风险](../notes/issue/2026-10/2026-10-08-skin-cutout-overlay-residue.md)。
