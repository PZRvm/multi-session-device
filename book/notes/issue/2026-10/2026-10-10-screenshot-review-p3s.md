---
status: resolved
description: 截屏批 review P3 共十项——首轮五项（save TOCTOU、缓存竞态、0×0 PNG、错误气泡时效、动画重复）+ 独立 review 追加五项（stderr 无界、oversized 绕 i18n、通道名错位、过期回调覆盖、runner 直测缺口）
created: 2026-10-10
tags: [review, p3, screenshot, race, clipboard, downloads]
---

# 截屏批 review P3（两轮共 10 项，已于同日修复批全部处置）

背景：plan 2026-10-10-screenshot-clipboard-save 的 Phase 5，按八项检查单过完整 diff。无 P1/P2（授权面：双通道主窗 sender 守卫、受控写图、文件名清洗杜绝路径穿越均复核通过）。以下 P3 等后续批次或独立任务处置。

## P3-1：save 无互斥——同 tick 双击可产生两个文件

问题：renderer 侧 `save()` 用 stateRef 守卫 phase，但同一 tick 内两次点击都读到旧 ref（setState 未提交），双 invoke；main 侧 save 无锁，且 `resolveFileName` 的 `access` 检查与 `writeFile` 之间存在 TOCTOU——两个并发 save 可能拿到同一文件名，后者覆盖前者，或分别写 `-1` 与 `-2`。

复现：条件苛刻（需同一事件 tick 双击 + 提交窗口内），人工难触发；并发语义上不严谨。

建议方向：main 侧 save 挂与 capture 同款每设备互斥（或全局单飞）；`resolveFileName` 检查后写临时名再 `rename` 收口。

## P3-2：在途 capture 与 stopped 清理的竞态——缓存可能在停止后回填

问题：`stopped`/`beforeKill` 钩子清缓存，但此刻若有未完成的 capture，其完成后 `cache.set` 会把「已停设备的最后一张」重新写入缓存。气泡因渲染期派生不会显示（无用户可见影响），但缓存条目滞留至下次 stop 事件，约 1MB 级内存。

建议方向：capture 完成入缓存前复核设备仍 running（注入的 runningDeviceRef 再查一次），不 running 则丢弃。

## P3-3：合法签名但坏体的 PNG 会产生 0×0 截图

问题：PNG 前 8 字节魔数对但体损坏时，`nativeImage.createFromBuffer` 返回空图，`getSize()` 为 0×0——capture 仍按成功返回并写剪贴板，用户粘出空图。

建议方向：size 校验 `width > 0 && height > 0`，不满足走 `screenshotCaptureFailed`。

## P3-4：错误态气泡与成功态同享 10s 自动消失

问题：capture/save 失败的报错气泡 10 秒后自动消失，用户可能没看到就没了（错误信息值得多留）。

建议方向：error 态延长（30s 或不自动消失，等下一次操作重置）。

## P3-5：spin keyframes 与 DeviceCanvas 既有 `.spin` 重复

问题：`ScreenshotPopover` 自带一份 `screenshot-spin` keyframes，DeviceCanvas 已有同语义 `.spin`。两份小重复，styled-components 组件级隔离下的常规代价。

建议方向：若第三个消费者出现，提炼共享动画 token；现在不值得动。

## 其余检查项结论（clean）

- 重复：runAdbBinary 与 runAdb 结构相似是有意分层（learn 已记），非复制粘贴漂移。
- 授权：`app.getPath('downloads')` 为 OS 级用户设置，本工具不自定义；写文件名经清洗无路径穿越。
- 边界：空 PNG/超 32MB/设备名全非法字符/重名超 99 次均有兜底并有测试。
- 范围：`devices/index.ts` 新增 8 行只读访问器导出超出 plan 文件清单，已在 plan 实施结果中作为偏差记录（注入模式必要数据源）。
- 复杂度：主域自包含约 230 行，renderer 三件套职责单一。

---

## 第二轮：独立 review 追加 P3（2026-10-10，含关闭钮追加批；均已对照源码核实）

首轮为作者自查；本轮由独立 reviewer 以全新视角过 `dev...HEAD` 完整 diff（含气泡关闭钮），交叉验证后逐条核实成立。仍无 P1/P2。

### P3-6：runAdbBinary 丢了 runAdb 的 stderr 4KiB 尾部上限

问题：`src/main/screenshot/index.ts` 的 stderr 收集（`err.push(chunk)`）与返回（`Buffer.concat(err)`）均无上限；对照 `src/main/emulator/adb.ts` 的 `STDERR_TAIL_BYTES = 4096` 尾部截断。双 runner 分层时只照抄了结构，丢了有界化。窗口期最长 15s（超时上限），异常 adb/设备持续刷 stderr 时内存无界。

建议方向：补与 runAdb 相同的 4KiB 尾部截断，一行改动。

### P3-7：'screenshot oversized' 是应用自产文案却绕过 i18n

