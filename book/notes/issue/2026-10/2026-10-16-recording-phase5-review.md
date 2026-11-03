---
description: 录屏功能 Phase 5 code review 发现清单——2 项 P2、16 项 P3，无 P0/P1；修复批已全部处置，详见文末
created: 2026-10-16
status: resolved
tags: [recording, code-review, phase5, p2, p3]
---

# 录屏 Phase 5 code review 发现

按 [八项检查单](../../../guidelines/review-checklist.md) 对 worktree 全部改动（29 个修改文件 + 约 3200 行新增源码）执行 review。纪律：**只记录，不修复**；阻塞项另开经授权修复批，验收后重审。行号以本 worktree 未提交工作区为准。

## 发现

### P2

1. **失败任务无 dismiss 入口，UI 死胡同** — `src/renderer/src/components/RecordingIndicator.tsx:34-44`、`src/renderer/src/components/recordingPresentation.ts:11`。`dismiss` 命令在 IPC 白名单与 manager（`src/main/recording/manager.ts:423-430`）中齐备、`copy.dismiss` 三语已定义，但渲染端零调用（grep 证实）。原生失败对话框选「稍后处理」后任务永久驻留设备行与计时位；`canRetry=false` 的错误（如全程无画面）连重试都没有。与交互 plan「失败重试或稍后处理」的闭环不符。建议：错误终态补关闭入口（复用 dismiss 命令与文案），或产品裁定只走原生对话框路径。

2. **录制/暂停状态对屏幕阅读器不可达** — `src/renderer/src/components/RecordingIndicator.tsx:19-31`。状态文案只放在非可聚焦 div 的 `title`（AT 不播报），图标 aria-hidden，`<time>` 只播报时长；VoiceOver/NVDA 聚焦气泡无法区分录制与暂停。plan §9 要求可访问名。建议 Wrapper 加 aria-label（状态+时间）或计时元素改 `role="status"` 并纳入状态文本。

### P3

3. **stage06 概述括注改写 + 三条 `[suggested]` 直接转 `[x]`，触及 stage 权限边界** — `book/stage/06-真机接入与投屏.md` 本批 diff。AGENTS.md 规定 agent 不可修改概述、不可直接转正建议；改动标注「按用户要求核对」但属真机批而非本录屏批范围。需人工确认批准链条：确经逐条批准则销账，否则恢复原状走转正流程。

4. **退出保存成功但关机失败时录制解冻** — `src/main/recording/index.ts:167-169`。`confirmRecordingQuit` 的 finally 无条件 `setFrozen(false)`；保存分支成功后若 `prepareAppShutdown` 失败留在应用，录制已解冻且任务全部终态，与 plan「真正退出时冻结新 start」意图有出入。边缘场景。

5. **并发命令失败时错误反馈可被吞** — `src/renderer/src/stores/recordingStore.ts:16` 每个请求开始 `error: null`，`src/renderer/src/App.tsx:95-104` 依赖单一 error 弹窗：同批两台设备命令同时失败或弹窗打开前新命令发起时，前一个错误丢失。plan 要求命令失败有可见反馈。建议错误队列化或延迟清除。

6. **处理器页 dev HMR 重入无防护** — `src/renderer/src/recordingProcessor/index.ts:187-199`。模块顶层 `void api.ready()` 无重入 flag：dev 重载后以 pullSeq=0 重新拉流，被 main 判「Invalid processor pull sequence」终止整个 job。仅 dev 受影响。建议模块级防重入。

7. **VideoDecoder `error` 事件监听是死代码** — `src/renderer/src/recordingProcessor/index.ts:141-153`。WebCodecs 解码器没有 `error` DOM 事件；解码失败时 `drain()` 可能挂到 main 60s watchdog，失败原因失真为「处理页失联」。建议在解码器 error 回调显式唤醒 drain。

8. **处理器页 CSP 生产仍放行 `ws:`** — `src/renderer/recording-processor.html:7`。`connect-src 'self' ws:` 为 dev HMR 留的口子随构建产物分发；页面 script-src 'self' 无远程内容，实际风险低。建议构建期按环境注入。

9. **`||` 与 `??` 混用的条件取值不一致** — `src/renderer/src/App.tsx:99-100`。`externalSelected?.id || selected?.id` 条件与 `externalSelected?.id ?? selected!.id` 取值在 id 为空串时不一致；当前 id 生成不可达，属埋雷。建议统一判空方式。

10. **非磁盘错误冠以「磁盘写入失败」前缀** — `src/main/recording/capture.ts:128-130`。`video()` 捕获的所有异常（含视频时间戳不连续）统一报 `diskFailed: …`，误导排障方向。建议按错误类别分文案。

