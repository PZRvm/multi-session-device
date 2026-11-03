---
description: 向导扩展验收遗留：官方皮肤获取与投屏已接通，Quick 稳定性、摄像头取景、六类设备及部分真机验证仍未完成
tags: [wizard, emulator, skins, quick-boot, acceptance]
---

# 向导分类与附加设置：批次交付遗留

> 延期验收项已并入 [待修问题清单](../../task/2026-10-09-待修问题清单.md)追踪；本文仅作证据存档。

- **问题**: plan 2026-10-05-emulator-wizard 批次 1-9 已实现并过单测/真机局部冒烟，但四项验收未完成，plan 不能翻 completed（也不应——Done criteria 明确禁止用布局完成冒充功能完成）。
- **现状**（2026-10-06，分支 feature/wizard-category-settings）:
  1. **皮肤独立下载源**：核实 AOSP platform/sdk 的 `emulator/skins` 只有 assets/dynamic（无具体机型皮肤）；机型皮肤唯一官方渠道是 emulator SDK 包内 `skins/`（用户已随包装载）；Samsung OEM 页面动态无固定包 URL。`SKIN_DOWNLOAD_SOURCES` 保持空数组（skins.ts 有核实记录注释），下载链路实现+单测就绪，源待核实后登记即开。
  2. **皮肤投屏显示**：解析器已保存 frameRect/screenRect/rotation 完整结构，但渲染与输入接入依赖通用外框计划（2026-10-05-device-frame-and-canvas）的几何基础——跨计划依赖，等该计划合并后接线。
  3. **Quick Boot 门槛**：实现路径（快照就绪生命周期、首启/失效冷启动 argv、正常停止核验）已交付且选择器禁用中；「连续 10 次 + 双机各 5 次」稳定性门槛未跑，`quickBootAvailable` 保持 false。
  4. **六类真机验收**：Wear/TV/Desktop/Automotive 的真实创建/boot/投屏/输入验证未做（desktop 无官方镜像源，能力判 unknown 已如实展示）；AVD 创建 + config patch + 回滚已真机冒烟通过（pixel_7 × android-36.1，六键生效、133 未知键保留）。
- **建议方向**: ①通用外框合并后接皮肤显示与输入（batch 7 收尾）；②跑 Quick 门槛脚本后开放选择器；③六类逐类真机验收（每类至少一个 arm64 镜像）后按结果开放/标注；④Samsung 或其他 OEM 源核实到固定包 URL 后登记下载源。

## 2026-10-08 阶段 4 收尾核对

前述四项为 2026-10-06 的发现记录。当前第 1 项的固定官方源已落地：58 个目录白名单、精确画像匹配、逐文件 Git blob 核验与缓存；OEM/别名/折叠扩展仍未覆盖。第 2 项已接实际皮肤位图和输入共用几何，按用户约定允许前景遮挡，见 [集成 plan](../../../plans/2026-10-07-skin-camera-integration.md) 与 [遮挡 plan](../../../plans/2026-10-07-skin-foreground-occlusion.md)。

第 3 项 Quick 门槛、第 4 项六类完整验收仍未完成；Android 摄像头取景与签名版、能力时延六次测量、解压瞬间取消也继续按 [验收 plan](../../../plans/2026-10-06-real-machine-verification.md) 跟踪。摄像头解析与本应用权限入口已实现，不能再将旧的枚举为空结论当作当前唯一阻碍。

基础阶段收尾只确认五个正式步骤和各自 completed plan。向导扩展 plan、验收 plan 保持 in-progress，不以代码合入 dev 或局部冒烟代替完整验收。直连包 package.xml P1 已于 2026-10-09 修复并经 API 32 / 37.2 的官方创建工具隔离验证，见[验收发现](2026-10-06-real-machine-acceptance-findings.md)。

## 2026-10-09 用户明确延期的五项

Quick Boot 稳定性、Wear/TV/Desktop/Automotive 完整验收、Android 相机取景与签名版权限、解压瞬间取消、能力加载时延测量继续待办。本轮配置安全前 14 项修复没有执行这些验收，也没有开放 Quick。
