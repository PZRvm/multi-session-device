---
description: 镜像下载的显式取消——向导行内取消入口、AbortController 中断直连下载、临时文件与半解压目录清理、取消广播与互斥释放；依赖 manifest 直连线路先行
status: completed
created: 2026-10-06
---

# 镜像下载取消 — plan

> 实现记录（2026-10-06，feature/wizard-download-cancel，基 86114a7）：进度修复（依赖项）已在该基线实施完毕，本 plan 落取消全链路。`downloader.ts` 三阶段检查点（每 chunk / sha1 前 / 解压前后）+ `CancelledError` 分流；真机实证 fetch 层 signal 中断抛原生 `AbortError` 直达组合层——补双形态分流（`signal.aborted && error.name === 'AbortError'` 也按取消），单测 5 例覆盖五中断点。`extractZip` 默认实现由 `execFileSync`（阻塞 main 且不可中断）改异步 `execFile + signal`（取消即 kill unzip），解压被 kill 的错误按取消分流。main 侧任务对象挂 `abort/done`：`sdk:cancel-download-image`（向导窗守卫、幂等）abort 后 await 收尾才 resolve；下载 handler 按返回值广播 `canceled: true`（非 error，UI 无错误横幅）。UI：下载中行百分比旁「取消」钮，invoke resolve 即本地清状态，广播服务重开窗（activeDownload 恢复后的取消已测）。真机：android-35 镜像真实下载 6 秒中断——`canceled` 正常返回、进度 1→11% 连续、`.downloading.zip` 零残留。全套 296 测试过、typecheck/lint 0 错。遗留：断点续传（本期明确不做）；「关窗不取消」语义未动（回归在案）。
review 修复轮（2026-10-06，发现见 issue 2026-10-06-download-cancel-review）：P1-1 sha1 前取消检查点并入 try 清理域（该路径此前会残留 .downloading.zip，且旧用例恰好掩盖——补「流结束后 abort」用例钉住泄漏路径，断言未进 install 阶段）；P1-2 空态提示 `grid-column: 1/-1` 跨全列；P2-3 任务 done 改显式 deferred，resolve 时点由 finally 在互斥释放之后写死——「取消后立即重下」不再依赖微任务顺序；P2-4 部分收口——补 default extractZip 的真实 unzip 子进程 kill 单测（20MB 真包解压中 abort → CancelledError），完整三阶段真机取消仍待下次窗口；P3-5 删除 cancelClickedRef 死代码；P3-6 本段即修正。全套 300 测试过。

> 用户需求：正在下载中的 API 镜像要有「取消下载」状态；点击取消后，该次下载对应的文件需要被清理。本 plan 先分析后设计；**依赖 [下载进度修复 plan](2026-10-06-download-progress-zero.md) 的 manifest 直连下载线路**（分析见下——干净的可取消下载在该线路上才成立），建议两 plan 同批或先后紧接施工。关联 [emulator-wizard 主计划](2026-10-05-emulator-wizard.md) 设计 3/9 的既有语义：关闭向导**不取消**后台下载、重开可恢复——本 plan 新增的是用户**显式取消**，两者并存不冲突。

## 分析结论（实测证据，2026-10-06 本机）

**现状链路无可取消通道**：`runSdkManagerPackages` spawn `sdkmanager --install`，main 侧 `downloading: { packageName, percent }` 只是进度快照——没有进程句柄、没有中断机制；UI 侧下载按钮在下载中只显示百分比。

**sdkmanager 路线上做「取消 + 清理」是黑盒**（实测三层证据）：

1. 下载数据不落盘可观测位置：下载 1.9GB 镜像进行中，`<sdk>/.downloadIntermediates` 恒为空目录（多次采样），系统临时目录（`$TMPDIR`）无大文件——新版 sdkmanager 把下载数据留在 Java 进程内存，直到解压才写目标目录。
2. `kill -TERM` 能干净退出且无残留——但这是「碰巧」：当前版本没落盘才无垃圾；一旦版本行为改为流式落盘到未知路径，kill 就会留下不可控文件。
3. kill 落在解压阶段会留半安装目录（`system-images/<平台>/<tag>/<abi>/` 半截），这类残留路径虽可推导，但与内存缓冲期行为拼成两套清理逻辑，脆且不可测。

