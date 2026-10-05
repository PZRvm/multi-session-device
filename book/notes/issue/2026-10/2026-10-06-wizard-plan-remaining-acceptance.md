---
description: 模拟器向导 plan（2026-10-05-emulator-wizard）批次 1-9 交付后的遗留清单——皮肤独立下载源核实无果、投屏显示挂通用外框几何、Quick 门槛与六类真机验收未跑
tags: [wizard, emulator, skins, quick-boot, acceptance]
---

# 向导分类与附加设置：批次交付遗留

- **问题**: plan 2026-10-05-emulator-wizard 批次 1-9 已实现并过单测/真机局部冒烟，但四项验收未完成，plan 不能翻 completed（也不应——Done criteria 明确禁止用布局完成冒充功能完成）。
- **现状**（2026-10-06，分支 feature/wizard-category-settings）:
  1. **皮肤独立下载源**：核实 AOSP platform/sdk 的 `emulator/skins` 只有 assets/dynamic（无具体机型皮肤）；机型皮肤唯一官方渠道是 emulator SDK 包内 `skins/`（用户已随包装载）；Samsung OEM 页面动态无固定包 URL。`SKIN_DOWNLOAD_SOURCES` 保持空数组（skins.ts 有核实记录注释），下载链路实现+单测就绪，源待核实后登记即开。
  2. **皮肤投屏显示**：解析器已保存 frameRect/screenRect/rotation 完整结构，但渲染与输入接入依赖通用外框计划（2026-10-05-device-frame-and-canvas）的几何基础——跨计划依赖，等该计划合并后接线。
  3. **Quick Boot 门槛**：实现路径（快照就绪生命周期、首启/失效冷启动 argv、正常停止核验）已交付且选择器禁用中；「连续 10 次 + 双机各 5 次」稳定性门槛未跑，`quickBootAvailable` 保持 false。
  4. **六类真机验收**：Wear/TV/Desktop/Automotive 的真实创建/boot/投屏/输入验证未做（desktop 无官方镜像源，能力判 unknown 已如实展示）；AVD 创建 + config patch + 回滚已真机冒烟通过（pixel_7 × android-36.1，六键生效、133 未知键保留）。
- **建议方向**: ①通用外框合并后接皮肤显示与输入（batch 7 收尾）；②跑 Quick 门槛脚本后开放选择器；③六类逐类真机验收（每类至少一个 arm64 镜像）后按结果开放/标注；④Samsung 或其他 OEM 源核实到固定包 URL 后登记下载源。
