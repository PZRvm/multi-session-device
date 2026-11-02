---
description: 截图编辑器阶段 5 评审——八项检查与 plan 专项全部通过，无 P1/P2；1 项 P3（导出防重 React state 理论重入窗口，来源同款，main 侧占位兜底）
created: 2026-11-02
tags: [review, p3, screenshot, editor, race]
---

# 截图编辑器阶段 5 评审（plan 2026-11-02-screenshot-editor T7）

评审范围：`git diff 3af2256..36becab`（38 文件，+4899/−85）。按 `book/guidelines/review-checklist.md` 八项 + plan T7 专项（sender 归属、过期、停止清理、并发、文件防覆盖、通知与生成入口）过完整 diff。

## 结论：无 P1/P2，1 项 P3 记录不修

- 重复代码：无。`writeShotToDownloads` 为原 save 链抽取共享（editDownload 同链复用）；`EditorShell`（editorWrapper.ts 413 行）是源 app.css 3013—3421 段完整搬家 + 13 个 token 映射（每处映射有记录与理由），非新抽象。
- 授权/权限：`screenshotOpenEditor` 走 `requireMainSender`；编辑三通道（getEditImage/editCopy/editDownload）走 `requireEditorDevice`——归属由 main 窗口登记表解析（`screenshotEditorDeviceId` 按 WebContents 匹配），不信 renderer 自报 id；preload 纯透传不做权限。未登记窗调用被拒（T2 用例覆盖）。
- 竞态：editCopy 对账→剪贴板→回写全同步段（Node 单线程原子，无 await 间隙）；editDownload 占位（saves.add）→写盘→`cache.get(deviceId) === slot` 身份比较回写（下载期间被顶替不回写、已落盘文件如实报成功）；窗口控制器迟到事件代次守卫 + 就绪后崩溃释放登记可重开；主窗侧 `editingRef` 同步镜像防重复开窗。
- 事务边界：复制→下载不误报过期的闭环在 `rebaseAfterExport`（导出成功重取单槽换新 captureId，标注烘焙清零）；rebase 失败（缓存被新截图顶替）走编辑窗错误条，成品已在剪贴板，无假成功也无假失败。
- 漏掉的提醒/边界：`parseEditApplyPayload` 全链守卫（captureId 长度 1—128、PNG data URL 前缀 + 30MB 封顶、nativeImage 验图非空且尺寸>0）；空缓存开窗默认度量、空态由取图如实呈现；极小图 MIN 度量保工具条；失败态无编辑入口（测试覆盖）。
- 超出批准范围：无。`git diff 3af2256..HEAD -- src/main/devices/` 为空；改动全落 screenshot 域、共享契约/i18n、构建配置与 book 文档，与 plan 任务一一对应。
- plan 专项核对：未替换源算法（窗口尺寸算法锚点常量原值迁入）；未引入另一套历史/绘图库（konva 10.8.0 为源同库）；未搬入浏览器会话管理；无错误态假成功。

## P3-1：编辑窗导出防重用 React state——同 tick 极速双击理论可重入

问题：`EditorWindow.tsx` 的 `busy`（useState）在 `export()` 入口 `if (!captureId || busy) return` 读取。同一次渲染提交前两次 click 各自闭包捕获旧值 `busy=false`，理论上双 invoke。迁自来源同款实现（保留来源行为）。

后果评估：轻微。editDownload 重入时第二请求被 main 侧 `saves.has` 占位拒绝（报 save busy，不双写文件、TOCTOU 链本身有 link 原子占名）；editCopy 无占位但幂等（同 dataUrl 两次写剪贴板与缓存，结果等价）。用户可见最坏情况是第二次导出弹一条 busy/过期错误条。

复现：人工难以触发（需同一提交窗口内双击）；T6 人工验收可顺手连点导出钮实测。

建议方向：若后续处置，仿 `useScreenshot.edit` 的 `editingRef` 模式加同步 ref 镜像（点击即读）。处置时保持与来源的 diff 可解释性——单独小改动，附接缝理由。

## 基线相关（非本功能引入，已有 issue）

Windows 全量测试 154 失败为基线固有（`2026-11-02-windows-test-baseline.md` 已记录 153 项同类；screenshot 域仅 `/bin/sleep` 1 条，`git show 3af2256` 确认为既有用例非本次新增）。本功能范围 34+25+32 用例除该条外全绿。
