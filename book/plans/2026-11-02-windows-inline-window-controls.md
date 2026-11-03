---
description: 按用户修订移除主窗和设置窗的通栏顶部行，将标识放回左栏，窗口按钮与 Logcat 直接悬置右上
status: completed
created: 2026-11-02
---

# Windows 窗口控件融入原分栏

## Step 0：需求简报

- 背景：用户验收后明确不接受独立的自定义顶部栏，要求恢复原先分栏格式。
- 范围：Windows 主窗、设置窗的 renderer 布局及相应组件测试、视觉验证、设计文档。
- 排除：不改 macOS/Linux、不改原生窗口覆盖层配置、图标资源、主题同步、窗口能力、日志和设备业务、IPC。
- 需求：主窗图标、标题、外观、设置、设备数量直接位于左侧列表板头；右上原生按钮保留，Logcat 直接放在按钮左侧，不增加通栏。设置窗图标和“设置”放入左侧导航顶部，右侧详情从原来顶边开始，原生按钮直接置于右上。
- 边界：继续使用透明拖拽命中区域，但它不占文档流、不绘制背景或分隔线。日志 dock 工具栏和录屏状态需避让实际原生按钮；不能把所有正文整体下移 40px。
- 授权：本轮用户消息已明确要求调整布局，按此修订直接实施。无新增权限、通知或数据。

## 阶段 1：分析

现有 App 的 windows-header 和 workspace 形成了全宽 40px 行；SettingsWindow 的 windows-header 同样使导航和详情整体下移。根因是将原生按钮安全区误做成独立布局行。BoardHead 已有透明图标和标题，可直接放回 list-pane；设置标识可直接放进 nav。

影响文件：App.tsx、SettingsWindow.tsx、App.logcat.test.tsx、SettingsWindow.test.tsx、DESIGN.md，以及本轮计划和报告。主进程不需要修改。

## 阶段 2：设计

- App 恢复原横向 flex：list-pane 内唯一 BoardHead，画布和分隔条从 y=0 开始，不再有 workspace 和 header 行。
- 左侧 list-head 仅在 Windows 限制板头最大宽度为安全区减去右侧操作区的 40px，保留上一轮已验证的 500px 主窗 / 420px 左栏避让；不改变设备列表实际宽度。
- Windows Logcat 放在根容器的绝对定位操作区，按 titlebar-area-x/width 计算右缘，右间距 10px、顶部 5px、按钮 30px。不依赖画布或 dock 的右缘；空设备时继续不显示。
- 透明 40px 拖拽命中区先于正文渲染，pointer-events:none；左侧控件和 Logcat 维持 no-drag。命中区不参与排版、不产生背景或边线。
- Windows 日志 dock 仅将内部工具栏下移到 40px，画布继续占满窗高。录屏状态仍在画布右侧，Windows 局部下移到 50px，避开原生按钮与浮动 Logcat。
- SettingsWindow 移除 header，将 40px 图标/标题标识放进 nav，导航按钮仍从约 46px 开始；详情 main 从 y=0 开始。Windows 复用透明拖拽区，Mac 原 32px 拖拽区保持原样。
- 仅修订旧测试中“独立顶部行”的规格断言，保留所有原有按钮行为与平台回归检查。jsdom 证明结构，真实 Electron 证明正文 y=0 和右上安全区。

## 阶段 3–6

- [x] 先更新结构与回归测试并确认因旧布局失败。
- [x] 修改两个 renderer 文件，不改主进程和业务。
- [x] 组件测试、typecheck、lint、build 通过；真实 Electron 检查两窗正文顶边、左右归属、dock/主题/缩放和安全区并留截图。
- [x] 只读评审，发现只记录不修。
- [x] 更新设计说明、功能报告、计划状态，刷新 book 索引及卫生检查。


结果：五文件 76 项通过，类型检查、lint、生产构建和格式检查通过；三个 Electron 设备缩放档各 23 项通过，画布/nav/详情均从 y=0 开始。独立评审无确定性新增缺陷，真实鼠标命中与 Mac 真机限制见 [功能报告](../notes/summary/2026-11/2026-11-02-windows-inline-window-controls.md)。
