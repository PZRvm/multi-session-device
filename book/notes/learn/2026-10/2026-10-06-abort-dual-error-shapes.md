---
description: AbortController 取消会以两种错误形态到达——自检点的 CancelledError 与 fetch/execFile 的原生 AbortError；分流只认一种会让取消穿成失败
tags: [abortcontroller, fetch, electron, downloader, gotcha]
---

# Abort 取消的双错误形态分流

- **Scenario**: 给下载链路织入 AbortSignal 取消：自检点（每 chunk 检查 `signal.aborted`）抛自定义 `CancelledError`，组合层 catch 它返回 canceled。真机跑「下载 6 秒后 abort」——`AbortError: This operation was aborted` 直接穿透抛出：fetch 在 signal 中断时抛原生 DOMException（AbortError），根本没走到下一个自检点。单测注入的内存流感知不到这一点（流自身不因 signal 中断）。
- **Why**: signal 的中断路径有两条——消费方自检（可控、错误形态自定义）与底层操作（fetch 的连接/流、child_process 的 kill）原生抛 `AbortError`（DOMException 与 Node 的同名异类都有）。只分流自定义形态，原生形态就会带着「已取消」的 signal 穿进失败路径：用户点了取消却看到下载失败横幅。
- **How to apply**: 组合层取消分流认两种：`error instanceof CancelledError || (signal?.aborted === true && error.name === 'AbortError')`——signal 已中止时的 AbortError 一律归取消。注入式单测覆盖不了原生形态（mock 流不会自己断），必须真机（真实 fetch + 真实 abort）验证一次取消链路；本仓库 downloader 的五中断点单测 + 真机中断实证缺一不可。