**直连线路（进度修复 plan 的 `downloader.ts`）天然可取消**：下载写入自管的 `.tmp` 文件（目标目录旁），中断用 `AbortController`，清理边界 = 删 `.tmp` + 回滚半解压目录（该 plan 已设计解压核验失败回滚，取消复用同一路径）。因此本 plan 的取消功能声明依赖先行，不在 sdkmanager 线路上做过渡实现。

## Requirements brief

- 作用域：向导镜像表格下载中条目的取消入口；main 侧取消通道、任务中断、文件清理、取消广播、互斥释放。
- 排除项：断点续传（取消后再下从 0 开始，与进度修复 plan 口径一致——manifest 支持 `accept-ranges` 但本期不启用）；批量取消/下载队列；关窗隐式取消（既有「关窗不取消、后台继续」语义保持不变）；皮肤下载取消（独立链路，规模小可顺延）。
- 边界：取消只在下载/解压/校验进行中有效；清理范围仅限本次任务的 `.tmp` 与半解压目录，不动已装包与其他目录；取消是幂等操作——任务已结束后的迟到取消不报错。

验收要求：下载中行内可见「取消」入口（与百分比同区域）；点击后任务中断、临时文件消失、互斥释放、该行回到「下载 x.x GB」初始态；取消后立即可重新发起同一包下载；取消不是错误——无红色错误横幅；重开的向导（activeDownload 恢复场景）收到取消广播后同样清状态；关窗后任务继续、重开恢复的既有行为不受影响。

## Impact range

| 文件 | 动作 |
| --- | --- |
| `src/shared/types.ts`、`src/shared/ipc-channels.ts` | `sdkCancelDownloadImage: 'sdk:cancel-download-image'` 通道；`SdkImageProgress` 加 `canceled?: true`（与 `error` 互斥——取消不是失败） |
| `src/main/emulator/downloader.ts`（进度修复 plan 新增） | 下载循环接受 `AbortSignal`；AbortError 分支清理 `.tmp`；解压阶段中断走既有回滚路径 |
| `src/main/emulator/index.ts` | `downloading` 任务对象挂 `AbortController`；取消 handler（向导窗 sender 守卫 + 包名匹配 + 幂等）；取消收尾广播 `canceled` 后释放互斥 |
| `src/renderer/src/components/wizard/ImageTable.tsx` | 下载中行加「取消」按钮（aria-label 带包显示名）；下载中禁用本行下载钮的现状保持 |
| `src/renderer/src/components/DeviceWizard.tsx`、`src/preload/api/sdk.ts` | `cancelDownloadImage(packageName)` 接线与注入接缝；进度订阅处理 `canceled`（清状态、无错误横幅） |
| `__tests__/`（emulator + wizard） | 中断/清理/幂等/广播/UI 用例 |
| `book/plans/2026-10-06-download-progress-zero.md` | 设计节补「取消接缝」注记（downloader 原生带 AbortSignal——两 plan 耦合点登记） |

风险：取消时点落在解压中——回滚目录删除失败（文件句柄占用）。处置：解压是我们自己进程的写入（非 sdkmanager），中断后句柄即关，实际占用概率极低；仍失败时延迟 1s 重试一次，再失败不吞——按创建事务回滚失败的既有口径上报「取消失败 + 残留路径」（用户可手动删，下次重下前 downloader 先清残留 `.tmp`/半目录再开工）；renderer 本地清状态与广播到达的时序（invoke resolve 即代表 main 已收尾，本地清为准、广播服务重开窗）；取消竞态窗口（取消收尾完成前再点下载被互斥拒绝）——文案按「已有任务进行中」统一。

## Design

