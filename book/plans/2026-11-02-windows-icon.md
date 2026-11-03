---
description: Windows 使用屏幕镂空的三手机透明图标，替换母版、运行时 PNG 与 ICO，清理黑屏版本和预览副本
status: completed
created: 2026-11-02
---

# Windows 透明图标

## 透明屏幕修订（2026-11-02）

用户随后指定仅用 Codex 图片生成重新出图，不用 Python 修改。已用内置 imagegen 从文字重新生成三手机造型，原样复制的试稿为 `resources/logo-multi-session-device-windows-transparent-preview.png`，三块屏幕抽样 alpha 均为 0。用户最新明确要求替换，并删除多余的黑屏图片。

Step 0：用户认为黑屏观感不好，要求把三部手机的屏幕改为透明，并将生成的透明试稿正式替换进去、清理多余黑屏图片。范围仅为 Windows 母版、运行时 PNG、ICO 与已采用的预览副本；保留 macOS/Linux 图片，不改源码或业务行为，不使用 Python。

阶段 1：Windows 消费入口已接入专用资源，替换图片即可生效。主要风险是工具把屏幕画成黑色或棋盘格而没有真实 alpha，需逐块检查屏幕透明度。

阶段 2：将用户已选定的 Codex 图片生成原图原样复制为正式 Windows 母版；仅用项目现有 Electron NativeImage 接口缩放导出 512px PNG 和七档 PNG 帧 ICO，不修改图案内容。覆盖原黑屏母版、PNG 和 ICO，确认覆盖成功后删除已采用的预览副本。验证屏幕和外部 alpha、框体保留、ICO 解码与旧平台资源不变，再更新本地 Windows 验证包。清理范围仅为本仓库资源，不删除 Codex 生成缓存。

- [x] 阶段 3：将用户选定的生成原图原样写入正式母版，用 Electron NativeImage 缩放和封装 PNG/ICO，覆盖黑屏资源，删除预览副本；未使用 Python，未修改图案内容。
- [x] 阶段 4：母版/512px PNG 三屏 alpha 抽样均为 0、框体抽样 alpha ≥250，七档 ICO 帧均可解码；四份 macOS/Linux 资源字节未变；生产构建、Windows 目录打包、六项 NativeImage 平台检查通过，从 EXE 提取的 32px 图标三个屏幕抽样 alpha 也为 0。
- [x] 阶段 5：按资源与八项评审清单复核，无源码改动、无范围外删除；已有边缘问题继续记录，不另做修图。
- [x] 阶段 6：报告和计划已更新，刷新索引并通过 book 卫生检查。

正式母版与获选生成原图字节一致（SHA256：`7295D780C2F07D4884CB8F5EF5065AF6EEEAD9EB421F27DFA25CB51871BEF1F1`）。预览文件不再单独保留，后续直接使用正式母版。验证记录：`dist/windows-icon-check/transparent-icon-export.json`。

## 黑屏修订（2026-11-02）

Step 0：用户要求将 Windows 图标三部手机的白色屏幕改为黑色。范围仅为 Windows 母版、运行时 PNG 和 ICO；保留外部透明背景、手机外框配色、层叠关系、主体尺寸及 macOS/Linux 资源，不改源码或业务行为。

阶段 1：三个消费入口已接入 Windows 专用资源，本轮只替换图片内容。风险是生成时误改框体或把屏幕挖成透明区域，需目视确认和 alpha 检查。

阶段 2：内置 imagegen 以现有 Windows 母版为编辑目标，仅将三块屏幕填为不透明黑色。覆盖同名母版，导出 512px PNG 与七档 ICO；检查 PNG/ICO 解码、透明外部、黑屏与旧平台资源不变，再更新 Windows 目录验证包及报告。

- [x] 阶段 3：生成黑屏版并替换三份 Windows 图片，未修改源码。
- [x] 阶段 4：PNG/ICO 解码与黑屏抽样通过（RGB 0/0/0、alpha 254）；四角透明；主体占高约 95.3%；四份旧平台资源字节未变。生产构建、Windows 目录打包与六项 NativeImage 检查通过，提取 EXE 图标确认黑屏。
- [x] 阶段 5：资源评审确认三块屏幕黑色、图案完整；母版少量外沿杂色记入 [P3 问题](../notes/issue/2026-11/2026-11-02-windows-icon-master-edge.md)，未继续修改。
- [x] 阶段 6：更新报告、计划状态和索引。

## Step 0：需求简报

- 背景：Windows 与 macOS 共用带米白底板的图案，用户要求 Windows 单独使用无背景、主体撑满的图标。
- 需求：先基于现有三手机图标生成透明版本，再替换 Windows 图标。保留手机配色、叠放关系和浅色屏幕；移除外层底板，主体尽量撑满方形画布且不裁切。
- 范围：新增 Windows 母版与运行时 PNG，替换 `build/icon.ico`，在 `src/main/app-icon/index.ts` 与设置页 `PaneAbout.tsx` 按平台选图。
- 排除：不改 macOS/Linux 资源、窗口行为、业务交互、安装器行为或依赖；不发布、不提交。
- 验收：新图背景有真实 alpha；主体无裁切且占满可用高度；ICO 含 16/24/32/48/64/128/256px；win32 使用新图，其余平台使用旧图；构建及相关检查通过。

## 阶段 1：分析

现有 `resources/logo-multi-session-device.png` 为三手机母版；所有窗口和对话框从 `app-icon` 引用 `appIcon`。打包配置 Windows 指向 `build/icon.ico`，macOS 指向 `build/icon.icns`，Linux 指向 `build/icon.png`。仅替换 ICO 无法覆盖开发时的窗口图标。

