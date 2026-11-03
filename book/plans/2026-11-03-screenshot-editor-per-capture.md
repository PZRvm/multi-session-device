---
description: 修复同设备新截图复用旧编辑页的问题，按截图建立编辑窗口并隔离取图、导出与缓存回写
status: completed
---

# 每张截图独立编辑窗口

## Requirements brief

- 背景：截第一张图并打开编辑页后，再截第二张图、点编辑，仍回到第一张编辑页。用户要求第二张打开新的编辑页，本轮先阅读实现、分析方案并编写开发计划。
- 范围：截图域的编辑快照、窗口复用依据、sender 归属、复制/下载回写、窗口释放和对应测试。
- 排除：不改 ADB 采集、标注/裁剪算法、工具栏布局、主题、气泡样式、文件命名及防覆盖发布；不增加截图历史列表、持久化或依赖。
- 要求：同设备的不同截图使用不同窗口；已有窗口保留当前图片与未导出的标注。重复编辑同一张截图仍聚焦已有窗口，最小化时先还原。
- 推荐边界：旧截图窗口仍可复制、下载、续编；旧窗口产出不得覆盖较新的设备截图。设备停止后沿用当前失效规则，旧窗口可留在屏幕上，但取图、导出拒绝过期；重新运行不复活旧会话。
- 本轮交付：阶段 1/2 分析与可执行计划。用户后续授权在独立 worktree 执行；分支 `fix/screenshot-editor-per-capture`，基分支 `dev`，端口 6176。

## Impact range

### 当前调用链与根因

1. [`useScreenshot.ts`](../../src/renderer/src/hooks/useScreenshot.ts) 的 `edit()` 调用 `window.api.screenshot.openEditor(device.id)`，没有重新截图。开窗 busy 独立于截屏 busy，开窗期间可能截到下一张。
2. [`preload/api/screenshot.ts`](../../src/preload/api/screenshot.ts) 将设备 ID 传给 `screenshot:open-editor`。
3. [`screenshot/index.ts`](../../src/main/screenshot/index.ts) 每设备只存一条 `CachedShot`。每次 capture 换新 `captureId`；open-editor 仅把设备 ID、缓存宽高传给窗口模块。
4. [`window/screenshotEditor.ts`](../../src/main/window/screenshotEditor.ts) 的 `sessions` 按设备 ID 登记。找到该设备窗口就返回原 Promise、还原并聚焦，不重新加载页面。
5. [`EditorWindow.tsx`](../../src/renderer/src/components/ScreenshotEditor/EditorWindow.tsx) 挂载时取图，导出成功后再取图续编；聚焦不触发换图。因此第二次编辑仍显示第一张。
6. 编辑通道只由 sender 解析设备，然后读取该设备最近缓存。第二张截图替换缓存后，第一张窗口持有的 `captureId` 会被 `reconcileShot` 判过期。只改窗口 Map 的 key，仍会出现旧图无法导出、加载时取到后一张及成品回写串图。

原计划明确采用“一设备一窗”与“新截图使旧导出过期”，不是偶发 React 状态未刷新，见 [原计划 T2/T3、V7](2026-11-02-screenshot-editor.md)。现有窗口测试也断言同设备只构造一窗；本次需要用新的行为测试替换这部分预期，并保留权限、加载失败和代次守卫断言。

影响链：主窗编辑入口 → main 固定当前截图 → 按截图复用/建立窗口 → sender 解析编辑会话 → 会话内取图/产出 → 有条件更新设备最近缓存。

### 风险

- 开窗与取图之间又发生截屏：图像、尺寸必须来自开窗时同一份快照。
- 产出会换 `captureId`：它是版本对账值，不能同时承担稳定的窗口身份。
- 两个窗口交错导出：旧窗口不得修改较新的缓存，续编不能跳到别窗图片。
- 关闭、超时、崩溃及迟到事件：只释放自己的会话，不能删除后续重开的窗口或快照。
- 多窗增加内存持有量：只保留最近缓存和在用会话，不建立无限历史；关闭与失败时及时解除引用。
- 设备停止发生在下载中：文件已落盘如实报成功，但不能回填已清理的数据。

