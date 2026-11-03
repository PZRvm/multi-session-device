---
description: 一期收尾三功能（APK 拖拽安装/截屏/日志面板）合并 dev 复核 review——4 项 P2、7 项 P3；同日修复批全量处置
created: 2026-10-10
status: resolved
---

# 一期收尾三功能合并 dev 复核 review

基线：dev 的 `247eca0`（范围 `4052596..dev`，src 约 +4733 行）。方法：三个只读代理分域深审（apkInstall / screenshot / logcat），本人亲验全部 P2 证据与集成面（ipc 接线、streamShutdown 收口、主窗关闭链）。本轮只记录，未修任何一条。

严重度口径：P1=数据丢失/安全/主流程破坏；P2=特定条件可触发的状态破坏或核心交互失效；P3=一致性/小问题/测试缺口。无 P0/P1。门禁实测：typecheck 通过，vitest 952 项全过（6 项真机 smoke 按设计 skip）。

## P2（4 项）

### P2-1 dock 拉宽用外框宽对比内容宽需求，Windows 下点入口死端

`window/logcat.ts:207-211`（:147、:155 同型比较）用 `getBounds().width`——**外框**尺寸——对比 renderer 报来的 minWidth；而 `dockNeedWidth`（`App.tsx:271`）与 `logDockFits`（:267，用 `window.innerWidth`）都是**内容宽**口径。Windows（build:win 目标平台）外框帧差约 14-16px：拉宽到外框=need 后内容宽=need−delta 仍不足 → dock 不渲染 → effect 发 `expanded:false` 解锁。再点入口时 `bounds.width == minWidth` 不满足 `<`，不再拉宽——死循环：窗口变宽了但日志栏不出现，再点无反应，只能手动拖宽。macOS 1x 帧差≈0、`>=` 恰好成立，七轮真机验收未暴露；`App.logcat.test.tsx:41-46` 的 mock 把视口拉到精确 minWidth，等于假设 delta=0。方向：主进程改用 `getContentBounds()`（或补帧差），renderer fit 判断留容差。

### P2-2 handlePopOutLogcat 失败静默，openWindow 错误详情被丢弃

`App.tsx:313-317` 只有 `if (result.ok) setLogDockOpen(false)`，无 else。openLogcatWindow 的失败路径（`window/logcat.ts`：15s `wizardLoadTimeout`、`did-fail-load`、`render-process-gone`，均带 detail）到这里无任何 UI 反馈，dock 留在原地。同文件 `handleToggleLogDock`（:298-311）同类路径走 `requestWindow` 弹原生 dialog；本域 review 轮刚把 spawn 失败做响（16bec5d），这条对称路径仍静默，三语文案 `openLogcatWindowFailed` 齐备不可达。方向：复用 `requestWindow` 通路，成功后再收 dock。

### P2-3 跨设备同名保存共享 .part 临时路径，rename 静默覆盖可丢文件/串图

保存基名=净化设备名+秒级时间戳（`screenshot/index.ts:122-123`），`.part` 与最终名一一对应（:229-234）；`saves` 互斥按设备 id（:142-143），跨设备不互斥；而设备名不唯一——`devices/index.ts:1562-1574` renameDevice 只查 busy/editFlights/metaWritable。两台同名设备同秒截屏、两个 save 都在对方 `writeFile→rename` 完成前做完 `resolveFileName`（:126-136 用 `access` 探测）时：① 共享同一 `.part` 交错写入，A 的 rename 可能搬走 B 刚写的内容——A 落盘实为 B 的截图且报成功、B 报失败（POSIX rename 目标存在即静默替换）；② 先后 rename 同一目标，后写覆盖先写，双双报成功只剩一个文件。此前两轮 review 按「人工难触发」挂 P3，本轮复核：后果是静默数据损坏，记 P2。方向：`.part` 加进程内唯一后缀，最终落盘改 `flag:'wx'` 失败回 `resolveFileName` 递增，或 save 全局单飞。

### P2-4 切设备重挂载后在途安装结果丢失：busy 误呈失败卡，真实结局失联

安装状态机全在 hook 内存态（`useApkInstall.ts:40-54`），`App.tsx:401-406` 以 `id:runId` 为 key、仅 running 挂载 DeviceCanvas，切换选中设备即卸载。已修的「busy 呈失败卡」（上轮 P2）只堵住同一画布会话：装 A（installing）→ 切 B（hook 卸载，在途结果因 `mountedRef` 为 false 被丢弃，`useApkInstall.ts:76`）→ 切回 A（全新 hook，idle）→ 再拖 → main 抛 `apkInstallBusy`（`apkInstall/index.ts:63`）→ 渲染成红色 X 卡（:82）；原安装真正完成时无任何反馈（新 hook 不持有该 promise）。多设备主工作流（装着 A 的包切去看 B）可复现。方向：busy 类错误识别后走提示而非失败卡（main 错误码化或前缀判别），或模块级 deviceId→in-flight 映射让重挂载恢复 installing 态。

