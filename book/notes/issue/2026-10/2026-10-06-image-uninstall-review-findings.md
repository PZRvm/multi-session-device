---
description: 系统镜像删除功能 code review 发现——P1 卸载/下载互斥单向、P2 引用守卫 TOCTOU 与残留复核盲区，及 7 项 P3
tags: [wizard, uninstall, review, race-condition, mutex]
---

# 系统镜像删除 review 发现（2026-10-06）

对 `feature/image-uninstall`（merge-base 532f7da）的 Phase 5 式 review。守卫链纯函数化、四类拒绝路径测试、可信目录身份校验、残留不静默 rm 等设计合格；以下为发现。

## P1 — 卸载与下载互斥单向

- **问题**：`sdk:uninstall-image` 检查 `downloading` 拒绝卸载，但 `sdk:download-image` 不检查卸载状态——卸载执行期间（sdkmanager 数秒）可对其他镜像发起下载，同一 SDK 根出现两个 sdkmanager 写进程。
- **复现**：点删除 → 立即点另一镜像的下载钮。
- **影响**：不崩溃（两个独立子进程、各自 try/catch），但可能触发 sdkmanager 文件锁竞争，失败面是英文 stderr 或未定义交错。
- **建议**：对称互斥（`uninstalling` 状态 + download 侧检查），或合并单一「SDK 包操作互斥」。

## P2 — 引用守卫与卸载执行之间的 TOCTOU

- **问题**：`listDeviceNamesReferencing` 读内存后即返回；守卫通过到 `--uninstall` 完成的窗口内，主窗可 `createDevice` 用同一包（创建链路不知「正在卸载」）→ 设备建好、镜像随即消失。
- **建议**：创建事务按包名检查进行中的卸载/下载操作。

## P2 — 残留复核对非标准残留不敏感

- **问题**：卸载后复核用 `scanLocalImages`，只认「package.xml 可解析」的目录；sdkmanager exit 0 但留下无 package.xml 的残目录时判「无残留」，实际磁盘残留数 GB。真机冒烟只覆盖标准干净卸载。
- **建议**：复核改为直接探测 `system-images/<平台>/<tag>/<abi>` 目录存在性。

## P3 清单

1. 确认框「占用约 x GB」实为 manifest 下载体积（zip），解压后磁盘占用约 2 倍——措辞应为「下载体积约」。
2. `assertUninstallable` 返回 `{ sizeBytes }` 未被 handler 消费——死返回值。
3. `uninstallSdkManagerPackage` 只收集 stderr，sdkmanager 偶尔把错误写 stdout，失败详情可能为空（与基线 defaultRunner 同病）。
4. 删除/下载 icon 钮（role=button 的 span）无 tabIndex——键盘不可达（与既有 DownloadButton 同模式）。
5. `uninstallError` 渲染在「设备」标签底部，切到「附加设置」后失去视野（downloadError 同基线口径）。
6. emulator 域 import devices 域（引用查询）——域依赖方向反向，无环但可经回调注入解耦。
7. 卸载 spawn 无超时——sdkmanager 挂死则删除钮永久禁用直到重启。
8. `uninstall.test.ts` 可补 env（ANDROID_SDK_ROOT）断言。

## 跟进（2026-10-06，同日修复轮）

P1/P2 与全部 P3 已修（并发安全结论先行：下载+卸载并发不崩溃——两个独立 sdkmanager 子进程、各自 try/catch，最坏是文件锁竞争报英文 stderr，故按用户决定修复）：

- **P1/P2-TOCTOU**：新增 `emulator/packageOps.ts` 统一互斥（`beginPackageOp/endPackageOp/activePackageOp`），下载与卸载双向拒绝；创建事务按包名检查进行中操作（同包下载/卸载中拒绝创建），TOCTOU 窗口关闭。单测：守卫双向互斥 2 例、packageOps 状态机 1 例、devices 创建拦截 2 例。
- **P2-残留复核**：改为直接探测 `system-images/<平台>/<tag>/<abi>` 目录存在性；真机冒烟验证标准卸载判干净、人工构造的无 package.xml 空壳残留被捕获（旧实现漏）。
- **P3**：确认框措辞改「下载体积约…（解压后磁盘占用更大）」；`assertUninstallable` 改 void；卸载 executor 收集 stdout+stderr 并加 180s 有界超时（超时 SIGTERM + 中文错误）；删除/下载 icon 补 tabIndex + Enter/Space（Enter 触发卸载有单测）、DownloadButton 补 focus-visible；卸载/下载错误区挪到 TabBar 下方跨标签可见；`registerSdkIpc` 改依赖注入引用查询（emulator 域不再 import devices）；补 env 断言。

遗留两项已于同日收口（用户指示不等 test-infra-and-roving-focus 计划；该计划仍覆盖 ProfilePage 与全局焦点模式）：

- **roving tabindex 精修**：ImageTable 整表一个 Tab 停留点——焦点行 tabIndex 0、其余 -1，行内操作钮只在焦点行可 Tab；↑↓ 行间移动（未装行同样可聚焦，仅不可选），列表刷新时索引钳制。单测覆盖初始态/移动/钮随行翻转。实现注意：jsdom 无 `CSS.escape`，行定位用引号插值（包名受 splitPackageName 约束无引号字符）。
- **卸载超时对注入 runner 生效**：`uninstallSdkManagerPackage` 包装层 `Promise.race` + `timeoutMs` 依赖（默认 180s）；默认 runner 内部计时器仍负责 kill 真实子进程，超时赢时吃掉迟到拒绝避免 unhandled。单测：注入挂死 runner 40ms 超时拒绝。

## 补充（2026-10-06，用户实测反馈）

**卸载重开恢复缺失**：卸载中关闭向导再重开，卸载状态不渲染（main 仍在卸载）。与下载恢复（activeDownload）不对称——当时只做了下载侧。已补齐：`sdk:images` 返回新增 `activeUninstall` 快照（packageOps 实时合并，缓存命中同样生效），重开向导恢复该行 spinner、其余删除钮与下载钮互斥禁用；新增 `sdk:uninstall-state` 终态广播（完成/失败，发起窗口可能已关），重开窗口收到后清状态并重拉清单（失败展示 main 文案）。测试 2 例：恢复+完成解除+重拉、失败广播解除与文案。
