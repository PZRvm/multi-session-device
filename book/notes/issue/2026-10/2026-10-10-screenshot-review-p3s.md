---
description: 截屏批 Phase 5 review 五项 P3——save 并发 TOCTOU、在途 capture 与 stopped 的缓存竞态、0×0 PNG 边界、错误气泡 10s 消失、spin 动画重复
created: 2026-10-10
tags: [review, p3, screenshot, race, clipboard, downloads]
---

# 截屏批 review P3 ×5（只记录，未修复）

背景：plan 2026-10-10-screenshot-clipboard-save 的 Phase 5，按八项检查单过完整 diff。无 P1/P2（授权面：双通道主窗 sender 守卫、受控写图、文件名清洗杜绝路径穿越均复核通过）。以下 P3 等后续批次或独立任务处置。

## P3-1：save 无互斥——同 tick 双击可产生两个文件

问题：renderer 侧 `save()` 用 stateRef 守卫 phase，但同一 tick 内两次点击都读到旧 ref（setState 未提交），双 invoke；main 侧 save 无锁，且 `resolveFileName` 的 `access` 检查与 `writeFile` 之间存在 TOCTOU——两个并发 save 可能拿到同一文件名，后者覆盖前者，或分别写 `-1` 与 `-2`。

复现：条件苛刻（需同一事件 tick 双击 + 提交窗口内），人工难触发；并发语义上不严谨。

建议方向：main 侧 save 挂与 capture 同款每设备互斥（或全局单飞）；`resolveFileName` 检查后写临时名再 `rename` 收口。

## P3-2：在途 capture 与 stopped 清理的竞态——缓存可能在停止后回填

问题：`stopped`/`beforeKill` 钩子清缓存，但此刻若有未完成的 capture，其完成后 `cache.set` 会把「已停设备的最后一张」重新写入缓存。气泡因渲染期派生不会显示（无用户可见影响），但缓存条目滞留至下次 stop 事件，约 1MB 级内存。

建议方向：capture 完成入缓存前复核设备仍 running（注入的 runningDeviceRef 再查一次），不 running 则丢弃。

## P3-3：合法签名但坏体的 PNG 会产生 0×0 截图

问题：PNG 前 8 字节魔数对但体损坏时，`nativeImage.createFromBuffer` 返回空图，`getSize()` 为 0×0——capture 仍按成功返回并写剪贴板，用户粘出空图。

建议方向：size 校验 `width > 0 && height > 0`，不满足走 `screenshotCaptureFailed`。

## P3-4：错误态气泡与成功态同享 10s 自动消失

问题：capture/save 失败的报错气泡 10 秒后自动消失，用户可能没看到就没了（错误信息值得多留）。

建议方向：error 态延长（30s 或不自动消失，等下一次操作重置）。

## P3-5：spin keyframes 与 DeviceCanvas 既有 `.spin` 重复

问题：`ScreenshotPopover` 自带一份 `screenshot-spin` keyframes，DeviceCanvas 已有同语义 `.spin`。两份小重复，styled-components 组件级隔离下的常规代价。

建议方向：若第三个消费者出现，提炼共享动画 token；现在不值得动。

## 其余检查项结论（clean）

- 重复：runAdbBinary 与 runAdb 结构相似是有意分层（learn 已记），非复制粘贴漂移。
- 授权：`app.getPath('downloads')` 为 OS 级用户设置，本工具不自定义；写文件名经清洗无路径穿越。
- 边界：空 PNG/超 32MB/设备名全非法字符/重名超 99 次均有兜底并有测试。
- 范围：`devices/index.ts` 新增 8 行只读访问器导出超出 plan 文件清单，已在 plan 实施结果中作为偏差记录（注入模式必要数据源）。
- 复杂度：主域自包含约 230 行，renderer 三件套职责单一。