## Design

### 方案选择

| 方案 | 结果 | 选择 |
| --- | --- | --- |
| 聚焦旧窗时重新载入第二张 | 覆盖第一张标注，仍只有一个窗口 | 不采用 |
| 每次点编辑都建窗，仍读设备单槽 | 重复点击产生多窗，且旧图仍失效，加载期间可能串图 | 不采用 |
| 按截图稳定身份复用窗口，编辑数据独立保留 | 新截图新窗口，同图聚焦；各窗独立取图、产出 | 推荐 |

### 身份与数据

在现有截图域内维护，避免引入通用会话管理层：

- `sourceCaptureId`：每次真实截屏生成的稳定来源身份；成品回写保留此值。
- `captureId`：沿用现有载荷字段，表示当前图片版本；每次成功产出后更新。renderer 无需新增身份字段。
- `editorSessionId`：main 内部编辑会话身份。窗口关闭/失败后重开生成新值，用于 sender 归属与释放代次检查。
- 设备最近缓存继续按设备 ID 存储，供原保存入口与下一次编辑入口使用。
- 编辑会话保存 `{ deviceId, sourceCaptureId, shot }`；同一设备、同一来源截图至多一个有效编辑会话。`shot` 初始引用当前条目，产出时换成新条目，不原地修改共享 Buffer。
- 开窗 handler 在第一次 await 前读取最近条目、查重并登记会话。重复请求找到在途会话时共享窗口就绪结果；先登记再建窗，避免重复构造。

### 窗口与主进程内部接口

- 窗口控制器按 `editorSessionId` 登记窗口；其建窗参数包括设备归属、固定的宽高和本会话释放回调。窗口模块不持有 PNG。
- 将仅返回设备 ID 的 sender 查询改成返回 `{ deviceId, editorSessionId } | null`。截图域再校验本地会话存在且归属一致；不接受 renderer 自报设备或会话身份。
- 建议内部签名：`openEditor(sessionId, deviceId, options)`、`editorSession(sender)`，`options` 携尺寸与 `onRelease`；具体类型留在 main 内，不扩展公开 IPC。
- 关闭、就绪前超时/加载失败、就绪后崩溃均触发幂等释放。回调捕获会话对象/ID，只有仍为当前登记代次才删除复用映射；开窗 reject 的兜底清理也执行同样检查。
- 继续保留 15 秒就绪超时、最小化还原、显示缩放、原生三灯高度监听、禁止新窗口和主窗关闭全部编辑窗。
- 空缓存维持原默认尺寸错误页：使用设备专属空会话占位，取图报过期；新截图必须建立新的有图会话，不填充旧空页。

### 取图、产出与缓存回写

1. `getEditImage` 由 sender 找到编辑会话，从会话 `shot` 返回图片、版本和原像素尺寸，不再读取设备最近槽。
2. `editCopy/editDownload` 校验载荷 PNG 与版本；传入 `captureId` 只能匹配该 sender 会话的当前版本，不能匹配同设备另一窗口。
3. 保留现有按设备的 capture/save 互斥和 PNG 护栏，不改并发策略。即使图片独立，同设备截屏/保存占位期间仍返回现有 busy 错误。
4. 产出成功后更新当前编辑会话的 `shot`、换版本；renderer 成功后重取同一会话图片、清标注历史，延续既有续编行为。
5. 设备最近槽仍指向产出前条目时，才同步替换成品；槽已被新截图替代时只更新编辑会话。旧图复制仍按用户动作写系统剪贴板，下载仍发布独立文件。
6. 下载 await 返回后，再核对会话对象/原条目与设备最近条目：会话已关闭、失效或被清理时不回填；磁盘成功与后续续编失败分开反馈，沿用 renderer 已有逻辑。
7. `clearScreenshotCache(deviceId)` 同步清最近槽并使该设备全部编辑快照失效，解除图片引用与复用登记。窗口自身可保留到用户关闭；其旧 sender 不能访问重启后新会话。迟到释放回调也不能删掉新登记。