11. **server 二进制路径解析双事实源** — `src/main/recording/audioTransport.ts:27-29` 逐字重复 `src/main/scrcpy/context.ts:14-17` 的打包布局判断；布局变更漏改一处则打包版录屏音频失效。建议抽 `serverBinaryPath()` 共用。audioTransport 与 transport.ts 约 80 行握手骨架结构性重复暂判可接受（版本/哈希/进程工具仍单源，双 socket 与 audio-only 差异真实）；出现第三个 transport 时再抽公共件。

12. **文件名清洗规则双事实源且已漂移** — `src/main/recording/publish.ts:4-13` 与 `src/main/screenshot/index.ts:105-131` 各写一份「非法字符→trim→60 字符→兜底」+ 时间戳，录屏版多前导点剥离；重名处理截图域是 access 探测（TOCTOU）、录屏域是 link+EEXIST（更正确）。建议抽 shared 工具；截图域切换须另行授权。

13. **RecordingControls 重复活动任务查找 + `.tool-btn` 样式依赖父级作用域** — `src/renderer/src/components/RecordingControls.tsx:15-19` 内联 find 与 `recordingPresentation.ts` 的 `selectedRecording` 第一优先级重复；`:29,:38` 复用 DeviceToolbar Wrapper 内定义的 `.tool-btn`，单独挂载即裸奔。建议抽 `activeRecording()` 并自带样式。

14. **i18n 死键 7 个 × 三语** — `src/shared/i18n/recording.ts`：`dismiss`、`interrupted`、`unavailableReason`、`expand`、`collapse`、`width`、`pendingHardware` 在 main 与渲染端均无消费者（旧顶部任务条与中断方案遗留）。`dismiss` 可留给发现 1 的修复使用，其余删除或注明保留原因。

15. **繁体字典缺 `cancel` 键** — `src/shared/i18n/recording.ts:163-238`。tw 依赖 `...zh` 展开，当前「取消」恰繁简同形无可见 bug，但键集已不一致（zh/en 74 键、tw 73 键），zh 文案一改繁体即静默漂移。建议补键并在测试加三语键集一致性断言。

16. **Pause/Play/Square 图标缺 aria-hidden** — `src/renderer/src/components/RecordingControls.tsx:29,38`（同文件 `Video` 有）。与项目图标惯例不一致，一致性清理。

17. **cancelled 任务全局不可见** — `src/renderer/src/components/recordingPresentation.ts:3-13`。选择器优先级 active > queued/processing > error，不含 cancelled；也无原生通知。用户拒绝无声选择后任务静默滞留快照直到退出（不占准报名额，无害）。建议明确产品预期：显示或立即清理。

18. **PRD.md 两张表整表重排无内容变化** — `book/docs/PRD.md:195-215`。列宽对齐噪音增大 diff、干扰 review。建议文档批与代码批分开提交或单独说明。

## 已查未发现问题

- **授权/权限漏洞**：recording 三通道均 `isMainSender + senderFrame === mainFrame` 双检（`src/main/recording/index.ts:94-97`）；处理器页 jobId+一次性 token+sender+frame 四重校验、错序即终止（`src/main/recording/processor.ts:45-64`）；命令白名单闭集；reveal 路径由 main 成功记录解析、拒绝任意路径；崩溃恢复仅认 UUID 目录与合法 manifest；临时目录 0o700、manifest 0o600、文件名剔控制字符与路径分隔符。preload 未新增任意路径/shell 能力。
- **事务边界**：manifest 临时文件+rename 原子替换；发布走同卷 `link`+EEXIST 递增、无覆盖、失败清理 `.part`；崩溃恢复只认 sealed/未 sealed 的有效边界，损坏尾记录显式失败不造假成片；saved 后临时目录清理有告警不阻塞。
- **竞态条件（主进程）**：渲染端先订阅后 get、revision `>=` 拒旧（等值安全）；命令按任务串行队列；start 准入在同一事件循环内原子完成；USB/无线同实体守卫的置位与检查间无 await，无交错窗口；stop 与 preparing 交错双向收敛（live 检查+seal/close 幂等）；通知按 signature 去重不重弹；audioTransport 关闭幂等且 abort 双通道兜底。
- **漏掉的边界（主进程）**：暂停区间音视频均不落盘；AAC 配置校验严格（仅 AAC-LC、变化即中断）；PTS 单调性与不连续显式失败；空段任务报 error 不产假成片；写盘队列 16MiB 有界、溢出中断任务不静默丢帧；关键帧/首音频 15s、采音停滞 5s、处理失联 60s；发布重名上限 10000 后显式失败。
- **越出批准范围（代码）**：scrcpy 侧严格停在三个窄接口 + `media.ts` 一处分发（位于配置解析后、GOP 缓存与视图流控前，未从 sendPacket/GOP 回录取材）+ `lifecycle.ts` 一处结束通知；输入/ACK 协议零改动；未触碰「初次建流重试」等既有 issue。29 个修改文件均对应 plan 文件清单职责；preferences/prompts/notifications 三文件由已 completed 的交互 plan 批准。mediabunny 精确锁 1.61.5（无 `^`），MPL-2.0 文本经 extraResources 分发，无未声明直接依赖。
- **新增复杂度**：模块按 plan 职责拆分，manager 656 行为最大单文件但职责（状态机+串行+队列）与设计一致，无需要记录的过度复杂。`discardForQuit` 退出放弃分支会短暂走一次注定失败的生成周期（先 abort 后 stop 仍入队），自愈且发生在退出路径，不单列。

