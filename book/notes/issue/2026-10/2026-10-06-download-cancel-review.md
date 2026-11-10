---
status: open
description: 下载取消分支 code review 发现——P1 两项（sha1 前取消检查点绕过清理域致 tmp 残留、空态提示被挤入第一轨）、P2 两项（互斥释放时序窗、解压取消真机缺口）、P3 两项（死代码、记录表述过强）
tags: [code-review, download, cancel, grid, downloader]
---

# 下载取消分支 review 发现（feature/wizard-download-cancel，基 86114a7）

> Phase 5 纪律：只记录不修复。review 范围 = 取消功能两 commit（60d5fd3 / 900f963）+ 样式两轮（247cdb2 已被 900f963 重做）+ book 收尾。

## P1（实际缺陷）

1. **sha1 前取消检查点绕过清理域**（`downloader.ts` `downloadImageZip`）：`throwIfCancelled()` 位于 try/catch **之后**——下载流完成、sha1 校验开始前这条取消路径抛 `CancelledError` 时不经过 catch 的 `removePath`，`.downloading.zip` 残留。单测「校验阶段取消」的注入点在 `sha1Of` 内部，实际触发的是 `installImageZip` 的检查点（其 finally 兜住清理），恰好掩盖了本条泄漏路径——测试通过 ≠ 路径正确。修法方向：检查点并入 try 尾，或 catch 清理覆盖全函数体。
2. **空态提示被挤入第一轨**（`ImageTable.tsx`）：Scroller 改单 grid 容器后，`EmptyHint` 成为普通 grid item，自动放置进第一轨（约 200px 宽）——「当前筛选下没有镜像」在 API 列宽内换行而非全宽。jsdom 无 CSS 解析测不出。修法方向：`grid-column: 1 / -1`。

## P2（时序与验收缺口）

3. **取消互斥释放的时序窗**（`index.ts`）：cancel handler `await task.done`（downloadImagePackage 的 promise）settle 即返回，而互斥释放（`downloading = null`）在下载 handler 的 finally——两者之间隔微任务间隙。窗口内的新下载请求会收到「已有镜像在下载」误拒（「取消后立即重下」链路）。IPC 往返毫秒级 vs 微任务微秒级，实际撞窗概率极低，但逻辑存在。修法方向：cancel handler 轮询/等待 `downloading === null`，或下载 handler 在分流 canceled 前先释放。
4. **解压阶段取消未真机验证**：signal kill 系统 unzip 只有单测注入覆盖（注入抛 CancelledError 模拟）；plan Done criteria 写「三阶段取消真机通过」，实际只真机验证了下载阶段（6 秒中断）。全量下载 1.7GB 后取消成本高，偏差可接受但记录在案——下次真机窗口顺带补（下载大镜像后、解压瞬间点取消）。

## P3（代码卫生）

5. **`cancelClickedRef` 死代码**（`DeviceWizard.tsx`）：只赋值无消费方（「防双清」意图从未落地——恢复 effect 的 `lastActiveDownload` 消费机制已自带一次性语义），且声明位置在使用之后。删除即可。
6. **plan 实现记录表述过强**：称「三阶段检查点」——sha1 前检查点存在但其清理不完整（见 P1-1），「检查点」不等于「检查点安全」。

## 复核确认无问题项

- `index.d.ts` 为 `typeof Api` 推导，preload 新方法类型自动同步，无需手动登记。
- 取消通道幂等（无任务/包名不匹配直接成功）与真失败并存的竞态：`await task.done.catch(() => undefined)` 吞的是已广播的错误，链路自洽。
- subgrid 表头 sticky、`color-mix` 进度填充、收窄后「100%」文本宽度均在 Electron 39 支持范围内。

## 跟进（2026-10-06 修复轮）

P1-1/P1-2/P2-3/P3-5/P3-6 已修（plan 实现记录「review 修复轮」段）；P2-4 补真实 unzip kill 单测部分收口，完整三阶段真机取消仍开放——下次真机窗口顺带验证（下载完整镜像后在解压瞬间点取消）。本 issue 保留为 review 历史与 P2-4 待办。

> P2-4 待办已并入 [待修问题清单](../../task/2026-10-09-待修问题清单.md)。
