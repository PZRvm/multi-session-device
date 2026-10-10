---
description: 截屏一键保存设计：相机按钮→adb screencap→先入系统剪贴板，气泡内「保存」写入下载目录
status: completed
created: 2026-10-10
---

# 截屏：剪贴板优先 + 保存到下载目录 — plan

设计阶段（Step 0 / Phase 1 / Phase 2）已完成，实现未开始。用户 2026-10-10 定下流程：截图先落入系统剪贴板（立即可粘贴使用），需要留存时点「保存」按钮，文件写入系统下载目录。

依据：[stage05](../stage/05-功能完善.md) 步骤「截屏一键保存 + 录屏」、[workflow](../guidelines/workflow.md) 前三阶段。

## Requirements brief — Step 0

### Background

测试人员取证与汇报需要设备画面快照。经用户确认的流程是两段式：截屏瞬间进系统剪贴板（马上能粘到聊天、文档、缺陷单里）；需要归档时再点保存，落到操作系统下载目录，不弹文件选择对话框。

### Scope

- Affects：`DeviceToolbar`（新增相机按钮）、截屏结果气泡（新组件）、主进程截屏域（`adb screencap` + 受控写剪贴板 + 下载目录写文件 + 每设备最近一张缓存）、IPC 通道与类型、i18n 词条。
- Does NOT affect：录屏（同一 stage 步骤的另一半，另批设计与实现，本批不预留半成品接口）、双向剪贴板共享（stage 另一步骤，本功能是宿主主动截图，不是设备剪贴板同步）、scrcpy 域（不用视频帧截取，走 adb 独立实现）、文件/目录选择对话框（固定下载目录，不弹 dialog）、设置窗、向导窗、「打开所在文件夹」动作（可后续追加，本批不做）。
- Boundaries：仅对当前选中且 running（serial 已发布）的设备截屏；一次一张，重复截屏覆盖剪贴板与缓存；缓存只在设备运行期间有效，设备停止即清；图片不经应用落盘中转（剪贴板与下载目录之外不留副本）。

### Requirement

| 能力 | 要求 | 一期边界 |
| --- | --- | --- |
| 截屏 | 点相机按钮 → main 执行 `adb -s <serial> exec-out screencap -p` → PNG 写入系统剪贴板 → 气泡反馈 | 截屏进行中按钮 busy 禁用，防连点 |
| 结果气泡 | 锚定在工具条按钮附近：缩略图 + 「已复制到剪贴板」+〔保存到下载文件夹〕按钮 | 10 秒无操作自动消失；再截屏即刷新；设备停止/切换即失效消失 |
| 保存 | 点保存 → main 用缓存写入 `app.getPath('downloads')`，文件名 `{设备名}-YYYYMMDD-HHmmss.png` | 重名自动追加 `-2`、`-3`；成功后气泡显示文件名 |
| 错误反馈 | 截屏失败（adb 失败/设备未就绪）、保存失败（目录不可写）给出词条 + 原始错误附详情 | 沿 errors 域「词条 + 原文附详情」惯例 |

设计轴：

- [recommended — confirm or reject] 截屏按钮放 `DeviceToolbar` 物理键工具条内（rotate 旋钮已是「工具类按钮混入工具条」的先例，相机同语义）；不新增画布角浮钮。
- [recommended — confirm or reject] 保存不走保存对话框，固定下载目录（用户指定流程）；文件名自动生成不询问。
- [recommended — confirm or reject] main 持每设备最近一张缓存，保存动作直接用缓存，不让 base64 大负载在 IPC 上来回两趟。
- [recommended — confirm or reject] 截屏写剪贴板为受控通道：只写「本设备刚截的图」，校验设备 running，镜像 `devices:copy-serial` 的守卫先例，不开放任意图像写入接口。

## Impact range — Phase 1

### 现状与可复用项