权限与通知：维持主窗才能 capture/save/open、已登记编辑窗才能取图/产出的白名单；不新增权限、系统通知或 IPC 通道。主进程内部装配与共享载荷注释同步更新。

### 文件清单

| 文件 | 修改 |
| --- | --- |
| `src/main/screenshot/index.ts` | 稳定来源身份、编辑快照、同图查重、会话取图/版本对账、有条件回写、设备级失效 |
| `src/main/window/screenshotEditor.ts` | 会话窗口登记、sender 会话归属、释放回调及原生命周期守卫适配 |
| `src/main/ipc/index.ts` | 装配新的内部窗口依赖，保留停止/清理桥 |
| `src/shared/screenshot-editor.ts` | 更新会话内取图与版本对账注释，保持公开字段不变 |
| `src/renderer/src/components/ScreenshotEditor/EditorWindow.tsx` | 同步“单槽”相关契约注释；预期无需改画布和续编逻辑 |
| `src/main/screenshot/__tests__/index.test.ts` | 多截图快照、导出隔离、停止、失败和异步回写测试 |
| `src/main/window/__tests__/screenshotEditor.test.ts` | 同图复用、异图多窗、会话 sender 与生命周期测试 |
| `src/renderer/src/components/ScreenshotEditor/__tests__/EditorWindow.test.tsx` | 验证成功后取回本窗成品、继续编辑及取图失败反馈，按需调整过期场景描述 |

`useScreenshot` 与 preload 继续传设备 ID：主进程在收到 open 请求时固定当前截图。公开 capture/save/open 返回形状保持现状。

## Build order

1. **先写失败回归**：同设备 A 截图开窗，B 截图再开窗，应构造两窗；两窗分别取回 A/B。补 A 开窗未 ready 时 B 替换设备缓存的确定性时序测试。
2. **数据和窗口同时接通**：新增稳定来源与会话快照，调整窗口 key、sender 查询、IPC 装配及释放回调。验证同来源共享在途 Promise、不同来源独立窗口；空缓存仍可呈现错误。
3. **接通产出隔离**：按会话对账与续编；仅当前条目可回写设备最近槽。验证 A/B 交错复制和下载、A 不能覆盖 B、伪造另一窗口版本无副作用。
4. **补完整生命周期**：停止清理、关闭释放、超时、构造失败、load reject、崩溃、迟到事件和下载期间清理。每步运行相应窗口/截图测试，不改范围外问题。
5. **阶段 4 验证**：运行下述相关测试和仓库门禁；真实 Electron 人工验证两窗内容和标注互不影响，记录结果，不能仅用 mock 窗口断言替代验收。
6. **阶段 5 评审**：按 review-checklist 检查身份、来源权限、竞态、引用释放和改动范围；发现的问题只记录到 issue，不顺手修。
7. **阶段 6 收尾**：按 book-writeback 写当月功能报告；必要时写 learn/issue，在新文档中说明对旧计划“一设备一窗/新图使旧窗过期”的替代关系，不改写旧验收历史；完成后更新本计划状态、刷新索引。此阶段发现问题仍只记录。

## Test plan

