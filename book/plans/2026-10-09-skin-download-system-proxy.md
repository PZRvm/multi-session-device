---
description: 官方皮肤下载改用 Electron 网络栈遵循系统代理，保留固定源与完整性预算，并为网络失败和超时提供可操作提示
status: completed
created: 2026-10-09
---

# 官方皮肤获取遵循系统代理

## 需求与范围

用户在新增 Nexus 5 向导点击获取官方皮肤，收到 sdk:download-device-skin 的 TypeError: fetch failed。在已有 codex/fix-remaining-issues worktree 修复默认官方皮肤网络路径；保留原别名、白名单、固定上游、hash、缓存、预算和原子入库。不修改系统代理、不改镜像/SDK 下载、不修改用户 AVD 或已存皮肤。

## 分析与证据

系统配置了 HTTP/HTTPS/SOCKS 代理，Electron 默认 session 对官方来源解析为 PROXY 127.0.0.1:7890。现有 boundedFetch 调 Node global fetch，不遵循该系统代理。普通探针中两种请求当前均成功，不能据此认定截图发生时的底层 errno。

在隔离 Electron 39.8.10 / Node 22.22.1 进程中，仅让 Node 的官方域名 DNS 失败：原生产 downloadSkin('nexus_5') 报 fetch failed / ENOTFOUND；同一进程注入 Electron net.fetch 后生产获取链路成功，画面为 1080×1920，素材经过原 hash 与像素检查。此测试证实代理可用而直连不可用时的代码缺口，不把受控 errno 冒充用户原现场。

参考：[Electron net](https://www.electronjs.org/docs/latest/api/net/) 明确区分 Chromium 网络栈与 Node fetch，支持自动系统代理。

## 设计

- skinSource.ts 默认请求使用 net.fetch（应用 ready 后由既有 IPC 进入），沿用 30 秒 AbortSignal 与流式字节预算；公开源请求不带 session cookie。
- 连接失败显示官方域名、网络/系统代理重试建议和底层错误；连接阶段超时明确显示 30 秒。HTTP、空响应、体积/完整性错误保留原诊断，读取中断单独提示网络问题。不吞错、不绕开 TLS 校验，也不硬编码代理地址。
- skinSource.test.ts 运行默认生产路径，mock Electron net.fetch 并让 Node fetch 不可用，验证获取与缓存正常；覆盖连接失败/超时/HTTP/空内容/超限/读取中断及失败后重试，保留已有别名回归。
- 在相同直连 DNS 失败的隔离 Electron 中运行修改后的默认生产 downloadSkin，使用临时皮肤库验收，不给用户库预塞下载结果。

## 关卡

- [x] 默认网络路径回归先红后绿，网络失败提示和资源清理有证据。
- [x] 隔离 Electron 的真实 Nexus 5 获取与缓存通过。
- [x] 全量 test、lint、build/typecheck、改动文件格式检查通过。
- [x] 八项 review、stage/learn 和 book 索引回写。

## 实施与验收

默认下载已改 net.fetch，公开源不带 cookie，30 秒连接超时与网络断开提示保留底层错误或 cause。新增 7 个默认路径回归全部先在旧实现失败、修复后通过；包含直连不可用、缓存复用、网络/超时后重试、HTTP 403、空内容、超限与中途断开。

真实隔离 Electron 中保持 Node 对官方域名 DNS 不可用，不注入 fetchText，修改后的生产 downloadSkin('nexus_5') 成功：4 份素材、1080×1920、进度 100%、740ms；随后 downloadSkin('Nexus 5') 复用同一缓存。测试临时库已删除，未写用户数据。普通网络探针当前也成功，因此用户原次失败的 errno 仍未知；这里证实并修复系统代理网络下的默认路径缺口。

最终门禁：793 项通过、6 项既有跳过，无未处理异常/MaxListenersExceededWarning；npm run build（含 node/web typecheck）、npm run lint、改动文件格式和 book 索引/卫生检查通过。

八项 review 检查了重复代码、权限、竞态、事务、通知、边界、复杂度与范围：源码限 skinSource.ts 和对应测试，原 hash/白名单/像素预算/缓存互斥/原子入库未改，未发现本修复新增明确问题。另发现 SDK/镜像默认请求同型缺口，按纪律只记 [issue](../notes/issue/2026-10/2026-10-09-sdk-image-download-system-proxy.md)，不扩修。本轮 stage/learn 已回写，计划 completed；修改仍留在原 worktree，当前已打开应用需加载新主进程代码后重试。

2026-10-09 用户确认本轮验收完成；验收后代码审查未发现新增明确缺陷，相关回归与类型检查通过，见 [审查记录](../notes/task/2026-10-09-剩余缺口验收后代码审查.md)。
