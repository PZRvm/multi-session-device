---
description: MessagePortMain 经 contextBridge 回传后 port 对象可达但不投递消息——视频包通道退回 webContents.send（每帧拷贝），产品化时可再评估
---

# MessagePort 跨 contextBridge 不投递数据

- **Observed**: 2026-10-04 PoC（Electron 39，sandbox: true + contextIsolation）。main 用 `MessageChannelMain` 建通道，`webContents.postMessage(channel, null, [port2])` 回传 renderer：preload 侧 `ipcRenderer.on` 能收到 `event.ports[0]` 并经 contextBridge 回调把 port 对象交到主世界（对象存在、可设 onmessage 不报错），但 main 侧 `port1.postMessage(packet)` 的数据**永远不到达** renderer。同数据改走 `webContents.send`（结构化克隆拷贝）立即正常。
- **Reproduction**: PoC harness 中将 `sender.send(channel, packet)` 换回 MessageChannel 方案即可复现（renderer 侧计数为 0，main 侧转发计数正常增长）。
- **Suggested direction**: 产品化（stage 04 步骤 5）时先按 `webContents.send` 交付（8Mbps 码率下每帧拷贝成本可接受，PoC 实测 59fps 无碍）；若要零拷贝 MessagePort，需在非 sandbox preload 或独立窗口加载器上重验，或查 Electron 版本更新说明。不建议在 PoC/一期内自行绕。

严重级：P3（有可用替代；影响面仅为潜在优化）。
