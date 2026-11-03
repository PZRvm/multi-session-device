---
description: 外部粘贴不会走 insertText 或 compositionend；隐藏输入代理必须显式处理 paste 并阻止默认插入
tags: [paste, clipboard, beforeinput, renderer, input, investigate]
---

# 外部粘贴需要独立处理 paste 事件

- 场景：普通打字和中文输入法可用，但宿主 Cmd+V 没进入模拟器。
- 原因：输入代理只消费 beforeinput 的 insertText 与 compositionend；原生粘贴触发 paste，再产生 insertFromPaste，不能据普通输入正常就认为粘贴也正常。默认行为会把文本留在隐藏 input。
- 做法：同步读取事件 clipboardData 的 text/plain，preventDefault，再沿现有文本剪贴板通道提交一次；暂停时直接丢弃，不排队。无需轮询宿主剪贴板或新增读取 IPC。
- 验证：受控 DOM 回归外还要用原生 Electron paste 命令，分别检查事件、IPC 数量与隐藏值。真实测试恢复宿主剪贴板，不把用户内容写入日志。检查普通打字、IME、字节预算及错误提示仍有效。

本轮原生对照：旧实现 0 次请求且隐藏 input 有值，新实现英文、中文及多行文本完整各提交一次，隐藏值为空。实施范围、版本和验收限制见 [计划](../../../plans/2026-10-09-external-text-paste.md)。
