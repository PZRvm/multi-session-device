---
description: 拖拽 APK 安装设计：画布拖放（webUtils 取路径）→ adb install -r → 悬停高亮与结果浮层，每设备串行
status: in_progress
created: 2026-10-10
---

# 拖拽 APK 进画面即安装 — plan

设计阶段（Step 0 / Phase 1 / Phase 2）已完成，实现未开始。覆盖 stage 步骤「拖拽 APK 进画面即安装并显示结果 + 宿主↔设备剪贴板共享」中的 APK 半边；双向剪贴板共享仍未开工，步骤在本批完成后仍不勾选。

依据：[stage05](../stage/05-功能完善.md)、[workflow](../guidelines/workflow.md) 前三阶段。

## Requirements brief — Step 0

### Background

测试人员安装被测应用最高频的动作就是把 APK 拖进设备画面。当前应用没有任何安装入口，用户需要另开终端敲 adb 命令。主窗画布（DeviceCanvas）目前没有任何拖放代码，是干净的新增。

### Scope

- Affects：`DeviceCanvas` 的拖放守卫与结果浮层挂载、拖放高亮/结果浮层组件（新文件）、主进程安装域（`adb install`）、preload 拖放文件路径中转、IPC 通道与类型、i18n 词条。
- Does NOT affect：宿主↔设备双向剪贴板共享（同一步骤另一半，未开工，不因本批勾选步骤）、XAPK/APKM/APKS 拆分包（一期仅标准 `.apk`）、一次多文件/批量安装（一期单文件）、设备列表作为拖放目标（仅画布）、CanvasPlaceholder（未运行设备的占位画面不接拖放，一期拖上去无效）、安装后自动启动应用（不做）、应用内包管理/卸载界面（不做）、scrcpy 域。
- Boundaries：仅当前选中且 running（serial 已发布）的设备接受安装；拖入即安装，无二次确认弹层；安装期间设备其他操作不受影响；一台设备同一时间只允许一个安装（串行，不排队）。

### Requirement

| 能力 | 要求 | 一期边界 |
| --- | --- | --- |
| 拖放接受判定 | 仅「单文件 + 扩展名 `.apk`（大小写不敏感）+ 选中设备 running」三者同时成立才有效 | 无效拖入不出现高亮，松开无动作、无报错 |
| 悬停高亮 | 有效拖入悬停时画布高亮 + 提示「松开安装到 {设备名}」 | 高亮只在拖放会话期间存在 |
| 安装执行 | 松开 → main 执行 `adb -s <serial> install -r <路径>` | `-r` 重装保留数据；不加 `-d`/`-t`（见风险表） |
| 进度与结果 | 安装中显示不定进度指示（adb 不产出百分比）；成功「已安装 {文件名}」；失败给词条 + stderr 摘要附详情 | 不做百分比进度条与取消按钮 |
| 串行约束 | 同设备安装中再次拖入 → 高亮照常、松开提示「正在安装，请稍候」 | 不排队；不同设备互不影响 |

设计轴：

- [recommended — confirm or reject] 拖入松开即安装，不加确认弹层——拖放本身就是明确意图；误拖概率低且 `-r` 重装不丢数据。
- [recommended — confirm or reject] 文件路径经 preload `webUtils.getPathForFile` 中转（Electron 39 已移除 `File.path`），不使用任何 deprecated 途径。
- [recommended — confirm or reject] 安装为单次 invoke 拿最终结果，不建 main→renderer 推送通道（无真实进度可推）。
- [recommended — confirm or reject] 拖放目标限定 `.stage`（设备画面区），工具条行 `.toolbar-row` 不参与。

## Impact range — Phase 1

### 现状与可复用项

