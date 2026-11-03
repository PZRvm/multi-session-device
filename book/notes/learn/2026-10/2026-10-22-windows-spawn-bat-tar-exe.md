---
description: win32 下 spawn .bat/.cmd 必须 cmd.exe /c 包装（Node 安全修复后直接抛 EINVAL）；GUI 进程拉子进程要带 windowsHide 防闪黑框；Windows 解 zip 用系统自带 tar.exe（bsdtar 原生 zip64），PowerShell Expand-Archive 有 2GB 单文件上限不可用
created: 2026-10-22
tags: [windows, nodejs, child_process, unzip, sdk-bootstrap]
---

# Windows 子进程三件套——.bat 包装 / windowsHide / tar.exe 解 zip

## 规则（P1 SDK 引导平台化落地口径）

- **`.bat`/`.cmd` 不能直接 spawn**：Node 自 CVE-2024-27980 修复后（18.20+/20.12+），`spawn('x.bat')` 直接抛 EINVAL——必须 `spawn('cmd.exe', ['/c', 'x.bat', ...args])` 或 `exec()`；路径含空格要整体加引号。不要用 `shell: true` 绕（注入面更大且引号语义漂移）。
- **GUI 进程拉 console 子进程必带 `windowsHide: true`**：默认 false 会闪黑色控制台窗口（java/sdkmanager/adb/tar 全中招）；posix 上该选项无副作用，可以无条件加。注意它和 `detached: true` 组合在 win 有失效案例（nodejs/node#21825）——Windows 分支要 detached 时需真机验证。
- **Windows 解 zip 用 `tar.exe -xf`**：系统自带 bsdtar/libarchive（Win10 1803+，`System32\tar.exe`），官方支持 zip 且原生 zip64（2GB+ 条目没问题），与 macOS 自带 tar 同源同语义。`Expand-Archive` 官方文档写明底层 System.IO.Compression 限 2GB 单文件——恰好撞死 system.img，不可用。

## 适用条件

- 平台分支统一走接缝注入（`deps.platform` 默认 `process.platform`）：单测在 mac 上注入 `win32` 假形态即可覆盖 Windows 分支，darwin 快照钉住零回归。
- 本仓库落点：`src/main/emulator/platformExec.ts`（resolveCommand/spawnCommand/tarBinFor 单源）；runner 长驻进程（detached/进程组）不共用此执行器——需求形态不同，合并即无谓抽象（P1/P3 plan 已约定平行维护）。
