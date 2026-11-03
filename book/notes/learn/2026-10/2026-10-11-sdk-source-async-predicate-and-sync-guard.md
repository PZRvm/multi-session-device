---
description: SDK 来源切换实现批的三条踩坑——异步谓词被同步布尔守卫吞掉恒过、IPC 入口守卫做真实 fs 读扰动时序敏感用例、就绪门检查绑定了应用自有布局
tags: [TypeScript, Electron IPC, 测试稳定性, 异步陷阱]
---

# SDK 来源切换实现批——踩坑两条

**范围**：plan [2026-10-11-sdk-source-switching](../../../plans/2026-10-11-sdk-source-switching.md) 批 4/批 5（迁移引擎与切换编排），1046 项测试收口全绿。

## 异步谓词喂给同步布尔守卫：`!Promise` 恒为 false

`rewriteConfigPathPrefixes`（avd.ts）初版签名收同步谓词 `targetExists: (rel) => boolean`；引擎侧传的是 `(rel) => deps.pathExists(...)`——**async 函数，返回 Promise**。守卫 `if (!targetExists(rel)) return line` 对 Promise 取非恒为 false，于是「镜像不在目标根就保留原引用」的规则形同虚设：所有匹配前缀的 config 键一律改写。单测里因为谓词是 `Set.has`（同步）而全绿，集成路径才暴露——device2 引用一个新根不存在的镜像目录，仍被改写到新根，设备开机即断链。

教训：
- 纯函数收谓词时，类型写 `boolean | Promise<boolean>` 并在函数体内 `await`——同步调用方喂布尔照常工作，异步调用方不再有静默吞掉守卫的口子。
- 谓词双形态的用例两头都要测：本批补了「异步谓词 + 目标无同路径 → 保留」的断言才把坑钉死。
- 同类地雷：`Array.filter(asyncFn)`、`if (maybePromise)`——凡布尔位置的异步值都要显式 `await`。

## IPC 入口守卫做真实 fs 读：一跳异步毁掉时序敏感用例

批 5 给 `devicesCreate`/`devicesStart` 加「迁移在途拒绝」守卫，初版写成 `await hasPendingMigration(deps)`——每次调用真实 `readFile` 探测 journal 文件。功能正确，但 devices 域对账用例（P2-2）依赖「创建事务在一拍内落 creating 行」的节拍，多出的真实 fs await 在并行满载时把时序搅散：全量套件每次挂一个**不同**的用例（单跑全过、基线 stash 后全绿），连 maxWorkers 收敛也压不住——典型的负载相关假阳性，且方向具有欺骗性（像环境 flaky）。

修法：journal 只由本进程写（start/各步/收尾），把「journal 在场」做成**模块级内存标志**，save/clear 同步翻；boot 时 `restoreSdkSource` 按盘面校准一次（崩溃残留 journal 的恢复场景）。守卫变成同步零 await 的 `isMigrationActive()`，时序扰动根治（连跑两轮 1033+ 全绿）。评估入口（switchSource）仍走盘面真值 `loadMigrationJournal`——决策要真相，守卫要零成本，两个口径分开。

教训：
- 给既有 IPC 入口插守卫前，先看该入口的用例是否对 await 跳数敏感（setTimeout(0)/一拍断言是信号）。
- 「本进程独占写的状态」值得内存镜像 + boot 校准：守卫同步化，盘面只在决策点读。
- 全量偶发、单跑必过、每次受害者不同 → 先怀疑自己最近给热路径加的异步，而不是调 vitest 并行度。

## 就绪门绑定了实现布局：检查要盯「实际将用的资源」，不是布局标记

共享 Studio SDK 后向导第一步（sdk:profiles）必炸「SDK 尚未就绪（缺 cmdline-tools 或 JRE）」。根因：`requireSdkReady` 用 `detectSdk` 的 `jre.present` 判 Java——那个标记探测的是 `<root>/jre/Contents/Home/bin/java`，**我们 bootstrap 写进应用自有根的布局**；Studio SDK 根里从来不存在，共享模式的 Java 在 Studio 应用包（jbr）。执行链批 3 已用 `javaHomeFor` 接对了（avdmanager 跑在 JBR 上），就绪门却还盯旧布局标记——同一资源的「门」和「用」长在两处，改执行链时漏了门。

教训：
- 就绪/健康检查必须与执行路径**同源**：本次修法是把 `javaBinFor(root)`（managed/custom=内置 JRE；shared=JBR 缓存）做成单源，门 stat 它、执行链用它。布局标记（detectSdk 的 jre 字段）只描述「这个目录里有什么」，不描述「这次运行会用什么」。
- 错误文案要随模式换：共享态只读，「先完成 SDK 引导」不可执行——换成指路 Studio SDK Manager / 切换来源的词条。
- 重启进共享态还有个次生缺口：检测缓存为空则 JBR 解析不出——boot 恢复（restoreSdkSource）发现 source=shared 时自动补跑一次检测，失败不阻塞、由就绪门报可操作错误。
## 附：排查时 `rg -rn` 会把替换结果显示出来骗自己

排查 ImageTable 调用点时敲了 `rg -rn "<ImageTable"`——`-r n` 是「把匹配替换为 n 后显示」，输出里 `import n from './wizard/n'` 看起来像文件被灾难性损坏，差点按损坏去处理。rg 的 `-r` 只改显示不改文件；排查标识符引用用 `rg -n` 即可，见到「文件被替换」先 `git diff` 验证再行动。
