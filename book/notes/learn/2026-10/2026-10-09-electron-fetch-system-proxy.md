---
description: Electron 主进程的 Node fetch 不遵循系统代理；官方皮肤用 net.fetch 后在直连 DNS 失败的真实进程中仍可获取，命令行探针不能替代应用默认路径验收
tags: [investigation, electron, proxy, fetch, skin, network]
---

# 主进程网络请求要验证应用实际使用的代理路径

- **场景**：Nexus 5 官方皮肤获取显示 TypeError: fetch failed；命令行官方资源查询此前通过。
- **证据**：本机系统代理启用，Electron session 将官方域名解析为 PROXY 127.0.0.1:7890；皮肤 boundedFetch 却调用 Node global fetch。普通探针当前两种网络栈均成功，不能倒推用户那次失败的 errno。
- **复现**：隔离 Electron 39.8.10 / Node 22.22.1 中仅让 Node 的官方域名 DNS 返回 ENOTFOUND，旧默认生产 downloadSkin 报相同 fetch failed。替换为 Chromium net.fetch，原生产获取链路成功；修改后不注入 fetchText 的默认链路也成功，Nexus 5 四份素材通过原 hash/预算核验，画面为 1080×1920、进度 100%、别名重取复用缓存。临时库清理，未写用户皮肤库或 AVD。
- **做法**：Electron IPC 内公开资源请求使用 net.fetch，保留超时、字节/像素、hash 与 URL 白名单。公开源 credentials: omit；不硬编码代理端口、不改系统设置、不关闭 TLS 校验。连接失败/超时/读取中断提供可操作提示。仅注入 fetchText 的测试会绕过默认网络缺口，必须覆盖默认生产路径。
- **边界**：本轮仅修官方皮肤；SDK/镜像的其他默认请求仍用 Node fetch，已另记问题。不会宣称当前探针成功等于用户原现场已复现。

文件：`src/main/emulator/skinSource.ts`、`src/main/emulator/__tests__/skinSource.test.ts`。参考：[Electron net 文档](https://www.electronjs.org/docs/latest/api/net/)。验证见 [计划](../../../plans/2026-10-09-skin-download-system-proxy.md)。
