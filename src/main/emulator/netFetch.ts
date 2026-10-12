import { net } from 'electron'

/**
 * 主进程网络出口单源（issue 2026-10-09-sdk-image-download-system-proxy 处置）：
 * Node 原生 fetch 不读系统代理也不读 HTTPS_PROXY——代理可用直连不通的网络里，
 * SDK 引导两包 / 镜像 manifest / 镜像 zip 全部失败。Electron net.fetch 走
 * Chromium 网络栈，自动吃系统代理（含 PAC/例外表），流式 response.body 兼容。
 * 仅可在 app ready 后调用——三处消费点都是用户触发的下载路径，天然满足。
 * 独立小模块：纯函数模块（sdk/catalog/downloader）只引它，测试各自 vi.mock。
 */
export const netFetch: typeof fetch = (input, init) => net.fetch(input, init)
