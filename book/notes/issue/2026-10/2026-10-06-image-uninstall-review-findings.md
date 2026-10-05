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
