---
description: 应用图标沿用 multi-session-browser 的尺寸、圆角和配色，将三层浏览器窗口替换为三层手机
status: completed
created: 2026-10-04
---

# 应用图标

## 需求与影响面

用户要求参考姊妹项目图标，只把内部浏览器换成手机。保留浅米白圆角底板、透明外沿、橙黄前层和灰色后层，以及错位叠放关系。

范围：`resources/` 的图标母版和运行时 PNG、`build/icon.png`、`build/icon.icns`、`build/icon.ico`。不改窗口行为、设备流程、界面组件、打包配置或依赖；当前窗口文件已有改动，不纳入本任务。

## 设计与实现

以姊妹项目 `build/icon.png` 为编辑参考，通过内置 imagegen 将三个窗口替换为三个竖向手机轮廓。生成透明背景母版保存至 `resources/logo-multi-session-device.png`；应用 PNG 保持参考的 512×512，转换 macOS ICNS 和 Windows 多尺寸 ICO。

导出时用参考 PNG 的 alpha 通道约束轮廓，消除生成稿外沿杂点。母版 1024×1024；ICNS 包含 10 个表示（16–1024px），ICO 包含 16/32/48/64/128/256px 六档。

## 验证与完成条件

检查手机可辨识、配色和外轮廓接近参考、外沿透明；检查两个应用 PNG 一致、512×512，以及 ICNS/ICO 尺寸内容可解码。review 只覆盖本次资源；阶段无对应步骤则保留 `[suggested]`，不自行转正。完成后回写状态并刷新索引。

结果：应用 PNG 与参考 alpha 通道逐像素比较 AE=0；运行时/打包 PNG 字节一致；ICNS 解包得到 10 个表示，ICO 六档全部可解码。资源 review 未发现需另立 issue 的问题；未改应用源码和打包配置，未运行打包安装验收。

## 定稿轮提示词（内置 imagegen）

```text
Use case: precise-object-edit. Edit the supplied smartphone application icon. Keep its three smartphone symbols, sizes, placements, colors, blank screens and earpieces unchanged. Make the outer ivory plate a perfectly smooth geometric rounded square with crisp, clean antialiased alpha edges, exactly matching the second reference browser icon's outer silhouette, relative padding and corner curvature. The second image is the silhouette/style reference only; retain the FIRST image's phones. Remove every thin white fringe, rough speck, fiber, irregularity and stray translucent pixel outside the plate. The outside must be actual completely transparent alpha, not black, white or checkerboard. Reference plate at 512 scale: x48..464 and y48..464, radius90. Square output. Professional clean polished raster desktop app icon, flat vector-like edges, no new details, no text, no watermark. Preserve internal colors and original reference's very subtle ivory material only, with no extra shadow or stroke around plate.
```
