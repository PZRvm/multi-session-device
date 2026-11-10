---
status: open
description: 对账功能 code review 记录——四切片并行审查：6 项 P2（skin symlink 绕过判定、事务半成品误报弹窗、loadError 无消费、v1 id 校验不对称等）与约 18 项 P3，全部只记录不修复
created: 2026-10-08
---

# 对账功能 code review（四切片并行审查）

基线：`feat/avd-reconciliation` 的 `a0a4691`（汇总条边距提交）。方法：按 review-checklist 八项，四个只读代理分切片审查（store 契约 / FS 核验 / devices 并发 / renderer+IPC），本人交叉核实 P2 级发现与代码实况相符。实现轮自查已记录的 3 项 P3（见 [implementation-review](2026-10-08-avd-reconciliation-implementation-review.md)）不重复。**本轮全部只记录，未修任何一条。**

严重度口径：P1=数据丢失/安全/主流程破坏；P2=特定条件可触发的状态破坏或设计不变量违背；P3=一致性/小问题/测试缺口。本轮无 P1。

## P2（6 项）

### P2-1 skin.path 的 symlink 逃逸可绕过判定，误报 valid

`reconcile.ts`（skin.path 边界块）：双重判定取 OR——`insideReal`（canonical 包含）|| `insideLexical`（词法包含）。目标**存在且是符号链接**、canonical 落在受控根外时，只要词法路径写在 SDK/skins 根内，`insideLexical=true` 即放行，状态可为 valid。设计 2 明文「受检 symlink 逃逸为 unsafe」。词法兜底只应服务「目标缺失（realpath 为 null）」分支。触发：config.ini 写 `skin.path=<sdkRoot>/skins/evil`，evil 为指向根外的 symlink。三个外指路径中唯独这条可绕过（ini.path 走 canonical 相等比对、sysdir 绝对分支走 realpath 包含）。按后果（诊断误判，本服务不读 skin 内容、无根外读取）记 P2；按设计不变量口径即 P1。

### P2-2 事务半成品被全量扫描当真实目标核验 → 误报「文件异常」+ 误弹汇总弹窗

`devices/index.ts` scanCurrent 以 `devices.map(toMeta)` 为扫描入参，**含 creating/deleting 行**；`transientIds` 只在孤立组扫描消费，per-device 核验照样跑在半成品文件上。代次捕获在事务开始 bump 之后即视为稳定，「开始 bump → 扫描 → 结束 bump」整段窗口内结果被采纳。触发：① 创建 A 进行中（AVD 未落盘）触发重查（手动点或删除 B 的收尾后台重查）→ A 被判 missing 写入行内 → 签名非空 → 弹「设备异常汇总」——设计 4 明文「creating 行显示 checking」；② 删除同理；③ create 失败回滚窗口（撤回内存行与结束 bump 之间隔着 `await deleteAvd`）→ 误报 orphan + 弹窗。`report.pendingIds` 即为此设计，但摘要/签名口径未用它。方向：per-device 检查对 transient id 保持 checking，报告/签名/摘要排除 transient 与 checking 态。

### P2-3 `loadError` 是死字段：list invoke 级失败仍显示普通「还没有设备」空库文案

`deviceStore.ts` 置 `loadError` 后全 renderer 无消费；`DeviceListPane` 空库分支只看 `storeState === 'error'`（invoke 级失败不经过 storeHealth，仍为 ok）。这是 plan 差距表点名要修的旧行为（「首次 list 失败只置 loaded，仍会显示普通空库」），本分支加了字段但没接 UI、也没有重试入口。方向：空库分支消费 loadError 并提供重试。

### P2-4 v1 条目 id 校验与 v2 不对称：非 UUID id 绕过重复检测，且「写入后自冻结」级联

