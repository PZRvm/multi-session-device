---
description: Windows 检测链分支——studioDetect 四条候选链与 adb 候选平台化、零注册表固定目录探测、路径大小写规范化；mac 行为零变化
created: 2026-10-22
---

# Windows 检测链分支 — 总结

- **背景**：Windows 支持六计划（todos/windows-support）中的 P2。mac 版检测链（Studio 配置 → 环境变量 → 默认目录 → PATH 反推）在 Windows 全部失效或部分失效：默认路径、`mdfind`、PATH 分隔符、`adb` 后缀、jbr 布局全是 macOS 假设。方案与批复见 think-report 20261022125639（零注册表口径）。
- **做了什么**：`studioDetect.ts` 加 `Deps.platform` 接缝，四条候选链逐项 win32 分支（configRoot `%APPDATA%\Google`、盘符路径形状（正反斜杠混排都收）+ `normalize`、默认目录 `%LOCALAPPDATA%\Android\Sdk`、PATH 按 `;` 找 `adb.exe`）；Studio 本体 win32 走固定目录探测（`C:\Program Files\Android\Android Studio` 的 `bin\studio64.exe` 在场即采纳，mdfind 不可达）；jbr 布局 `<studio>\jbr` + `java.exe`；`isStudioSdk` win32 大小写不敏感比较。`adb.ts` 候选链补 `%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe` 标准候选 + `windowsHide`。顺带修复 `defaultAdbOnPath` 的 `fileExists` 接缝从未生效的问题（默认行为不变）。
- **为什么这么选**：零注册表是用户批复的口径（无 Windows 环境期先零依赖落地，注册表增强留 backlog）；配置文件解析逻辑 mac/Windows 同构（官方 troubleshooting 页逐平台路径表），平移复用而非重写。
- **结果**：+9 单测（win 检测链 5、isStudioSdk 大小写 2、adb 候选 2），全套 1325 过、typecheck/lint 0 错；mac 行为零变化（既有用例零改动全绿）。plan 2026-10-22-windows-studio-detect 状态 completed。
- **后续**：真机对照（真装 Studio 的 `%APPDATA%` 配置字段形态回填用例）归 Windows 集成收口；`sdkMigration.ts:296` 的 adb 探测 win 假阴性记 issue 待后续批次修；用户自选目录装 Studio 的场景探测不到（jbr 走应用自管 JRE 兜底）。