## P3（按域归组）

**APK 安装**

1. busyNote 不随安装结束清理：`flashBusyNote` 武装 4 秒定时器（`useApkInstall.ts:89-95`），`startInstall` 4 秒内完成（小包常态）时终态分支（:77-84）不清 busyNote，`InstallDropOverlay.tsx:49` 对 installed/failed 一视同仁渲染——「✓ 已安装 xxx.apk ＋ 正在安装上一个 APK」同屏最长 4 秒。方向：终态分支 `clearTimeout` + `setBusyNote(false)`。
2. `.apk` 后缀校验只在 renderer：`\.apk$/i` 仅 `useApkInstall.ts:26` 一层；main 侧 `isInstallInput` 只验非空字符串，filePath 原样交给 adb（`apkInstall/index.ts:48-54、61-77`）——renderer 回归或 devtools 调 preload API 时主进程会对任意路径发起 install。方向：main 入口补同款后缀断言。
3. 安装中停止/切换设备，结局对所有路径静默：P2-4 同根源变体，无需「切回再拖」——装着包按停止，canvas 立即卸载、结果被 :76 丢弃；main 互斥靠 finally 释放无泄漏，但 adb install 跑完后成败均无卡片。方向：经 `devicesRuntimeError` 式通道补终态广播，或在 plan 风险表补记取舍。

**截屏**

4. 迟到回填微窗口残留且无清理路径：`runningDevice(id)` 复核（`screenshot/index.ts:196`，含 await）与 `cache.set`（:206）之间，stopped 钩子（`ipc/index.ts:84-86`）仍可先清缓存并被回填——窗口从整个 screencap 时长收窄到微任务级，未消除；回填后设备已 stopped 不再有事件，删除设备路径也无 `clearScreenshotCache`（全仓仅 ipc/index.ts:85、90），该 1-3MB 条目滞留至进程退出。方向：复核改同步读取（`runningDeviceRef` 已可复用），或 stop 钩子带代次号让迟到回填自判无效。

**日志面板**

5. 三个 IPC handler 对 null 载荷裸解构抛 TypeError：`logcat/index.ts:276`、:283、:290-291——raw 为 null 时抛裸 `Cannot destructure property ... of null`，未走 `logcatInvalidPayloadSuffix`；同批 `window/logcat.ts:167、197` 用 `(raw ?? {})`，口径不一。方向：三处补 `?? {}` 对齐。
6. `ack` 裸 `void` 无 catch：`useLogcatFeed.ts:49`；同文件 :80 的 unsubscribe 是 `.catch(() => undefined)`。ack 的 main handler 载荷非法时 reject，异常路径下每个 flush 周期一条 unhandled rejection。方向：补 `.catch(() => undefined)`。
7. 视图裁剪永不裁 gap 标记：`useLogcatFeed.ts:68-72` 对 `kind === 'gap'` 无条件保留；每个 dropped>0 批次与每次暂停恢复各产生一个 gap 且永不回收，数小时洪泛会话可堆积成百上千个「已省略 N 行」节点。方向：裁剪时把丢弃段的 gap 一并裁掉或相邻合并计数。

## 已过项

- 互斥对称性：capture/save/install 各按设备互斥，走 adb 不同命令通道可并发；apkInstall 的 `serialOf→has→add→run` 全同步无 TOCTOU，异常路径 `finally` 全覆盖。
- 会话生命周期与换代裁决：stop/崩溃/取消启动/删除/quit 全覆盖销毁；`destroySessionOf` 按会话对象身份裁决，旧进程迟到 exit 不误杀新会话，有单测。
- 流控：丢最旧保最新算式正确、seq 单调无回绕、ring 5000/backlog 2000/视图 5000/单行 4000 字符各层有界；剪贴板写入先于 invoke resolve，反馈真实。
- 安全：新通道 sender 守卫正确（logcat 窗共用 preload 被拦、main-only 通道报对通道名）；文件名清洗无路径穿越；spawn 数组传参无注入面；`?device=` 经 `encodeURIComponent`。
- 窗口管理其余项：独立窗单例代次守卫、贴回先广播后关窗、minWidth 声明式跟随在主窗重开场景自洽、程序化 setSize 不触发 will-resize、`Math.round` 防分数尺寸。
- i18n：三功能新增词条 zh-CN/zh-TW/en 齐全、占位符一致。
- 集成面：`ipc/index.ts` 三域注入一致无反向依赖；`streamShutdown` 与设备桥三钩子对投屏/日志/截屏缓存收口完整；主窗关闭链 wizard→settings→logcat 齐全。
- 既有 issue 修复核验：apk busy 不可达、devices 测试 mock 泄漏、logcat 钳制钩子按窗 id 重挂、spawn 失败订阅报错、P3 备忘三项、screenshot 两轮 P3×10——均修彻底。

## 测试盲区