| 证据 | 当前事实 | 设计后果 |
| --- | --- | --- |
| `src/main/devices/index.ts:2426-2428` | `devicesCopySerial`：校验设备 running 后 `clipboard.writeText`，通道注释明确「受控文本复制，不开放任意剪贴板读写」 | 截图写图通道同策略：`clipboard.writeImage`，同一守卫风格 |
| `src/main/devices/index.ts:181` | `adbBinaryPath` / `androidToolEnv` 已导出 | 截屏域 import 消费，不改 devices 域 |
| `src/shared/types.ts:242-243` | running 设备有 `serial` | 校验 running + 取 serial 都在 main 侧完成，renderer 只传 deviceId |
| `src/renderer/src/components/DeviceToolbar.tsx` | 6 个物理键 + rotate 工具键的数组式渲染 | 相机按钮 append 进数组，含 busy 态与 aria-label |
| `src/main/dialog/` | 原生 dialog 域存在 | 本批不使用；错误反馈走既有主窗 alert/toast 通路 |
| `app.getPath` 现状 | 全仓只用 `userData`，下载目录无先例 | `app.getPath('downloads')` 新引入，失败（目录异常）走保存失败词条 |
| `src/shared/i18n/errors.ts` | 「词条 + 原始 stderr/error 附详情」惯例（i18n 批 3） | 截屏失败词条附 adb stderr 摘要 |

影响图：

```text
DeviceToolbar [相机] --busy--> preload screenshotApi.capture(deviceId)
    |
    v
main 截屏域: 校验 running/serial --> adb -s <serial> exec-out screencap -p
    |                                    |
    v                                    v
clipboard.writeImage(PNG)         每设备缓存 {buffer,width,height,capturedAt}
    |
    v
返回 {pngBase64(缩略用), width, height} --> 气泡: 缩略图 + 已复制 + [保存]
                                           |
保存点击 --> screenshotApi.save(deviceId) --+--> 写 downloads/{设备名}-时间戳.png
                                           |        (重名 -2/-3)
                                           v
                                      气泡变「已保存: 文件名」
```

### 风险与处理

| 风险 | 本轮设计处理 |
| --- | --- |
| PNG 体积经 IPC（1080×2340 全屏约 1–3MB，base64 膨胀 33%） | 单次 invoke 一次性返回可接受；不做流式与缩略图服务端生成，renderer 用 CSS 缩放显示缩略图 |
| 覆盖用户剪贴板内容 | 这是功能的预期行为；气泡文案「已复制到剪贴板」明确告知 |
| 下载目录不可写/被重定向 | 保存失败词条 + 原始 error 附详情；不自动降级到其他目录 |
| adb 失败（设备重启中、adb 断连） | capture 返回错误结果（`screenshotDeviceNotRunning` / `screenshotCaptureFailed` + stderr 摘要），气泡显示错误态 |
| 设备名含中文/emoji/路径非法字符 | 文件名清洗：保留中文，替换 `/ \ : * ? " < > |` 与控制符为 `_`；超长截断 60 字符 |
| 气泡缓存与设备状态脱节（停止后点保存） | stopped 钩子清缓存（与日志域共用生命周期桥挂点）；save 前校验缓存仍在，不在则报「已过期，请重新截屏」 |
| 连点/重复截屏竞态 | 按钮截屏期间 disabled；capture 进行中重复调用直接拒绝（每设备一把互斥） |

## Design — Phase 2

### 1. 通道与接口

通道常量（`src/shared/ipc-channels.ts` append）：

| 通道 | 方向 | 载荷 / 返回 | 说明 |
| --- | --- | --- | --- |
| `screenshotCapture` | renderer → main | `{ deviceId }` → `ApiResult<{ pngBase64: string; width: number; height: number }>` | 执行截屏 + 写剪贴板 + 缓存；失败返回错误词条键 + 详情 |
| `screenshotSave` | renderer → main | `{ deviceId }` → `ApiResult<{ fileName: string }>` | 用缓存写下载目录；缓存失效返回 `screenshotStale` |

类型（`src/shared/types.ts` append）：`ScreenshotCaptureResult`、`ScreenshotSaveResult`。

主进程截屏域 `src/main/screenshot/index.ts`：

