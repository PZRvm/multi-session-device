---
description: Windows 真机验收连爆三处 darwin 路径硬编码（sdkMigration adb 探测、profiles avdmanager 链、javaBinFor/javaHomeFor）——同一根因：P1 平台化只改了 sdkPaths 单源及其直接消费方，自行 join 布局的"第二路径真源"全数漏网；两判定源口径分叉会让 UI 逻辑死锁
created: 2026-10-30
tags: [windows, path, sdk, acceptance, single-source]
---

# darwin 路径真源的重复实现——真机验收三连爆与「双判定源死锁」症状

## 经过（2026-10-30 Windows 真机验收）

SDK 引导在 Windows 上真实跑通后（下载/校验/解压/装包全链成功），向导却陷入死循环：`sdk:profiles` 恒报「SDK 尚未就绪」，而「完成 SDK 引导」按钮永远不出现。根因不在引导链——`javaBinFor` 写死 `jre/Contents/Home/bin/java`（darwin 布局），Windows 的真实产物是 `jre/bin/java.exe`，就绪门 `requireSdkReady` 恒假阴性。

## 模式：三个漏网站点，同一根因

P1 平台化把路径收敛到 `sdkPaths(root, platform)` 单源，但只改造了它的**直接**消费方。凡是绕过单源、自己 `join` 出平台布局的函数都是漏网站点：

1. `sdkMigration.ts:296` 的 adb 探测（P2 期已记 issue，未修）
2. `profiles.ts` 的 avdmanager 三连（路径无 `.bat`、JRE 布局 darwin 写死、裸 spawn `.bat`）——合并集成 review P2-1 抓到
3. `sdkSource.ts` 的 `javaHomeFor`/`javaBinFor`——真机验收才爆出来

共同点：单测在 mac 上全绿（darwin 字面量断言钉得越死越测不出）、code review 靠走读难以穷尽调用点、只有真机跑通主链路后才现形。

## 症状特征：双判定源死锁

值得记住的不是缺陷本身，而是它的**呈现方式**：同一份 SDK 状态有两个判定源时（此处 `detectSdk` 快照走 sdkPaths＝正确的 win 口径，`requireSdkReady` 走 javaBinFor＝错误的 darwin 口径），消费两个源的 UI 会互相矛盾——探测说「缺件」→ 出引导按钮，就绪门说「缺件」→ 恒报错；探测说「齐了」→ 按钮消失。本例恰逢引导已成功（快照说齐了），按钮消失＋恒报未就绪＝死循环，且主进程控制台**没有任何 `sdk:status` 报错**（探测成功返回了），极易误判为「按钮逻辑没触发」。遇到「某个入口该出现却不出现」的死锁，先排查两个判定源是否口径一致，再查事件链。

## 修法与防再发

- `javaHomeFor`/`javaBinFor` 改走 `sdkPaths(root, platform).jreHome` 与 `basename(…javaBin)`，加可选 `platform` 参数做接缝（缺省 `process.platform`，P1 既有模式）；shared 模式的 Studio JBR 分支不动。
- darwin 逐字节不变的构造性保证：`sdkPaths(root, 'darwin')` 的输出就是原硬编码串。
- 剩余风险面：还有没有第四个自行 join 布局的站点，只能靠真机主链路逐段踩实或全局 grep `'Contents'`/`bin', 'java'` 盘查；新写路径逻辑一律从 `sdkPaths` 取，不再手拼。