- `window/logcat.ts` 是唯一无测试的主进程窗口模块（wizard/settings 都有）：单例代次、贴回守卫、dockState 校验、钳制钩子重挂全无覆盖。
- `App.logcat.test.tsx` 的 `setDockState` mock 假设外框=内容宽（P2-1 因此未被捕获）。
- 主进程 logcat 测试缺：ring 5000 裁剪、纯 dropped 空批、unsubscribe 真实移除订户、重复订阅幂等分支。
- `useApkInstall` 测试缺：「安装先完成、busyNote 还挂着」（P3-1）与「切设备重挂载」（P2-4）。

## 总评

优先级建议：P2-1 先修（Windows 必现死端，现有测试结构无法捕获）；P2-2 一行改动量。

## 修复轮处置 — 2026-10-10（用户指令）

同日完成全部 4 项 P2 与 7 项 P3 的修复，typecheck 0 错、vitest 975 项通过（6 项真机 smoke 按设计 skip，较修复前 +23）、lint 剩余 1 error 为基线存量（见下）。逐项处置：

| 发现 | 处置 |
| --- | --- |
| P2-1 外框/内容宽错位 | 比较与拉宽全程内容坐标：`getContentBounds()`/`setContentSize()`；will-resize 的 newBounds 按帧差折算。新建 `src/main/window/__tests__/logcat.test.ts`（该模块此前零覆盖），含帧差 14 复现旧口径放行、主窗重开重挂、ready 解锁等 8 用例 |
| P2-2 弹出失败静默 | `requestWindow` 改返回成功布尔；`handlePopOutLogcat` 走该通路，失败弹原生 dialog，成功才收 dock。App 测试补「失败弹 openLogcatWindowFailed 且 dock 保持」用例 |
| P2-3 跨设备同名 .part 冲突 | 临时名带 `pid+自增` 序号隔离并发写；终名 `link` 原子占位（已存在报 EEXIST 而非 rename 静默覆盖），撞名换 `-2/-3` 递增重试（上限 10）。测试：一次性 EEXIST 重试 + 同名同秒双设备并发保存各归各 |
| P2-4 重挂载 busy 误呈失败卡 | 安装态提升为 `useApkInstall` 模块级单源 store + listener：重挂载恢复 installing 并接住卸载期间完成的结局（终态保留至 auto-clear 窗口，超窗清除）；busy 语义随之真正不可达 |
| P3-1 busyNote 残留 | listener 终态分支统一 `clearTimeout + setBusyNote(false)`——先完成后提示不再同屏 |
| P3-2 main 无后缀校验 | install 入口补 `\.apk$/i` 断言，复用 `apkInstallNotApk` 词条（detail 带路径）；测试补拒绝与大写 .APK 放行 |
| P3-3 停止后结局静默 | 随 P2-4 的模块单源缓解：停止→重启（或停止→切走→切回）的新画布恢复在途态并展示结局。残余：停止后不再重启且安装失败仍无 UI（无画布可承载），接受并在本行记录 |
| P3-4 迟到回填微窗口 | devices 域新增同步 `isRunningDevice(id)`（不 ensureLoaded），尾段复核改同步读——与 `cache.set` 零异步间隙，停止钩子无法插入；原有微窗口用例改走同步 mock |
| P3-5 null 载荷裸解构 | subscribe/unsubscribe/ack 三处补 `(raw ?? {})`，与 window 域口径对齐；测试补 null/undefined 载荷报受控错误 |
| P3-6 ack 裸 void | 补 `.catch(() => undefined)`；新建 `useLogcatFeed.test.tsx` 覆盖（ack reject 后续批次照常消费） |
| P3-7 gap 无限累积 | 裁剪改为「丢弃段内 gap 一并裁 + 相邻 gap 合并计数（null 保持 null）」；测试覆盖丢弃段裁 gap、g5+g8 合并、断点标记合并保持 null |

测试盲区四条同步补齐：window/logcat.ts 新测试文件、App mock 的 delta=0 假设随 P2-1 用例打破（真实现改内容坐标后该假设不再成立也无害）、useLogcatFeed 新建测试文件、useApkInstall 补重挂载与 busyNote 组合用例（另发现同一 act 内连点两次 togglePaused 会读过期 paused——测试写法问题，非产品缺陷）。

**顺带发现**：`npm run lint` 在 dev 基线（247eca0）即有 1 error——`App.tsx` dock 跟随设备的 `useEffect` 内直接 setState 触发 `react-hooks/set-state-in-effect`（logcat 功能批带入，此前批次的门禁只跑了 typecheck+测试）。已于 2026-10-11 补修：改 React「adjust state during render」模式（渲染期比对 `prevLogcatDevice`，变化为 null 时重置 dock 态），行为不变，lint 归零。

经验沉淀：窗口尺寸双坐标系（外框 vs 内容）见 [learn 2026-10-10-electron-window-two-coordinate-systems](../../learn/2026-10/2026-10-10-electron-window-two-coordinate-systems.md)。