| 证据 | 当前事实 | 设计后果 |
| --- | --- | --- |
| `src/renderer/src/components/DeviceCanvas.tsx` | `.stage` 承载皮肤/视频/遮罩/代理输入；无任何 drag 处理 | onDragOver/onDrop 挂 `.stage`；drop 守卫不影响既有 pointer/键盘链路 |
| Electron `^39.2.6` | `File.path` 自 Electron 32 移除；`webUtils.getPathForFile`（Electron 30+）只能在 preload 调用 | renderer 拿不到绝对路径——preload 暴露路径中转函数，File 对象经 contextBridge 传入（受支持） |
| `src/main/devices/index.ts:181` | `adbBinaryPath` / `androidToolEnv` 已导出 | 安装域 import 消费，不改 devices 域 |
| `src/shared/types.ts:242-243` | running 设备有 `serial` | running 校验与 serial 取值在 main 侧（注入，沿 `assertEditorTarget` 先例） |
| `src/main/window/wizard.ts` 注入先例 | 编辑目标核验经注入进向导域 | 安装域同款：`registerInstallIpc({ adbPath, toolEnv, assertRunning, getDeviceSerial })` |
| `src/shared/i18n/errors.ts` 惯例 | 失败词条 + 原始 stderr 附详情（i18n 批 3） | adb 安装失败按 stderr 签名映射词条，原文附详情 |

影响图：

```text
拖 .apk 悬停 .stage (dragover, preventDefault)
    |
    v  守卫: 单文件 + .apk + 设备 running
高亮 overlay「松开安装到 {设备名}」
    |
    v 松开 (drop)
preload installApi.resolveDropPaths([File]) --> webUtils.getPathForFile --> 绝对路径
    |
    v
preload installApi.install(deviceId, filePath) --> main 安装域
    |   校验 running/serial --> 每设备互斥 --> adb -s <serial> install -r <path>
    v
ApiResult --> DeviceCanvas 浮层: spinner --> 「已安装 {文件名}」 | 失败词条+stderr
```

### 风险与处理

| 风险 | 本轮设计处理 |
| --- | --- |
| `File.path` 在 Electron 39 不存在，拖放拿不到路径 | 全部路径获取走 preload `webUtils.getPathForFile` 中转；实现时对 File 传参做一次真机冒烟 |
| dragover 未 preventDefault 导致 drop 不触发 | `.stage` 上统一 `preventDefault`；drop 再判有效性；与 pointer 输入无冲突（拖放会话期间浏览器不派发 pointer 事件给目标） |
| 拖放误触输入通道（代理 input 聚焦） | 拖放事件不经过代理 input；不追加处理 |
| debug/testOnly 包被拒装（`INSTALL_FAILED_TEST_ONLY`） | 一期仅 `-r`；该签名映射到专门词条并附「包需正式签名或 adb 加 -t」提示；是否默认加 `-t` 留给实现批用户裁决 |
| 降级安装失败（`INSTALL_FAILED_OLDER_SDK` 之类版本约束） | 不加 `-d`；失败签名映射词条，原文附详情 |
| 大 APK 安装 1–2 分钟无反馈 | 不定进度 spinner + 「正在安装」；不设 UI 超时硬杀，adb 自然返回；应用退出时安装进程随 adb 断连自终（不进 `shutdownStreams` 扫尾） |
| 设备停止/重启发生在安装中 | 结果作废：`devicesChanged` 到非 running 时浮层清为空态；adb 进程自然结束 |
| 同设备并发拖入 | main 侧每设备互斥；安装中再拖结果直接回「正在安装」词条 |
| 文件路径含空格/中文 | 路径经数组参数传 `execFile`（不走 shell 拼接），天然安全 |

## Design — Phase 2

### 1. 通道与接口

通道常量（`src/shared/ipc-channels.ts` append）：

| 通道 | 方向 | 载荷 / 返回 | 说明 |
| --- | --- | --- | --- |
| `apkInstall` | renderer → main | `{ deviceId, filePath }` → `ApiResult<{ fileName: string }>` | 串行守卫在 main；失败返回错误词条键 + stderr 摘要 |

