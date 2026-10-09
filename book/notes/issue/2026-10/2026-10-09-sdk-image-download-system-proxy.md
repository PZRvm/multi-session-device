---
description: SDK、镜像清单与镜像字节下载仍使用 Node fetch，代理可用但直连不可用时可能失败；本轮只修官方皮肤，其他路径另立任务
status: open
tags: [network, proxy, sdk, download]
---

# SDK 与镜像默认请求仍未接系统代理

> 开放项并入 [待修清单](../../task/2026-10-09-待修问题清单.md)；本文只存证据。

- **观察**：2026-10-09 排查 Nexus 5 皮肤获取失败，确认皮肤默认 Node fetch 绕过系统代理；`sdk.ts` 下载、`catalog.ts` 清单获取、`downloader.ts` openUrl 默认实现同样直接调用 Node fetch。
- **触发条件**：系统代理可以访问上游，但直连 DNS/连接不可用。皮肤已用隔离 Electron 的受控 DNS 对照证实这类失败；本轮没有实际下载 SDK 或镜像大包复现，不冒充这些入口已有完整现场证据。
- **建议方向**：独立任务核验 SDK bootstrap、清单与下载的默认网络执行器，统一遵循应用/系统代理并保留流式进度、取消、预算和完整性；不通过关 TLS 校验或硬编码本机代理地址绕开。
- **范围**：此轮只修官方皮肤请求，其他下载源码未改。见 [皮肤修复计划](../../../plans/2026-10-09-skin-download-system-proxy.md)。
