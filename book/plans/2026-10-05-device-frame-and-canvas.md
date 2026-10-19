---
description: 用主题工作台替换投屏黑色背景，为手机和平板增加不同外框并保持完整画面与触控坐标一致
status: draft
created: 2026-10-05
---

# 投屏工作台与设备外框 — plan

> 用户要求先创建计划。本轮完成 Step 0、Phase 1、Phase 2，未实施。关联 [stage04](../notes/summary/2026-10/2026-10-09-模拟器对接.md) 投屏验收；不改变阶段步骤。

## Requirements brief

用户截图 2 中，右侧整个投屏区域是大块黑底。需要把屏幕之外的区域改成随主题变化的中性工作台，并在设备画面外加模拟 Android 设备的边框。手机和平板使用不同外框。

- 作用域：DeviceCanvas 的工作台、装饰外框、尺寸计算和输入命中区域；为已有手机/平板画像派生最小外观提示。
- 排除项：SDK 原生 skin 下载/解析、机型级像素复刻、开孔遮挡屏幕、Wear/TV 外框、折叠姿态控制、Android Studio 分类导航、API/高级设置、视频协议和解码性能改造。
- 边界：画面等比居中、完整不裁切；外框只包在屏幕之外，不能减少屏幕可见像素。设备类别不能按当前视频横竖方向猜测。

验收要求：大块黑底消失；手机为修长、较大外圆角与较窄侧边的外壳，平板为四边较均匀、较小外圆角的外壳；转屏后仍保留原设备类型；装饰边框与工作台不触发设备 down；触控、滑动、捏合、输入与工具条全部可用。

## Impact range

- [DeviceCanvas.tsx](../../src/renderer/src/components/DeviceCanvas.tsx) 的 `Stage` 固定 `background: #000`，覆盖整个可用区；canvas 自身也有黑色底。大面积空白黑边属于 Stage，并非必须由视频填满。
- [geometry.ts](../../src/renderer/src/screen/geometry.ts) 当前按完整 Stage 计算 `ScreenLayout`；[useDeviceInput.ts](../../src/renderer/src/hooks/useDeviceInput.ts) 自己根据 Stage 的 rect 与 layout 偏移映射输入。引入外框后，两者必须使用同一个最终屏幕矩形。
- [共享类型](../../src/shared/types.ts) 的 Device/DeviceProfile 没有设备类型。[profiles.ts](../../src/main/emulator/profiles.ts) 只返回 id/name，不能可靠区分手机、平板与折叠手机。
- [DESIGN.md](../../DESIGN.md) 要求主题单源、右画布中性色、无 box-shadow。设备外框可以采用大外圆角，但不能把普通控件改成同样圆角。

| 文件                                                       | 动作                                                                  |
| ---------------------------------------------------------- | --------------------------------------------------------------------- |
| `src/shared/types.ts`                                      | 增加可选的 `frameKind: phone/tablet/generic` 外观提示，兼容旧设备     |
| `src/main/emulator/profiles.ts`、新增 `profileMetadata.ts` | 从当前 SDK 官方画像定义派生手机/平板提示，按 profileId 与现有列表关联 |
| `src/main/devices/index.ts`                                | 为内存快照补外观提示；不把外观改为 AVD 硬件配置，不增加 JSON 迁移     |
| `src/renderer/src/components/DeviceCanvas.tsx`             | 主题工作台 + 屏幕外框 + 状态覆盖层                                    |
| `src/renderer/src/screen/geometry.ts`                      | 外框预留空间后的屏幕矩形与外框矩形                                    |
| `src/renderer/src/hooks/useDeviceInput.ts`                 | 复用最终屏幕矩形，消除两套坐标逻辑的偏差                              |
| `src/shared/themeSystems.ts`、`DESIGN.md`                  | 如现有 tokens 不足，新增中性设备外壳 tokens，并说明外框形状用途       |
| 相关 `__tests__/`                                          | 几何/命中和类别边界测试；既有投屏回归                                 |

风险：只加 CSS padding 而输入仍按旧矩形计算会产生触控偏移；圆角裁切 canvas 会隐藏边角内容；用屏幕长宽比判型会把横屏手机或展开折叠手机识别为平板；缩窄窗口时外框挤出视口。

## Design

### 类别与数据流

只扩展外观提示，不实现分类向导。main 从应用自有 SDK 的画像元数据按 id 派生类别，复用已有画像缓存；快照透过既有 devices 通道传递，renderer 不读文件。此元数据读取能力以后可复用于 [分类调研](../think-report/20261005221831-模拟器向导分类与附加设置.md)，本计划独立于分类页面改造。