`store.ts`：`isDeviceMetaLegacy` 接受任意字符串 id（空串也过），`collectEntries` 的重复检测只认 UUID——v1 两条相同非 UUID id 双双载入且 health=ok，违反「metas 只含合法且 id 唯一条目」的模块不变量。级联：v1 单条非 UUID id 正常载入后，首次 `writeDeviceMetas` 落成 v2，下次启动被 `firstInvalidV2Field` 以 `'id'` 拒收 → 整库 read-only、该行消失、其 AVD 成孤立组（id 非 UUID 也不进关联表）。缓解：v1 时代 id 均 `randomUUID()`，需手改文件触发——而手改文件正是本层防线对象。方向：v1 校验同样强制 UUID（或非 UUID 按 invalid-entry 口径进诊断）。

### P2-5 相对 image.sysdir.1 不做 canonical 校验：路径组件 symlink 不报 unsafe

`reconcile.ts`：相对 sysdir 分支只做 `hasEscapeSegments` 后直接核验；canonical 包含校验只在绝对分支。`<sdkRoot>/system-images` 被换成指向根外的 symlink 时，镜像实际从根外解析、归因可为 valid，与绝对分支行为不对称（设计 2「受检 symlink 逃逸为 unsafe」）。方向：相对分支同样 realpath 一次并 `isWithin`。

### P2-6 deleteAvd 的 containment 守卫零测试

`avd.ts` 新增的「删除绝不越界」守卫无任何回归锚（avd.test.ts 未动），拒绝分支重构后测试仍全绿。方向：补「合法 id 通过」+「构造越界形态抛『删除路径越界』」两例。

## P3（按切片归组）

**store/契约**
1. `isStoredAdvancedSettings` 放行 `webcam + deviceId: null`（归一化产不出的形状）：启动核验被跳过、argv 静默回落默认摄像头，零诊断；且 webcam 带 deviceId 缺省（undefined）反而被拒，不对称。
2. 未知顶层多余字段随载入进内存，`advancedSettings`/`screenSummary` 内嵌多余键经 toMeta 透传回写磁盘（与「不升级 schema」相悖；顶层键会被 commitMetas 投影剥掉）。
3. `sourceVersion` 语义：版本可辨但缺 devices 数组时报 null，口径不一致（当前无消费者）。
4. 【存量】写路径的 v1 备份 `copyFile` 失败被外层 catch 吞掉，备份承诺静默降级；`writeFile(tmp)` 失败裸抛无「临时文件保留」提示。
5. 【存量/设计边界】写路径无「文件未变」比对：运行中外部换成另一份合法 v2 后用户写入会静默覆盖外部修改——设计只覆盖重读时点检测，建议 rename 前在队列内快读比对。
6. 测试缺口：screenSummary 坏形状对象、snapshotReadyAt/createdAt 负数、v1 非 UUID id（P2-4 两场景）、写保护下写入不触碰备份；瑕疵：一处 writeStore 后冗余 writeFile、vi.waitFor 包裹必然成功的 chmod。

**reconcile/FS**
7. ini.path 相对分支的逃逸检测是死分支（`resolve` 已规范化 `..`），相对外指归因 broken 而非 unsafe，与绝对分支不对称（两态都禁启动，仅标签差异）。
8. EIO 等非权限读错误归因 broken 而非 inaccessible，与「权限/IO 错误分别归因」的需求不符（NFS/外置盘瞬时 EIO 场景）。
9. avdHome 根自身为 symlink → 归 inaccessible 而非设计的 unsafe；macOS `~/Library` 链接形态可能被全量冻结，合意性待确认。
10. 设计要求「共享镜像每轮只读一次/按路径去重」未实现：同镜像 N 台设备重复读 N 次（IO 放大，正确性无碍）。
11. 尺寸预检 TOCTOU（lstat 后 readFile 间文件可被换大）+ package.xml 无大小上限——最坏内存放大，只读语义不破坏。
12. 测试缺口：`symlinked-file` fault、`ini-too-large`、单目标 EACCES、扫描中途 abort、>4 设备并发上限、ini.path 相对 `..`（P3-7 若有测试早已暴露）、`avd-dir-escape`。