问题：`src/main/screenshot/index.ts` 超限护栏 resolve `stderr: 'screenshot oversized'`（硬编码英文），该串随后作为 `detail` 拼进已本地化的 `screenshotCaptureFailed`，用户会看到「截屏失败：screenshot oversized」混语。违反本仓库「外部工具 stderr 原样保留、应用自产文案走 msg()」的约定。

建议方向：errors.ts 三语加 `screenshotOversized` 键，超限路径改 `msg()`。

### P3-8：requireMainSender 对 save 通道报错了 capture 的通道名

问题：守卫闭包硬编码 `IPC_CHANNELS.screenshotCapture`，save handler 复用后，非主窗 invoke `screenshot:save` 的报错是「screenshot:capture: 未登记的窗口」，诊断指向错误通道。守卫功能本身正常；测试只断言含 `unregisteredWindowSuffix`，未拦住错位。

建议方向：helper 接受 channel 参数。

### P3-9：renderer 在途 save 的完成回调可覆盖新截屏状态

问题：`useScreenshot.save()` await 返回后无条件 `setLatched`，不校验阶段仍是 `saving`；saving 期相机钮不禁用（busy 只看 capturing）。点保存后、save 返回前再点截屏，若 save 晚于新 capture 完成，旧的 saved 态（旧缩略图旧文件名）覆盖新的 copied 态约 10s。数据无损，窗口窄。对照 `DeviceCanvas` 的 input 回调有 generation 守卫，此处缺同款。

建议方向：完成回调前加阶段守卫（`stateRef.current.phase !== 'saving'` 即弃），或 saving 期一并禁用相机钮。

### P3-10：runAdbBinary 自身零直测；空名兜底断言偏弱

问题：超时 resolve、超限 SIGKILL、spawn error reject 三条路径只经注入桩间接覆盖，无真 spawn 直测（回归如漏 `clearTimeout`、忘 kill 不会被发现）；测试 `expect(sanitizeFileSegment('   ').length).toBeGreaterThan(0)` 未断言文档承诺的 `'device'` 回退值。

建议方向：补 runAdbBinary 直测（真 spawn sleep/cat 桩）；空名断言改 `toBe('device')`。

### 第二轮其余检查项结论（clean）

授权面、capture 互斥同步占位、子进程/timer 资源回收、React 纪律（ref 全在 effect、渲染期派生、id:runId key）、三语键集编译期一致、错误传播链路均复核通过；`invalidPayload` 无分隔符拼接为全仓既有惯例，非本批引入。

---

## 处置记录 — 2026-10-10 修复批（用户批准，全部修复）

- **P3-1**：save 挂每设备互斥（`saves` Set，同步占位镜像 capture），双 invoke 第二发报新词条 `screenshotSaveBusy`；落盘改「写临时名 `.part` → 原子 `rename`」，检查名与写入之间不再有覆盖窗口，失败清理残留 `.part`。
- **P3-2**：capture 在写剪贴板/缓存前复核 `runningDeviceRef`，设备已停则报 `screenshotDeviceNotRunning`——停止钩子清缓存后不再回填。
- **P3-3**：解码后校验 `width/height > 0`，0×0 按 `screenshotCaptureFailed`（detail `decoded 0×0`）处理，不写剪贴板。
- **P3-4**：error 态不再布防自动消失；收起路径 = 关闭钮、下一次截屏/保存、设备切换。copied/saved 的 10s 自动消失不变。
- **P3-5**：新建 `styles/animations.ts` 导出 `spinKeyframes` 单源，DeviceCanvas（1.2s）与气泡（0.9s）各自时长消费，两份重复 keyframes 删除。
- **P3-6**：`runAdbBinary` 补 `STDERR_TAIL_BYTES = 4096` 尾部截断，对齐 runAdb。
- **P3-7**：超限路径改 `msg('screenshotOversized')`（三语新词条），不再硬编码英文。
- **P3-8**：`requireMainSender` 改收 channel 参数，save 报错归位 `screenshot:save`；sender 测试同步强化为断言各自通道名。
- **P3-9**：实现比原建议更强——**单调操作序号 `opSeq`** 守卫（每操作启动取 seq，完成不匹配即丢弃）。原建议的「读提交后 ref 判阶段」被测试抓出提交延迟缺陷（快速 reject 时 React 未提交 'saving'，误判丢弃会卡死 spinner）；seq 在事件回调内同步写 ref，无此问题。`save` 启动同时清自动消失计时，防保存中气泡蒸发。
- **P3-10**：`runAdbBinary` 五条直测（正常 Buffer 透传 / stderr 尾部上限 / 超时 SIGKILL / 超限 SIGKILL / 二进制不存在 reject）；空名兜底断言改 `toBe('device')`。

验证：新增测试 11 项，全量 **889 项通过（6 项原有跳过）**，typecheck/lint/prettier/build 通过；真机 CDP 冒烟 happy path（截屏→剪贴板→保存落盘）无回归。经验沉淀见 learn「exec-out 二进制流与 react-hooks 新规则」第 4 节。
