---
description: dev 合并后集成 review——剪贴板批与录屏批的接缝核查；无新增 P0/P1/P2，P3 两项已修复（dispose 改名 unbindAll 并注明非终态语义、补跨特性回归测试）
created: 2026-10-16
status: resolved
tags: [clipboard, recording, code-review, merge, integration]
---

# dev 双批合并集成 review（剪贴板 fc381ac + 录屏 9e78539/783a01b）

两批各自已过独立的 Phase 5 review 与修复批（录屏见 [phase5-review](2026-10-16-recording-phase5-review.md)；剪贴板见 [clipboard-sync-review](2026-10-16-clipboard-sync-review-and-acceptance.md)）。本轮只审**合并接缝与相互作用**：两批共同改动的 4 个源码文件（context.ts、lifecycle.ts、types.ts、scrcpy `__tests__/index.test.ts`）+ 共享运行时资源（控制 writer、会话生命周期、退出流、i18n、打包）。按 workflow 只记录不修复。

## 已验证安全的接缝

- **控制 writer 共享（最关键）**：录屏的关键帧请求 `session.writer.resetVideo()`（SafeControlMessageWriter 继承自基类）与剪贴板 `setClipboard` 都收敛到覆写后的 `write()`——整条消息一次 `rawWriter.write` + 等待 consumed，socket 层天然串行，消息不会交错截断。录屏请求不经过剪贴板单飞队列也安全（剪贴板积压上限 16 任务，不会拖垮 15s 关键帧超时预算）。
- **会话清理顺序**：合并后 `cleanupSession` 为 录屏通知（endRecordingSource）→ abort → 剪贴板解绑/队列释放（onFailure 有 abort 守卫，销毁期的队列拒绝不会误报错误销毁会话）→ 既有清理。两批的通知互不依赖，顺序无耦合。
- **故障级联方向**：剪贴板写队列故障（5s 无 ACK）会销毁会话——若此时该设备正在录屏，录制以 sourceEnded 中断并保留已落盘材料走离线生成，符合录屏 plan 的中断设计。反向无级联（录屏不动控制通道状态）。
- **退出流**：录制退出确认期间剪贴板照常；save/discard 分支先收口录制，`destroyAll` 再 dispose 剪贴板；退出折返（清理失败留下）路径由录屏批新增的 `cancelRecordingQuit` 恢复常态、外部会话重建后剪贴板随 ready 重新绑定。
- **合并冲突的解决**：context.ts 取两侧并集（clipboardSync 行 + serverPathFor 收敛到 scrcpyServerPath）；剪贴板调研报告 add/add 取 dev 终态版；README 由 book:index 重建（292 篇，链接全通）。
- **测试与 i18n**：scrcpy `__tests__/index.test.ts` 录屏侧为纯追加（剪贴板侧断言无削弱）；errors.ts（剪贴板）与 recording.ts（录屏）分文件、三语键集/占位符断言全过。
- **独立复核剪贴板批的 P2 修复**：合并树上 `exceedsBudget` O(1) 长度前置、超限正文不进 key/基线的实现与注释均在位。
- **打包**：合并后主仓库 `npm run build` 通过（此前 build 只在工作树跑过录制侧）。

## 发现

### P3

1. **`clipboardSync.dispose()` 语义非终态，退出折返路径恰好依赖这一点** — `src/main/scrcpy/clipboardSync.ts:199-202`。dispose 只是 `rebind(null)` + 清 echo 表，没有 disposed 标志；`destroyAll` 调用它之后，若退出流程折返（清理失败留下）且外部会话重建，`refreshClipboardBinding` 会按 ready 重新启动轮询。当前这正是折返后剪贴板继续工作的**正确**行为，但方法名暗示终态——未来若有人"补上" disposed 标志，会无声破坏退出折返恢复路径。建议：改名或补一行注释声明 dispose=解绑全部而非永久停用（改动须另行授权）。

2. **缺一条跨特性回归测试** — 没有任何测试同时挂起录屏任务与剪贴板同步。最值得补的一条：录屏进行中剪贴板写队列超时 → 会话销毁 → 录制任务带 sourceEnded 中断、材料保留可离线生成。目前该链路只有代码走读结论，两批各自测试均为单特性。建议补一条 manager 层集成测试（须另行授权）。

## 验证边界

- 本轮证据为代码走读 + 合并后全门禁（typecheck、lint 零警告、1315 项测试通过/6 项既有跳过、build、book release-check）；未起合并后应用的 GUI 实窗冒烟。
- 录屏批既有欠账不变：十分钟同步 112/106ms 未过 100ms 门槛、Android 13+ 真机音频待硬件验收（plan 保持 in_progress）。
- 剪贴板批既有边界不变：其他 ROM/系统版本与长期内存观察不在本轮范围。

## 修复批（2026-10-16，用户授权「修复这些问题」）

1. **已修复**：`clipboardSync.dispose()` 改名 `unbindAll()`，方法注释与 `destroyAll` 调用点双处写明「非终态——退出折返恢复依赖重新绑定，勿改成带 disposed 标志的永久停用」；语义从命名上消除误读。clipboardQueue 的 `dispose` 保持原名（它是真终态，closed 标志在）。
2. **已修复**：`src/main/scrcpy/__tests__/index.test.ts` recording describe 新增集成测试「clipboard queue failure destroys the session and interrupts recording subscriptions」——让控制 socket 下一次写入失败，验证剪贴板单飞队列 onFailure 销毁会话、录制订阅恰好收到一次带失败原因的 ended、录制源随之失效。与 manager 层既有的「ended → 中断保留材料」用例（manager.test.ts）合成完整链路。

回归门禁：typecheck、lint 零警告、全量 1316 项测试通过/6 项既有跳过（+1 新增）、四个触碰文件 prettier 通过。
