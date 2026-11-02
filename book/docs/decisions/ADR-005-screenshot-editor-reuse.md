---
description: 截图编辑器直接迁入多会话浏览器实现——Konva/react-konva 是复用源编辑器的绘图依赖而非新 UI 栈；图标、窗口、缓存与文件发布按本项目差异适配
status: accepted
created: 2026-11-02
---

# ADR-005：截图编辑器复刻自 multi-session-browser

模拟器/真机截屏后需要标注、打码、加文字、裁剪再复制/保存。姊妹项目 multi-session-browser 已有用户认可的编辑器（微信式六工具 + 马赛克双模式 + 裁剪 + 50 步历史 + 复制/下载 + 成品续编）。裁决：**直接迁入其实现与交互**，不重写相同能力，不抽通用图片编辑 SDK，不替换绘图库。

## 绘图依赖

`konva@10.8.0`、`react-konva@19.2.7` 是源编辑器的绘图层，版本复制源锁文件值（不择新）。两者只在独立截图编辑窗入口（screenshot-editor.html）加载，主窗不静态引入。不引入仅供 Node 画布的 canvas/skia-canvas，不改 Electron/React 主版本。Konva 携带已知坑位的官方修复已随源码迁入（马赛克 `cache({ pixelRatio: 1 })` 规避 DPR 块径漂移，konva issue #1591）。

## 复用基线

源仓库提交 `1c5db74029796e6f73c96c65d66de0ff76e385ed`；四个核心文件（editorConstants / AnnotationStage / EditorToolbar / EditorWindow）SHA256 已核验一致，迁移时逐文件 diff，差异仅限下列必要适配。来源限制（无图层/导入/旋转/滤镜/橡皮擦/单标注删除/手动缩放/图库/未保存关窗确认）一并保留。

## 必要差异（本地接缝，非行为重设计）

- **缓存按设备**：源是全局单槽 `lastCapture`；本项目 `Map<deviceId, CachedShot>` 加 `captureId` 对账，编辑窗身份由 main 登记 sender→deviceId 解析。
- **窗口按设备单例**：`Map<deviceId, WindowSession>`，同设备重复编辑聚焦原窗；生命周期参照本项目 settings 窗（就绪/超时/崩溃可重开）。
- **图标**：源用 @ant-design/icons；本项目规范 lucide-react，按语义一一对应，不引入 antd。
- **取词**：源 `useT` 全局 i18n hook；本项目 `SCREENSHOT_EDITOR_COPY` 三语 Record + `useCopy` 窄适配，文字原样迁移。
- **样式**：源 app.css 编辑器段收敛为编辑器组件唯一 styled Wrapper，`--chrome-*` 别名对接本项目 `--board-*`/`--accent-*` tokens。
- **落盘**：复用本项目「唯一临时文件 → link 原子占名 → EEXIST 重试」writer，不照搬源 rename 覆盖行为；编辑窗下载按保存时刻命名、锚定截图来源设备名。
- **导出返回**：`ScreenshotSaveResult.fileName`（现有保存 API 已定），不迁源的绝对 path 返回值。

详情见 [plan](../../plans/2026-11-02-screenshot-editor.md)。