（路径中转不走 ipcMain：`webUtils.getPathForFile` 是 preload 本地同步调用，暴露为普通函数。）

类型（`src/shared/types.ts` append）：`ApkInstallResult`。

主进程安装域 `src/main/apkInstall/index.ts`：

- `registerInstallIpc({ adbPath, toolEnv, assertRunning, getDeviceSerial, getDeviceName })`——校验与设备信息注入。
- `execFile(adb, ['-s', serial, 'install', '-r', filePath])`，stdout/stderr 收集；成功判定 exit 0 且 stdout 含 `Success`。
- stderr 签名 → 错误键映射（初始表）：`INSTALL_FAILED_UPDATE_INCOMPATIBLE`（签名不一致，需先卸载）、`INSTALL_FAILED_INSUFFICIENT_STORAGE`（空间不足）、`INSTALL_FAILED_OLDER_SDK`（系统版本过低）、`INSTALL_FAILED_TEST_ONLY`（testOnly 包）、`INSTALL_PARSE_FAILED_NOT_APK`（文件损坏或非 APK）；未命中签名用通用 `apkInstallFailed`，原文一律附详情。
- 每设备互斥 Map；`INSTALL_FAILED_TEST_ONLY` 是否补 `-t` 重试留实现批决定，本批不自动重试。

preload `install.ts`：

```ts
installApi = {
  resolveDropPaths: (files: File[]): string[] => files.map((f) => webUtils.getPathForFile(f)),
  install: (deviceId: string, filePath: string): Promise<ApiResult<ApkInstallResult>> =>
    ipcRenderer.invoke(IPC_CHANNELS.apkInstall, { deviceId, filePath })
}
```

### 2. renderer：拖放与浮层

```text
拖入悬停（有效）:                       松开安装中/结果:
┌────────────────────┐                ┌────────────────────┐
│ ░░░░░░░░░░░░░░░░░░ │                │                    │
│ ░░  [模拟器画面] ░░ │                │   [模拟器画面]      │
│ ░░░░░░░░░░░░░░░░░░ │                │                    │
│  ↓ 松开安装到 Pixel │                └──┬─────────────────┘
│ ░░░░░░░░░░░░░░░░░░ │           浮层: ⟳ 正在安装 app.apk…
└────────────────────┘                或  ✓ 已安装 app.apk
                                      或  ✕ 安装失败：空间不足（详情）
```

- `DeviceCanvas.tsx`：`.stage` 增 onDragOver/onDrop/onDragLeave；本地 state `dragging`（悬停有效时 true）；把 `{ state, fileName, error }` 交给浮层渲染。`DeviceCanvas` 是本批唯一被修改的既有 renderer 文件，新增逻辑集中、不触碰视频/输入链路。
- `InstallDropOverlay.tsx`（新组件）：两种形态——拖放高亮（全幅半透明描边 + 底部提示条）与结果浮层（右下角小卡：spinner / 成功 / 失败 + 详情展开）。`role="status"`，非模态。
- `useApkInstall.ts`（新 hook）：drop 守卫（单文件、`.apk`、running）→ resolveDropPaths → install 调用 → 状态机（idle → dragging → installing → done | failed）；`devicesChanged` 时按设备状态复位。
- 串行反馈：installing 期间再 drop，浮层切「正在安装，请稍候」词条。

### 3. 文件清单（Phase 3）

| 文件 | 工作 |
| --- | --- |
| `src/main/apkInstall/index.ts`（+ `__tests__/`） | adb 安装、签名→词条映射、每设备互斥、注入式校验 |
| `src/main/ipc/index.ts` | 注册安装域 |
| `src/shared/ipc-channels.ts`、`src/shared/types.ts` | 安装通道与结果类型 append |
| `src/preload/api/install.ts`、`api/index.ts`、`index.d.ts` | install 桥 + `resolveDropPaths`（webUtils 中转）append |
| `src/renderer/src/components/DeviceCanvas.tsx`（+ 测试） | `.stage` 拖放三事件与守卫、浮层挂载 |
| `src/renderer/src/components/InstallDropOverlay.tsx`（+ 测试） | 高亮与结果浮层 |
| `src/renderer/src/hooks/useApkInstall.ts`（+ 测试） | drop 守卫与安装状态机 |
| `src/shared/i18n/mainWindow.ts`、`errors.ts` | 词条 append |