风险：生成图可能有底板残留、过多留白或误删屏幕；需目视检查与 alpha 检查。ICO 小尺寸需验证可解码。旧 macOS 图标与资源须保持字节不变。

## 阶段 2：设计

内置 imagegen 编辑现有母版，去掉外层底板、背景透明并放大主体。保存为 `resources/logo-multi-session-device-windows.png`，导出 512px 的 `resources/icon-windows.png` 与多尺寸 `build/icon.ico`。仅做缩放和格式转换，保留生成图 alpha。

`app-icon` 增加新 PNG 导入，`process.platform === 'win32'` 时选择新图，其余平台沿用现有图。现有 `win.icon` 配置已经正确，无需改动。

关于页也直接导入现有图标，属于同一品牌资源的消费处：增加新 PNG 导入，由 `SettingsWindow.tsx` 将已有 `platform` 属性传给版面，`platform === 'win32'` 时选新图，保留现有 64px 尺寸与布局。沿用父组件的平台值，避免新增对 preload 的直接依赖，也保持注入式预览一致。

## 阶段 3–6：执行记录

- [x] 生成并检查透明图，导出 Windows PNG/ICO，接入平台选择。主体可见高度占比约 95.2%，关于页同步使用平台图标。
- [x] 检查尺寸、透明度、ICO、旧资源哈希与构建。类型检查/lint/格式/构建、Windows 目录打包通过；相关 21 项测试通过，NativeImage 六项检查通过；四份旧资源字节未变。
- [x] 按 review 清单独立评审，未发现需记录的 P0–P3 问题。替换前全量测试已有 153 项失败，另记 issue，不在本任务修复。
- [x] 写功能报告，更新计划状态并刷新 book 索引；book 卫生检查通过。

报告：[Windows 透明图标](../notes/summary/2026-11/2026-11-02-windows-icon.md)。未安装或发布应用。

## 白屏初版提示词（内置 imagegen）

参考图为首轮移除底板后的三手机图标。最终生成结果保存在 `resources/logo-multi-session-device-windows.png`。

```text
Use case: precise-object-edit. Polish this EXACT three-smartphone transparent Windows app icon. Keep the three phones, layering, shapes, relative positions, proportions, original orange-yellow and gray colors, opaque ivory screens, earpieces and bottom bars. Two changes only: (1) make every exterior silhouette edge mathematically smooth and clean, remove all yellow/cyan/red/blue fringes, specks, dangling artifacts, ghost pixels and shadow outside the phones. Absolutely zero colored edge halo or stray pixels. All antialiasing must match adjacent phone frame colors. (2) Enlarge the intact phone group proportionally and center its bounding box on a square canvas so it fills 96 percent of the canvas height (2 percent top and bottom margins), leave symmetrical left/right empty transparent space due to the group's naturally tall proportions. No clipping. Background must be genuinely completely transparent alpha outside the phones, no backing plate, no black/white backdrop, no checkerboard, no text, no redesign. Crisp polished professional vector-like desktop icon, preserve the subtle existing material inside phones.
```

## 黑屏定稿提示词（内置 imagegen）

先以白屏 Windows 母版生成三屏黑色版本，再以首轮黑屏图作参考整理边缘。最终图覆盖同名 Windows 母版。

```text
Use case: precise-object-edit. Final production cleanup of this app icon. Preserve the EXACT three phones with BLACK opaque screens, orange front frame, dark slate middle frame, light slate rear frame, pale bottom bars, precise positions, scale and silhouette. Remove ALL tiny exterior colored fringe pixels, confetti and irregular protrusions: especially yellow ragged strips below the front phone, red at lower right of front phone, cyan/blue around rear phone. Re-render phone outlines as perfectly clean smooth rounded geometric contours with tight antialiasing. There must be NO pixels of any kind outside the smooth phone silhouettes. Three opaque PURE BLACK screen interiors, keep all existing phone geometry and colors. Completely transparent empty background, transparent margins. NO backing plate, no drop shadow, no glow, no black backdrop. Same square composition and near-full-height group, no clipping. Treat this as a clean vector-like export of the identical icon, no added details or redesign.
```

## 透明屏幕试稿提示词（内置 imagegen，未后处理）

```text
A professional minimalist Windows application icon: THREE OVERLAPPING UPRIGHT SMARTPHONE OUTLINES, stepped diagonally from lower-left foreground to upper-right background. Foreground phone frame is golden amber orange (#FFB000), middle phone frame is dark cool gray (#6F7984), back phone frame is light cool gray (#A0ACBA). Each is a simple thick rounded-rectangle phone frame with a large EMPTY TRANSPARENT rounded-rectangle screen cutout, a small dark horizontal earpiece pill in its top bezel, and a small pale gray pill in its bottom bezel. The phone frames are solid clean flat colors with perfectly smooth geometric edges. The three screens are genuine clear see-through holes with alpha zero, showing the same transparency as the empty exterior. NO black or white screen fill. Only draw the visible parts of the rear phones, hidden portions occluded by the front phone. Crisp polished flat vector aesthetic, no texture or raster noise. Square transparent PNG canvas; the combined phone group is centered and fills 94% of the canvas height with a safe unclipped margin. No background, backing plate, shadow, gradient, reflections, text, watermark, scene, or checkerboard pattern. This is a finished icon asset consisting solely of orange and gray phone frame shapes on alpha transparency.
```