- `registerScreenshotIpc({ adbPath, toolEnv, assertRunning, getDeviceSerial, getDeviceName })` —— running 校验与设备信息经注入（沿 `assertEditorTarget` 注入先例，不反向依赖 devices 域）。
- capture：互斥锁 → `execFile(adb, ['-s', serial, 'exec-out', 'screencap', '-p'])` 收 Buffer → `clipboard.writeImage(nativeImage.createFromBuffer(buf))` → 缓存 `{ buffer, width, height, capturedAt }` → 返回 base64。
- save：读缓存 → 清洗设备名 → 生成 `{name}-YYYYMMDD-HHmmss.png` → 存在则 `-2`/`-3` 递增 → 写入 `app.getPath('downloads')`。
- 生命周期：`attachDeviceStreamBridge` 的 `stopped`/`beforeKill` 钩子清对应缓存。

preload `screenshot.ts`：`screenshotApi.capture(id)` / `screenshotApi.save(id)`，append 进 `api/index.ts` 与 `index.d.ts`。

### 2. renderer：按钮与气泡

```text
[←][⌂][▢][⏻][🔈][🔉]  [↻] [📷]        📷 点击后：
 ─── 物理键 ───        工具键  │      ┌──────────────────────┐
                                └────>│ [缩略图 96px 宽]       │
                                       │ 已复制到剪贴板         │
                                       │ [保存到下载文件夹]     │
                                       └──────────────────────┘
```

- `DeviceToolbar.tsx`：按钮数组 append `{ button: 'screenshot', icon: Camera }`；busy 态（截屏中）disabled；回调 `onScreenshot` 由 `DeviceCanvas` 接线到 hook。`DeviceToolbar` 是本批唯一被修改的既有 renderer 文件。
- `ScreenshotPopover.tsx`（新组件，由 DeviceToolbar 渲染锚定）：缩略图（CSS 缩放）、状态文案（已复制/已保存 文件名/错误）、保存按钮（保存中 spinner）、10 秒自动消失计时（新截屏重置）。不阻塞画布交互（非模态、`role="status"`）。
- `useScreenshot.ts`（新 hook，放 `src/renderer/src/hooks/`）：封装 capture/save 调用与气泡状态机（idle → copied → saving → saved | error），供 DeviceCanvas 接线。

### 3. 文件清单（Phase 3）

| 文件 | 工作 |
| --- | --- |
| `src/main/screenshot/index.ts`（+ `__tests__/`） | adb 截屏、受控写剪贴板、每设备缓存、下载目录写文件、文件名清洗与重名递增 |
| `src/main/ipc/index.ts` | 注册截屏域；生命周期桥挂缓存清理 |
| `src/shared/ipc-channels.ts`、`src/shared/types.ts` | 截屏通道与结果类型 append |
| `src/preload/api/screenshot.ts`、`api/index.ts`、`index.d.ts` | 白名单桥 append |
| `src/renderer/src/components/DeviceToolbar.tsx`（+ 测试） | 相机按钮 + busy + 气泡挂载点 |
| `src/renderer/src/components/ScreenshotPopover.tsx`（+ 测试） | 缩略图、状态与保存按钮、自动消失 |
| `src/renderer/src/hooks/useScreenshot.ts`（+ 测试） | capture/save 状态机 |
| `src/shared/i18n/mainWindow.ts`、`errors.ts` | 词条 append |

i18n 初始键（mainWindow 域）：`screenshotAction`、`screenshotCopied`、`screenshotSave`、`screenshotSaving`、`screenshotSaved`；（errors 域）：`screenshotDeviceNotRunning`、`screenshotCaptureFailed`、`screenshotSaveFailed`、`screenshotStale`。

## Done criteria — 设计阶段

需求与排除项填实（录屏、双向剪贴板、保存对话框明确排除）；影响图与风险有代码证据；两段式流程（剪贴板 → 下载目录）的通道、缓存与气泡状态机可直接进 Phase 3；受控剪贴板策略与 `copy-serial` 先例的镜像关系写明；stage05 步骤挂本 plan 链接；book 索引构建通过。

实现阶段终点（Phase 3-6 另行勾选）：真机验证截屏即入剪贴板可粘贴、气泡保存落下载目录、重名递增、设备停止后缓存清理与气泡失效、失败路径文案。

## 实施结果 — 2026-10-10

### Phase 3：实现

