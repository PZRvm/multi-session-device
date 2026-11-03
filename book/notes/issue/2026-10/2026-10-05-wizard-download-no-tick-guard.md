---
description: DeviceWizard download() 跨 tick 无互斥守卫——下载按钮是 disabled 行内的 span，jsdom 与极端竞速可穿透，两次并发 download 互相覆盖进度状态
---

# 向导下载触发无跨 tick 互斥守卫

- **Observed**: 2026-10-05 清单加载反馈 review（plan 2026-10-05-wizard-catalog-loading）。`DeviceWizard.download()` 靠「下载中所有镜像行 disabled」实现互斥，但下载钮本体是 disabled `<button>` 行内的 `<span role="button">`：浏览器会抑制 disabled 按钮后代的指针事件，jsdom 不抑制（fireEvent 直接派发）；且 `downloading` state 在同 tick 连点下不刷新。两次并发 `download()` 会互相覆盖 `downloading` 进度并各拉一次清单。属 pre-existing（本轮改动前同构），创建路径已有 `creatingRef` 同步守卫，下载路径没有对等物。
- **Reproduction**: 单测里 `fireEvent.click` 连点未装镜像行的下载钮两次（不 flush），观察 `window.api.sdk.downloadImage` 被调两次；真实浏览器难触发（disabled 行抑制指针），jsdom/自动化路径可稳定复现。
- **Suggested direction**: 加 `downloadingRef` 同步守卫（口径同 `creatingRef`：ref 跨批处理立即可见，disabled 只是视觉层）。

严重级：P3（真实浏览器路径被行禁用挡住；自动化与竞速路径可穿透）。

## 跟进（2026-10-05）——已修

`download()` 加 `downloadingRef` 同步守卫（口径同 `creatingRef`：进入即置位、finally 复位），同 tick 连点与穿透行禁用的点击只放行第一次；回归测试「下载同 tick 原生连点只触发一次下载（ref 守卫）」在案。语义附注：进度 100% 先行清 `downloading` 状态、ref 等重拉完成才释放——该窗口内再点下载会被静默串行化，刷新行有「正在刷新系统镜像…」反馈在位。
