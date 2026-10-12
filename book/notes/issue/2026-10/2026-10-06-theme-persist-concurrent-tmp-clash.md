---
description: theme.json 落盘的 tmp 文件名固定，两次快速切换的 persist 交错会互相覆盖 tmp——假失败日志且写入顺序无保证
status: resolved
---

> 2026-10-12 核销（fix/issue-audit 批）：theme store 已用 writeQueue 落盘串行队列（store.ts 注释直接引用本 issue）。
# theme 持久化并发写共享 tmp 路径

- **Observed**: 2026-10-06 主题持久化 plan Phase 5 review 发现：`persistThemeState`（src/main/theme/store.ts）用固定路径 `theme.json.tmp` 做 tmp+rename 原子写。两次快速主题切换（如毫秒级连点）的落盘交错时——writeFile(A) → writeFile(B) → rename(A) → rename(B)——B 的写入会覆盖 A 尚未 rename 的 tmp：rename(A) 实际落盘 B 的内容，rename(B) 对已消失的 tmp 报 ENOENT → renderer 记一条假的「落盘亮暗模式失败」，而磁盘上已是最新值。最终值通常碰巧正确，但写入顺序无保证、错误信号失真。
- **Reproduction**: 窗口期约等于一次 writeFile+rename 的耗时（毫秒级），理论竞态，难以稳定手工复现；单测里两个 persist 并发 await 即可构造。
- **Suggested direction**: 仿 devices 域 writeQueue 先例（2026-10-05 device-store-issue-batch）串行化提交；或 tmp 名带序号/随机段避开共享。devices 域同构问题已修，theme 落盘量级更小，跟随同一模式即可。

严重级：P3（触发窗口毫秒级、后果只是一条多余错误日志与顺序无保证；修法小而清晰，不顺手修）。

## 跟进（2026-10-06）——已修

同日按建议方向收口：`persistThemeState` 改为 `writeQueue` promise 链串行提交（载荷在调用时快照，单次失败不断队列）——仿 devices 域 2026-10-05 的同构修法。测试在案：「并发 persist 串行执行：上一次 rename 先于下一次 writeFile」「单次 persist 失败不断队列」（src/main/theme/**tests**/store.test.ts）。