i18n 初始键（mainWindow 域）：`apkDropHint`（含 {设备名} 占位）、`apkInstalling`（含 {文件名}）、`apkInstalled`、`apkInstallBusy`；（errors 域）：`apkInstallFailed`、`apkInstallSignatureMismatch`、`apkInstallNoSpace`、`apkInstallOlderSdk`、`apkInstallTestOnly`、`apkInstallNotApk`、`apkDeviceNotRunning`。

## Done criteria — 设计阶段

需求与排除项填实（剪贴板另半边、拆分包、批量、确认弹层明确排除）；`webUtils` 路径中转方案与 Electron 39 约束写明；签名→词条映射表、互斥与状态机可直接进 Phase 3；stage05 步骤挂本 plan 链接且注明「APK 半边、步骤仍不勾」；book 索引构建通过。

实现阶段终点（Phase 3-6 另行勾选）：真机验证拖入高亮与安装、`.apk` 守卫拒绝无效拖入、成功/各类失败文案、串行约束、设备中途停止的浮层复位。

## 实施结果 — 2026-10-10（worktree feature/drag-apk-install）

### Phase 3：实现

- main：`src/main/apkInstall/index.ts` 新域——`runAdb`（emulator/adb 助手，scrub env + stderr 4KiB 尾界）执行 `adb -s <serial> install -r`，`timeoutMs: 0` 不硬杀；五签名（签名不一致/空间不足/版本过低/testOnly/非 APK）映射词条、原文附详情；每设备 `Set` 互斥。devices 域只加一个导出 `runningDeviceSerial`（copySerial 同口径守卫），ipc/index.ts 注入接线。
- preload：`api/install.ts`——`resolveDropPaths`（webUtils.getPathForFile 中转，Electron 39 无 File.path）+ `install` invoke；不占 ipcMain。
- renderer：`useApkInstall` hook（idle → dragging → installing → installed/failed 状态机、busy 4 秒提示、成功 5 秒/失败 10 秒自动清除）+ `InstallDropOverlay`（悬停全幅虚线高亮 + 右下角状态卡，pointer-events:none）+ DeviceCanvas `.stage` 挂四个拖放事件。
- i18n：mainWindow 4 键（dropHint/installing/installed/busy）+ errors 8 键（busy 主侧互斥）×三语。

### Phase 4：验证

- 全量 881 项通过（6 项原有跳过），本批新增 30 项：apkInstall 域 14（sender/payload/running 守卫、-r 参数与 timeoutMs 0、串行与跨设备、七类失败映射、exit 兜底）、devices `runningDeviceSerial` 1、hook 7（高亮/子元素不收/成功失败自清/非 apk 静默/busy）、浮层 5、DeviceCanvas 接线 3。typecheck、lint、build 通过。

### Phase 5：review（只记录）

- P3 实现偏离：dragover 期 Chromium 不暴露文件名/扩展名（安全限制），「非 .apk 高亮不出现」无法预判——守卫移到 drop 时，非 apk 拖入会短暂高亮后静默收起（hook 注释已写明）。
- P3 遗留：真机链路（真拖文件 → webUtils → adb install 实装）jsdom 测不了，待一次真机冒烟后再翻 completed。
- P3 既有问题：[devices 测试 mock 实现跨 describe 泄漏](../notes/issue/2026-10/2026-10-10-devices-test-mock-leak.md) 已记 issue，未修。

### 状态

实现与自动化验证完成，**status 保持 in_progress**——真机拖放冒烟通过后翻 completed。