手机/平板判型使用画像标签、物理对角线和折叠标记；平板判定为无特殊标签、对角线至少 7 英寸且非折叠设备。Pixel Fold 仍归手机。读取以当前 SDK 定义为准，不按名称包含 Tablet 或视频分辨率猜测。缺 SDK/缺画像/解析失败返回 generic 中性外框，不阻塞启停或投屏；错误可诊断，不修改已有设备记录。

派生结果只进入内存展示快照；id、name、排序、AVD 内容及 JSON v1 保持现有归属。重启或 SDK 变化可重新派生。元数据读取细节在实施 Phase 2 细化，采用当前 SDK JAR 中 XML 提取与按 id 合并；控制路径、文件大小及缓存失效，不依赖安装 Android Studio。

### 外框与几何

| 样式 | 初始外框度量（CSS px）          | 形状                                            |
| ---- | ------------------------------- | ----------------------------------------------- |
| 手机 | 左右 8、上 18、下 12；外圆角 24 | 上边框内可有小型听筒/摄像头装饰，绝不压在屏幕上 |
| 平板 | 四边 12；外圆角 16              | 均匀边框，摄像头装饰置于外框内，不加手机听筒    |
| 未知 | 四边 8；外圆角 10               | 通用外框，不声称具体设备类型                    |

以上是计划中的初始设计，实施时走 impeccable 技能在真实窗口调校。颜色由主题 tokens 提供：工作台使用 board 中性色阶；外壳与外缘使用新增或已有中性 token，无阴影、无橙色装饰。canvas 的黑色仅保留为未绘制屏幕底色。

布局先给外框和视口留空，再缩放视频。设 Stage 为 W×H，安全间距 p=12，外框边距为 L/R/T/B，则 scale = min((W−2p−L−R)/视频宽, (H−2p−T−B)/视频高)。先居中完整外框，再计算其内部屏幕偏移；返回同一份 `screenRect` 与 `frameRect`。尺寸不足时降低装饰度量至预设紧凑档，仍不足则不渲染可交互画面，避免负尺寸/NaN。

屏幕不设会裁切像素的圆角或开孔；外圆角只作用于屏幕外的外壳。外框不挂设备输入，装饰为 aria-hidden、pointer-events:none。Stage 的输入处理依据 screenRect 判断 down 是否命中；已 capture 的拖动沿既有规则夹到屏幕范围，正常释放手势。

ResizeObserver、视频尺寸/generation 和 frameKind 任一变化都重算矩形；旋转沿现有代次释放输入后更新。工具条继续在 Stage 下方占固定空间。连接/错误/重试覆盖层随主题变化，保持可读与可操作，未 ready 时禁注入。

## Build order

1. 为现有画像/设备快照派生最小外观提示。验证 Pixel 手机、Pixel Tablet、展开折叠手机、未知画像及 SDK 缺失，外观失败不阻塞业务。
2. 在 geometry 中实现外框预留和最终屏幕矩形；补纯函数边界测试，先证明完整画面、居中和命中正确。
3. 接入工作台与两类外框，useDeviceInput 使用同一矩形。验证真机点屏幕四角/中心、拖出屏幕释放、双指手势与转屏。
4. 真机手机/平板 × 亮暗 × 横竖屏 × 窄窗口/拖动分栏截图验收，回归工具条、错误重试和切换设备。
5. 相关测试、typecheck、lint、改动文件格式检查与 build；Phase 5 review 只记录，Phase 6 回写。

## Test plan

- 几何：外框和屏幕都在安全区域，屏幕比例与视频一致；极窄/矮/0 尺寸无负值；横竖切换、非对称上边框仍居中完整外框。
- 命中：屏幕左上/中心/右下映射正确，外框及留白不发 down；已有手势出界与 pointer cancel 仍释放；Stage 偏移不为零时坐标正确。
- 类别：手机、平板、折叠手机以及未知 id；SDK 更新后缓存失效；旧设备不需要迁移，横屏不会改成平板。
- 集成：真实投屏触摸/滑动/捏合/中文输入/物理键、设备切换与停止；画面内容没有被外圆角、装饰或工具条遮住。

视觉通过实际截图确认，不能用 jsdom 样式存在代替。不新增为常量或装饰 DOM 结构服务的测试；回归现有几何与投屏检查，完整裁切/输入边界需要明确证据。

## Done criteria

本轮终点为可执行的 draft 计划。未来完成需手机和平板外框区别可见、主题工作台替换大块黑底、完整画面与触控回归通过、相关检查通过。review 发现记录在案，按 stage 权限记录验收结果后才将 plan 改为 completed；运行 `npm run book:index`。