## 处置

- 本清单只记录。P2 两项建议随收尾前授权修复批处理；P3 按批次酌情归入既有清理批。
- 修复后须回归：`npm run typecheck`、`npm run lint`、`npm test`、`npm run build`，并对发现 1、2 做界面可访问树复核。

## 修复批（2026-10-16，用户授权「修复所有 P2 P3」）

逐项处置（编号对应上文）：

1. **已修复**：RecordingIndicator 的 error/cancelled 终态补 dismiss 按钮（复用既有 dismiss 命令与 `copy.dismiss`）；error+canRetry 同时提供重试与关闭。
2. **已修复**：RecordingIndicator 增加 sr-only `role="status"`（状态+无声，变化即播报；时间在 live region 外避免逐秒噪音）。
3. **按合规默认处置**：stage06 概述括注与三条 `[suggested]` 步骤恢复原状（结果子行保留在 HEAD 版本中）。转正仍待用户明确批准——如此前确经批准，一句话即可恢复勾选。
4. **已修复**：`confirmRecordingQuit` leaving 分支保持冻结；新增 `cancelRecordingQuit`（解冻+恢复结果通知），接入 main 退出流的折返分支与异常 catch；顺带修复 `hasPending` 早退路径 `pause(true)` 不恢复的隐患。
5. **已修复**：store `error` 单值改 `errors[]` 队列，App 逐条弹窗（关一条弹下一条）；新增并发失败不丢首条的测试。
6. **接受现状并注明**：处理器页启动处注释说明 dev 整页重载会以 pullSeq=0 重拉、被 main 判序终止 job（重试入口仍在），不做跨重载续跑——评审给出的两个方案中择此。
7. **已修复**：drain 改为 dequeue + `fail()` 唤醒；删除无效的 `error` DOM 事件监听；四处 failure 赋值收敛为 `fail()`。
8. **已修复**：electron.vite 构建期插件剥掉 CSP 的 `ws:`（dev 保留）；打包产物已验证为 `connect-src 'self';`。
9. **已修复**：App 派生 `indicatorDevice = externalSelected ?? selected`，条件与取值语义一致。
10. **已修复**：capture 以 `DiskAppendError` 分流落盘与流校验错误；新增 `invalidStream` 三语词条；音频路径磁盘错误不再伪装成 audioLost。
11. **已修复**：context.ts 导出 `scrcpyServerPath()`，audioTransport 复用——打包布局单事实源。
12. **已修复**：抽 `src/main/filename.ts`（sanitizeFileSegment + fileTimestamp），截图与录屏发布共用；截图侧行为对齐（剥前导点）。核实截图域终名占位本就是 link+EEXIST，无需切换。
13. **已修复**：`.tool-btn` 样式抽 `toolButtonStyle.ts`（独立文件避免组件互相 import 成环）两处共用；`activeRecording()` 抽入 recordingPresentation 共用。
14. **已修复**：删 6 个死键 × 三语；`dismiss` 保留并被发现 1 的新 UI 使用。
15. **已修复**：tw 补 `cancel: '取消'`；i18n.test 新增 recording 域三语键集全等 + 占位符一致断言。
16. **已修复**：Pause/Play/Square 图标补 aria-hidden。
17. **已修复**：cancelled 纳入 selectedRecording 终态档并经 dismiss 清理（与发现 1 同一改动）；RecordingStatus 仅活动态显示摄像机图标。
18. **已处置（定性修正）**：核实 PRD 的 HEAD 版本在当前 prettier 下本就不合规——两张表的重排是 prettier 规范化强制产物，不是可避免的手动噪音（评审时按 diff 形态误判为纯重排）。保留规范化后的表格与三个内容 hunk；剩余可改进点是提交卫生（文档批与代码批分开提交），属流程约定，不改文件。

附带（同文件顺带收敛，review 渲染端报告中的微小项）：RecordingIndicator 的 pending 订阅从整数组改为布尔选择器。

回归门禁：typecheck、lint（0 警告）、`npm test` **1297 通过 / 6 既有跳过**（较修复前 +6：recordingPresentation 3、recordingStore 并发失败队列 1、i18n recording 键集/占位符 2）、`npm run build`、23 个触碰源文件 prettier 全过；打包产物 CSP 验证。发现 1、2 的界面可访问树复核待下次 dev 起动时人工过一眼（本批为代码级修复，未起 GUI）。