**devices/并发**
13. beforeStart 跨 3s await 持有旧 device 对象：期间 commitMetas 重建数组后，核验结果写到孤儿对象（availability 丢失更新，下轮全量扫描自愈）——写回前应重新 `devices.find`。
14. deleteFlow/创建收尾的 `checkDeviceHealth` 裸调无期限（beforeStart 与全量扫描都有）：FS 停摆时 deleteFlow 永不返回、deleteFlights 永久占位。
15. performReconcile 三次放弃后的合成报告：checkedAt 伪装刚检查、抹掉上一轮 orphans/deviceIssues，签名变化引发额外语义弹窗。方向：继承上轮结果并显式标注未完成。
16. `deepEqual` 的 undefined 值键 ≠ 缺失键：正确性依赖「normalize 不产出 undefined 值键」的跨模块隐式契约，回归即全库误冻结——补契约测试或视为缺失。
17. runtime 字段合并重建块三处近重复；rereadStore 首建分支当前不可达（防御性死代码）——抽 `rebuildDevices` 单源。
18. 测试缺口：扫描与事务交错（P2-2 三窗口）、beforeStart 代次守卫分支、放弃轮路径、runner 迟到失败/disposeAll 打断 beforeStart。

**renderer/IPC**
19. 弹窗前签名核对位于首个 await 之前（与闭包同 tick，恒等无效）：展示窗口内签名被替换时会先弹内容已过时的框、再对新签名弹第二个框。
20. seenSignatures 在核对/展示之前登记：dialog 失败或 pre-check bail 后该签名本会话永久静默，main 侧 pending 悬挂（与已记录「关窗重开重弹」同一流程的另一面）。
21. 异常「消失后原样复发」不重弹：main 的 acknowledgedSignature 只设不清、renderer seen 同样保留——按内容寻址去重是设计取舍，建议在 plan 写明。
22. read-only 时重命名静默 no-op 无反馈（双击/F2 直接 return），缺 plan 要求的「并说明原因」。
23. read-only 且可见行为空时空库文案与禁用的新建按钮自相矛盾（应提示条目异常而非「还没有设备」）。
24. 逐设备即时核验（创建收尾/删除失败）只写行内 availability 不重建 report/签名：上一轮异常被修正后汇总条可呈空文案常驻、详情陈旧。
25. CanvasPlaceholder 的重新检查按钮未传 rechecking，无忙碌态（main 单飞兜底，仅无反馈）。
26. report.revision 取 broadcast 递增前值，与随行 snapshot.revision 恒差 1（当前无消费者，契约含混）。

## 已过项与总评

八项 checklist 逐项：授权漏洞（sender 白名单/入参校验/无路径入参）、只读保证、超时计时器清理与迟到 rejection、并发池 cursor、主状态优先级、孤立组分类（transient 跳过/非 UUID 不泄路径）、properties 解析偏差方向（宽松，不误判官方配置）、revision 守卫、metaWritable 口径四处一致、stop/cancel 无条件保留、IPC 面收敛、测试断言强度（无削弱，多处较 dev 更强）——均通过。

总评：架构与防线布局符合设计，归因矩阵和只读语义扎实；需要跟进的核心是 P2-1/P2-2/P2-5（判定正确性）、P2-3（plan 承诺的 UI 行为没交付完整）与 P2-4/P2-6（校验对称性与守卫测试）。修复属下一轮任务，本记录不附带补丁。

## 修复轮处置（2026-10-08，用户指令）

同分支完成全部 6 项 P2 与 26 项 P3 的修复，全量 534 项通过（两连跑）、typecheck 0 错、lint/build 通过。逐项处置：