1. **任务对象与取消通道**：`downloading` 升级为 `{ packageName, percent, abort: AbortController }`；`sdk:cancel-download-image` handler 流程——sender 守卫（向导窗）→ 无进行中任务或包名不匹配：幂等成功返回（迟到/重复点击不报错）→ 包名匹配：`abort.abort()` → downloader 循环感知信号抛 AbortError → 清理收尾（`.tmp` 删除、解压中则回滚半目录）→ 广播 `sdk:image-progress` `{ packageName, percent: 0, message: '已取消', canceled: true }` → `downloading = null` → handler resolve。**resolve 时点 = 收尾完成**，这是 renderer 本地清状态的依据。
2. **downloader 中断语义**（进度修复 plan 的修订注记）：流读取与写入循环每块检查 `signal.aborted`；fetch 本身挂 `signal`（连接层中断）；AbortError 单独 catch（与网络错误分流），清理后以「已取消」正常返回而非抛错——取消不是失败路径。解压阶段（zip 已下完）中断：删除 `.tmp` 与半解压目录，同「校验失败回滚」路径复用。
3. **UI**：ImageTable 下载中行——百分比按钮旁加「取消」文字钮（点击即触发，无确认框——取消可逆且不删已装内容，加确认是摩擦）；点击后立即 disable（防连击，口径同下载钮）直至状态清空。行状态回「下载 x.x GB」由 `downloading === null` 自然驱动。
4. **renderer 状态机**：进度订阅 `canceled === true` 分支——`setDownloading(null)`（仅当包名匹配当前显示的任务）、**不**写 `downloadError`；发起取消的一端以 invoke resolve 后本地清状态（不等广播），广播服务重开窗/迟到订阅者。
5. **互斥与重下**：取消收尾完成才释放互斥——竞态窗口内的新下载请求被既有互斥拒绝（文案「已有镜像任务进行中」）；释放后同包立即可重下，从头传输（无断点）。
6. **不做**：不提供取消历史/撤销；不动关窗语义（关窗 = 后台继续 + 重开恢复，实测口径已在进度修复 plan 落档）；不清理其他包或 SDK 组件。

## Build order

1. （前置）进度修复 plan 批次 1–2：manifest 透出 + `downloader.ts` 骨架——本 plan 施工前落地，或在同批实施中先做其下载/校验路径。
2. `downloader.ts` 接 AbortSignal + 取消清理路径 + 单测（下载中/解压中中断、AbortError 分流、`.tmp` 删除、半目录回滚、回滚失败报残留）。
3. 取消通道 + 任务对象 + 广播 + 幂等守卫 + 单测（无任务/包名不匹配/正常取消/竞态窗口）。
4. UI 取消按钮 + 订阅 canceled 分支 + 重开恢复场景测试 + 回归（完成/失败/恢复路径不动）。
5. 真机：下载 1.9GB 镜像中途取消（各阶段：5%、60%、解压中）→ 临时文件消失、行回下载态、立即重下成功；重开向导后取消广播清状态。Phase 5/6 book 同步（emulator-wizard 主 plan 语义注记补「显式取消」）。

## Test plan

- 单测（main）：AbortError 分流不进错误路径；`.tmp` 清理；解压中取消回滚；回滚失败残留上报；取消幂等；互斥释放后再下载同包。
- wizard 测试：取消按钮出现/点击/连点防抖；invoke resolve 后状态清空、行回下载态、无错误横幅；canceled 广播清重开恢复态；选中镜像不受取消影响（选择核验派生）。
- 回归：下载完成/失败广播、重开恢复（activeDownload）、下载中创建禁用、防连击全绿；typecheck/lint/prettier。
- 真机：三阶段取消各一次 + 立即重下；关窗后台继续 + 重开恢复 + 重开后取消的组合路径。

## Done criteria

- 三阶段（下载中/解压中/校验中）取消真机通过且无文件残留；取消后立即重下成功；取消语义与「关窗不取消」并存无冲突；取消广播对重开窗生效；既有下载域回归全绿；进度修复 plan 的取消接缝注记与主 plan 语义登记落位；book 同步完成。
