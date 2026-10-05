---
description: 下载进度修复（fix/download-progress-zero）的 Phase 5 code review 发现——写流错误未监听可致 main 崩溃（P1）、.install-bak 可被清单扫描误读（P2）、自生成 package.xml 元素顺序与官方 XSD 不一致（P2）；按纪律只记录不修复
tags: [review, downloader, stream-error, scan-local-images, package-xml]
---

# 下载直连修复 review 发现 — issue

- **背景**: fix/download-progress-zero（commit f7aad73）交付后的 Phase 5 code review。流程遗漏在案：实现会话从测试关卡直接跳到 book 收尾，本 review 为事后补做。以下发现按纪律**只记录，不顺手修**。

## P1：写流错误未监听，磁盘满等写错误会崩 main 进程

- **位置**: `src/main/emulator/downloader.ts` `downloadImageZip` 的 `for await` 循环（约 139-155 行）。
- **问题**: `output.on('error', ...)` 只在循环结束后的 end Promise 里挂。循环中途写失败（磁盘满/权限变化）时：`stream.write()` 不抛，错误异步发 'error' 事件——无监听即 uncaught exception，main 进程崩溃；且已出错的流上 `await once(output, 'drain')` 永不触发，背压路径会挂死。
- **建议方向**: 循环前 `output.on('error', ...)` 收集首个错误并让循环/等待路径感知（如 errored 标志 + 循环内检查、drain 等待改带超时或监听 error 竞争）；补一条磁盘满场景的单测。

## P2：`.install-bak` 备份目录在 system-images 层级内，可被清单扫描误读

- **位置**: `downloader.ts` `installImageZip`（backupDir 与 `scanLocalImages` 的目录遍历。
- **问题**: 落位前旧目录挪到 `<abi>.install-bak`，位置仍在 `system-images/<platform>/<tag>/` 下；`scanLocalImages` 三层 readdir 不过滤点前缀目录——备份目录内含 package.xml，解析出的 packageName 与正主相同。Map 按 packageName 去重时先入者胜（字母序 `arm64-v8a` 先于 `arm64-v8a.install-bak`，常规时序无害），但备份存在期间（安装中途/删备份失败的残留）被扫描，`verified` 取值存在不确定性；点前缀目录也不应出现在任何清单语义里。
- **建议方向**: `scanLocalImages` 各层 readdir 过滤 `.` 前缀条目（对 `.download-*.zip`/`.unzipping` 同样免疫）；或备份目录移出 system-images 树。

## P2：自生成 package.xml 的元素顺序与官方 repo XSD 的 sequence 不一致

- **位置**: `downloader.ts` `buildPackageXml`。
- **问题**: 生成顺序为 display-name → revision → type-details；官方 package.xml（及 repo XSD 的 xs:sequence）为 type-details → revision → display-name。本项目 catalog 的解析对顺序不敏感（实测自装包可被识别），但 avdmanager/Android Studio 等严格按 XSD 读该文件的第三方工具可能拒绝。
- **建议方向**: 生成顺序对齐官方（type-details 在前）；顺带补一个与真实 fixture 逐元素顺序比对的快照测试。

## P3（记录）：系统 unzip 的平台依赖

镜像解压与皮肤解 tar 都依赖系统命令，Windows 无解（本期边界为 macOS Apple Silicon，边界在案）。跨平台时需要换 node 流式解压库或带平台分支。

- **建议方向**: P1 单独修复轮处理（崩溃级）；P2 两条可在下一轮镜像相关改动时合并处理；P3 待跨平台立项。