| 发现 | 处置 |
| --- | --- |
| P2-1 skin.path symlink 绕过 | canonical 存在时只认 canonical 包含；词法兜底仅限目标缺失分支 |
| P2-2 事务半成品误报 | 扫描入参排除 creating/deleting 行；deviceIssues/签名/摘要/affectedNames 全链排除 checking 态 |
| P2-3 loadError 死字段 | DeviceListPane 空库分支消费 loadError + 「重试加载」入口 |
| P2-4 v1 非 UUID id | isDeviceMetaLegacy 强制 UUID，重复检测自然覆盖，消除延迟冻结级联 |
| P2-5 相对 sysdir 无 canonical | 相对/绝对统一 realpath + isWithin；并以 canonical 路径做镜像缓存键 |
| P2-6 deleteAvd 守卫零测试 | 补两例（合法放行 + 怪形态 avdHome 不误拒/根外不受影响）；拒绝分支在白名单名下不可达，属纵深防御，测试内注明 |
| P3 webcam+null deviceId | isStoredAdvancedSettings 要求 webcam 带非空字符串 deviceId |
| P3 未知字段回写 | readDeviceStore 白名单投影（顶层+嵌套），v1 派生天然干净 |
| P3 sourceVersion 口径 | 版本可辨即如实上报 |
| P3 备份失败被吞 | 现存文件读失败/解析失败/备份复制失败一律中止写入拒绝盲覆盖 |
| P3 写前无 CAS | commitMetas 写前比对（文件态），不一致中止+冻结（devices 测试 mock 升级为文件态模拟） |
| P3 store 测试缺口/瑕疵 | 补 v1 非 UUID、坏形状、负数、投影往返、保护下无残留；清冗余 writeFile 与 waitFor 误用 |
| P3 ini.path 相对死分支 | 对原始声明先查逃逸段再 resolve |
| P3 EIO 归因 broken | ini/config 读失败一律 inaccessible |
| P3 根 symlink 归因 | 新增 'symlink' 根故障 → 全员 unsafe + scanError |
| P3 镜像未去重 | 扫描级 imageChecks 缓存按 canonical 路径每轮只读一次 |
| P3 package.xml 无界 | 读取前 lstat 量尺寸 + 读后长度复核（256KiB 上限） |
| P3 beforeStart 旧引用 | 写回前 devices.find 重取对象 |
| P3 裸调无期限 | deleteFlow 收尾与创建收尾核验套 withDeadline |
| P3 放弃轮报告误导 | 保留上一轮结果与 checkedAt，只叠加「未完成」说明；scanError 移出签名不重弹 |
| P3 deepEqual undefined 键 | undefined 值键视为缺失 |
| P3 重建块三处重复 | 收敛 rebuildDevices 单源；rereadStore 首建分支注明防御性 |
| P3 report.revision 恒差 1 | syncReportRevision 对齐发布代次（含逐设备核验路径） |
| P3 弹窗时序（pre-check 无效） | 拉取详情后再核对签名，过时异常不展示 |
| P3 seen 先登记 | 成功展示后才登记；失败/中止不压制后续重试 |
| P3 复发不重弹 | main 侧签名清零时复位 acknowledged，renderer 清 seen——同内容复发重新提示 |
| P3 重命名静默 no-op | DeviceRow onRenameBlocked → 原生弹窗说明原因 |
| P3 read-only 空库矛盾 | 空库文案三分支（loadError/store error/read-only 条目异常） |
| P3 逐设备核验不刷报告 | refreshReportFromDevices 同步 deviceIssues/签名/摘要 |
| P3 重查钮无忙碌态 | CanvasPlaceholder 透传 rechecking 禁用 |
| P3 测试缺口 | 补：skin/sysdir symlink、相对 ..、根 symlink、镜像去重、symlinked-file、ini-too-large、package.xml 超限、EACCES、中途 abort、transient 排除、放弃轮、CAS、ack 复位、beforeStart 重取、disposeAll 打断 beforeStart、DeviceRow/ListPane/Placeholder 用例 |

计划内已知不修（维持原案）：TOCTOU 尺寸预检与读之间的换大窗口已用读后复核收窄到字节级；review 轮 3 项既有自查 P3 中「重查放弃的增量合并」随放弃轮重构缓解（保留上一轮结果），「root 环境 EACCES 降级」维持条件断言口径，「弹窗前关窗重弹一次」随 seen 后置修复消除一侧（关窗重开仍按设计重弹未确认异常）。

> 维持原案与缓解残余已并入 [待修问题清单](../../task/2026-10-09-待修问题清单.md)的决策项分组。
