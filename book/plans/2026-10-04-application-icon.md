---
description: 应用图标沿用 multi-session-browser 的尺寸、圆角和配色，将三层浏览器窗口替换为三层手机
status: in_progress
created: 2026-10-04
---

# 应用图标

## 需求与影响面

用户要求参考姊妹项目图标，只把内部浏览器换成手机。保留浅米白圆角底板、透明外沿、橙黄前层和灰色后层，以及错位叠放关系。

范围：`resources/` 的图标母版和运行时 PNG、`build/icon.png`、`build/icon.icns`、`build/icon.ico`。不改窗口行为、设备流程、界面组件、打包配置或依赖；当前窗口文件已有改动，不纳入本任务。

## 设计与实现

以姊妹项目 `build/icon.png` 为编辑参考，通过内置 imagegen 将三个窗口替换为三个竖向手机轮廓。生成透明背景母版保存至 `resources/logo-multi-session-device.png`；应用 PNG 保持参考的 512×512，转换 macOS ICNS 和 Windows 多尺寸 ICO。

## 验证与完成条件

检查手机可辨识、配色和外轮廓接近参考、外沿透明；检查两个应用 PNG 一致、512×512，以及 ICNS/ICO 尺寸内容可解码。review 只覆盖本次资源；阶段无对应步骤则保留 `[suggested]`，不自行转正。完成后回写状态并刷新索引。