- 主进程 `src/main/screenshot/`：自持 Buffer 版 adb runner（`runAdb` 会把 stdout utf8 化破坏 PNG 字节，`exec-out` 二进制必须整段收 Buffer，含 15s 超时与 32MB 护栏）；PNG 魔数校验；`clipboard.writeImage` 受控写图；每设备最近一张缓存；下载目录写入含设备名清洗与重名 `-2`/`-3` 递增。
- capture 互斥为**同步占位**（检查与 `add` 之间不得有 await）——测试先行抓出的真并发缺陷，修复后两次快速调用必有一次被拒。
- IPC 接线：`screenshot:capture` / `screenshot:save` 仅登记主窗；running 校验经注入（ipc 层传入 devices 域新增的只读访问器 `runningDeviceRef`，镜像 `savedDeviceSkinRef` 先例）。**偏差记录**：plan 文件清单未列 `src/main/devices/index.ts`，实际新增一处导出访问器（8 行），属注入模式的必要数据源，非反向依赖。
- 缓存清理挂在 `attachDeviceStreamBridge` 既有调用点（`stopped`/`beforeKill`）——该桥是 `Object.assign` 单订阅者，二次挂载会覆盖投屏钩子，故只扩展现有回调。
- renderer：`DeviceToolbar` 追加相机按钮（rotate 工具键先例，不随投屏 `disabled` 牵连）+ `ScreenshotPopover`（缩略图/已复制/保存中/已保存/错误五态，`role="status"` 非模态）+ `useScreenshot` 状态机（10s 自动消失；设备离开 running 时气泡经**渲染期派生**收起，不用 effect setState——react-hooks 新规则禁令）。
- i18n：mainWindow 域 5 键、errors 域 5 键（较 plan 初始清单多 `screenshotBusy`，main 侧互斥防线文案），三语齐备。

### Phase 4：验证

- 新增测试 25 项（主域 11 + hook 6 + 气泡 4 + 工具条 4）；全量 **876 项通过、6 项原有跳过**；typecheck / lint / prettier / build 通过。
- 真机 CDP 验收（dev 窗口，端口 6177）：启动 Pixel 8 API 32 → running 16s（serial emulator-5554）→ 点相机钮 → 气泡「已复制到剪贴板」+ 保存按钮 → 点保存 → 「已保存：Pixel 8 API 32-20261010-141955.png」。实物核验：`~/Downloads` 产出 1.07MB 合法 PNG（1080×2400 RGBA）；`osascript clipboard info` 首项 `«class PNGf»`（约 1.5MB）证实系统剪贴板持图；气泡画面截图目检排版无破版。验收后设备已停回原状。

### Phase 5：review

按八项清单自查，总体 **fix**——发现的问题只记录不修，见 [issue：截屏批 review P3 清单](../notes/issue/2026-10/2026-10-10-screenshot-review-p3s.md)（save 并发 TOCTOU、在途 capture 与 stopped 的缓存竞态、0×0 PNG 边界等，均为 P3）。授权面复核：双通道主窗 sender 守卫、受控写图、文件名清洗杜绝路径穿越。

### Phase 6：收尾

- 经验入 [learn：exec-out 二进制流与 react-hooks 新规则](../notes/learn/2026-10/2026-10-10-screenshot-adb-binary-and-hooks-rules.md)；stage05 截屏步骤附实现批注（步骤因录屏未做保持未勾）。
- 本 plan 置 completed：仅指「截屏半边」完成；stage 步骤「截屏+录屏」整步完成仍需录屏批。

### 追加小批 — 2026-10-10 气泡手动关闭

应用户要求在气泡左上角补关闭 icon（圆形 ×，lucide X，三语 aria-label「关闭」）：`ScreenshotPopover` 加 `onClose` 与常驻关闭钮；`useScreenshot` 重新暴露 `dismiss`（渲染期派生收起路径不变）；`DeviceToolbar`/`DeviceCanvas` 接线 `onScreenshotDismiss`。新增 2 项测试、全量 878 项通过，typecheck/lint/prettier 通过；真机 CDP 验证点关闭气泡即收、再截屏气泡重现（截图目检关闭钮不遮缩略图内容）。自动消失（10s）与设备离开 running 的收起路径不受影响。