- 正常：A 编辑中截 B，B 新开；A 的未导出标注保留。B 重复编辑聚焦 B，B 最小化后编辑先还原；不同设备保持隔离。
- 续编：A、B 均能复制→下载→再标注；A 导出后设备最近保存仍是 B；B 导出可更新其最近槽；关闭当前窗口后重开读取正确成品。
- 竞态：A 在开窗加载期间截 B，A 仍取 A；A 下载期间截 B，A 完成不能覆盖 B；同图并发开窗只建一窗；旧会话关闭或失败的迟到事件不释放新会话。
- 权限：主窗/未知窗调用编辑专属通道拒绝；同设备另一窗口的 `captureId` 也拒绝；非法 PNG、空图、超长载荷及错误版本在剪贴板/磁盘副作用前失败。
- 清理：关闭一个不影响另一个；加载失败可重开；主窗关闭清全部；设备停止/断连后旧会话失效，重启截图新开；停止/关窗发生在下载中不复活缓存，已发布文件如实成功。
- 回归：截图入剪贴板、原保存、下载重名防覆盖、设备切换、10 秒气泡收起、缩放/窗口下限及 macOS 原生按钮定位维持现状。

执行命令（已运行）：

```bash
npm test -- src/main/screenshot/__tests__/index.test.ts src/main/window/__tests__/screenshotEditor.test.ts src/renderer/src/components/ScreenshotEditor/__tests__/EditorWindow.test.tsx src/renderer/src/hooks/__tests__/useScreenshot.test.tsx
npm run typecheck
npm run lint
npm test
npm run build
npm run book:index
npm run book:release-check
```

## Done criteria

- [x] Step 0：需求、范围和推荐边界已写明。
- [x] 阶段 1：已核实真实调用链、单例与单槽根因及关联风险。
- [x] 阶段 2：数据、接口、文件、实施顺序和测试计划已落盘。
- [x] 阶段 3：多图窗口与快照隔离接通；先用失败回归复现旧窗导出 stale，再实施修复。
- [x] 阶段 4：全仓 1568 项通过、6 项跳过；build（含 typecheck）、lint、格式通过。Electron 39.8.10 双窗标注保留、页面复制/下载续编、缓存隔离与停止失效验证通过。
- [x] 阶段 5：按八项清单评审，无新增阻塞问题；既有尺寸校验注释已过时，只记录 issue。
- [x] 阶段 6：功能报告、会话身份与引用释放经验、注释问题和计划状态已回写；索引及 book 检查通过。

## 实施结果

本计划替代原截图编辑计划中“一设备一窗”与“新截图使旧窗口过期”的行为，旧计划保留历史。设备停止失效、按设备互斥、公开 IPC 结构、画布和样式维持现状。截图域直接扫描在用会话查找相同来源，没有新增复用索引或通用管理层。

真实 Electron 验证使用两张合成 PNG，经真实 capture/open IPC、preload、窗口控制器与构建后的 Konva 页面运行，未连接真机重验 ADB 采集。测试结果与临时截图证据路径见[功能报告](../notes/summary/2026-11/2026-11-03-screenshot-editor-per-capture.md)。

## 2026-11-04 复审修复轮

- Step 0：用户授权修复 P2 真机断连清理与 P3 注释，并合入 dev。范围仅 removed 事件接线、续编注释和装配测试；不改画布、采集、布局、公开 IPC，不推送 GitHub。
- 阶段 1/2：removed 分支首先调用 clearScreenshotCache(event.id)，同步使最近截图与全部旧会话失效；重连新图不恢复旧窗。用真实 registerIpcHandlers 和截图域验证事件接线，沿用下载中清理测试验证已发布文件成功且不回填。注释改述尺寸异常防御，运行逻辑不动。无新增权限或通知。
- [x] 阶段 3：先复现 removed 后原保存错误成功，再同步清理截图；续编注释已修正。
- [x] 阶段 4：新增 2 项装配测试，全仓 1570 项通过、6 项跳过；build（含 typecheck）、lint、格式通过。
- [x] 阶段 5：按八项清单复核，未发现新增待处理问题。
- [x] 阶段 6：报告与问题修复结果已回写，索引及 book 检查通过；随后提交工作分支，按 merge-worktree 合入 dev 并复验。
