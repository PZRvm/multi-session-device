---
description: 无线投屏三项健壮性修复——建流失败不泄漏 server 进程、无线视图激活/恢复时唤醒屏幕、建立期首次失败自动重试一次
status: in_progress
created: 2026-11-10
---

# 无线投屏健壮性修复（泄漏 / 熄屏停帧 / 建流重试）— plan

调查依据：2026-11-10 `$investigate` 会话。实测确认三根因：建流失败/中断时 `session.transport` 尚未赋值，teardown 不执行，serverProc + 本地 adb shell + forward 全部泄漏（手机上实证 3 个孤儿 server，对应三次失败重试）；无线 adbd 传输闪断使设备 offline→track 全量重建会话，重建窗口内建流竞态失败即泄漏并显示「画面连接失败」；熄屏(doze)时表面编码器零帧（实测熄屏 57.7s 静默），且 resetVideo 熄屏下产不出新帧，恢复链 3×3s 后报 screenRecoveryTimeout。链路本身健康（5GHz/-49dBm、RTT 50ms、吞吐 31-35Mbps、冷启动 1-2s 在预算内）。2026-11-10 用户选择修复 A（泄漏）+ B（熄屏停帧治理）+ C（建流重试）。

## Requirements brief — Step 0

### Background

无线连接真机时「画面连接失败」高频出现，且无线设备画面卡顿。$investigate 定位：泄漏让每次失败重试都在手机上留孤儿 server；无线闪断触发全量会话重建，重建竞态下失败率上升；熄屏停帧是另一种"卡住"形态，且恢复链（resetVideo）在熄屏下无效。

### Scope

- Affects：`src/main/scrcpy/transport.ts`（spawn 后失败清理）、`session.ts`（建立期自动重试）、`ipc.ts`（激活时唤醒）、`recovery.ts`（恢复节拍时唤醒）及对应测试；唤醒仅针对无线 serial（含 `:`）。
- Does NOT affect：录制管线、剪贴板同步、设备列表/track 域、无线连接/修复域（external.ts）、AVD 会话与 runner、UI 组件、AVD/USB 设备的熄屏行为（USB 也可被动唤醒？——否，本批只做无线）、Windows 特有路径。
- Boundaries：泄漏清理是 best-effort（每步吞错，不改变原始错误语义）；唤醒用 `input keyevent KEYCODE_WAKEUP`（224），不解锁设备，不设 stayAwake（耗电权衡，无线 stay_awake 依赖插电不成立）；建立期重试最多 1 次、间隔 1s，仅限 transport 从未建立的情形，重试仍败保留原始错误。

### Requirement

1. 建流任何失败/中断路径不得泄漏 server 进程与 forward 规则（根因 A）。
2. 无线设备视图激活时与恢复重试节拍时唤醒手机屏幕，画面不因熄屏冻结（根因 B）；AVD/USB 不受影响。
3. 建立期首次失败自动重试一次（根因 C），吸收无线闪断后的瞬时建流竞态；重试仍败则错误态保留原始错误。
4. 全部现有测试保持绿；新增回归覆盖三条修复的失败路径。

## Impact range — Phase 1

| 已核实位置 | 变更 |
| --- | --- |
| `src/main/scrcpy/transport.ts` | spawn 之后（forward、video socket 循环、control、元数据解析）用 try/catch 包裹；catch 中 best-effort kill serverProc + `forward --remove tcp:port`，再重抛原错误 |
| `src/main/scrcpy/session.ts` | runSession 的建立段改为最多 2 次 attempt（间隔 1s，仅 transport 未建立且未 aborted 时重试），重试仍败进 error 态 |
| `src/main/scrcpy/ipc.ts` | screenActivate 登记后，wireless serial 且会话 ready → fire-and-forget 唤醒（注入 runAdb 接缝） |
| `src/main/scrcpy/recovery.ts` | startRecovery 节拍：resetVideo 同时 best-effort 唤醒（wireless serial） |
| `src/main/scrcpy/proc.ts` | 新增 wakeDeviceScreen 助手（runAdb 包装） |
| 测试 | transport/session/ipc/recovery 对应 `__tests__` 回归 |

风险：唤醒 keyevent 在部分 ROM 可能被限制（A15 实测有效）；重试拉长最长建立时间到 ~31s；唤醒与 scrcpy powerOn 叠加无害。设计不新增 IPC/契约变更。

## Design — Phase 2

### 1. 泄漏清理（A）

`establishTransport` 内：spawn 成功后，`signal.aborted` 或任何失败即 `serverProc.kill()` + `forward --remove`（best-effort，各步吞错）再重抛。错误语义不变——调用方仍看到原错误文案（如「连接 scrcpy no-video-socket 超时」）。

### 2. 熄屏唤醒（B）

唤醒助手：`wakeDeviceScreen(serial)` = `runAdb(adbPath, ['-s', serial, 'shell', 'input', 'keyevent', '224'], 10s)`，吞错。触发点两个：
- `screenActivate`：登记 active 后，`serial.includes(':')` 且 session 存在 → void wake。
- `startRecovery` 首拍：resetVideo 同时 void wake——resetVideo 熄屏下产不出新帧（实测），唤醒是让恢复链真正收敛的手段。

### 3. 建立期自动重试（C）

runSession 建立段：尝试 1 失败且 `!abort.signal.aborted && !session.transport` → 等 1s 再试 1 次。重试仍败或中途 aborted → 现行 error/cleanup 语义不变。最长建立墙钟 ≈ 2×15s + 1s。

## Test plan

- transport：spawn 后 forward 失败 / connect 循环超时 / aborted → 断言 serverProc 被杀 + forward remove 被调；成功路径不受影响（现有用例）。
- session：establish 两次败 → error 态且 error 保留首次或末次原始错误；一次败一次成 → ready。
- ipc/recovery：wireless serial 激活/恢复首拍 → wake 被调用；USB/AVD serial → 不调用。
- 回归：现有 transport/session/control/ipc 套件全绿。

## Implementation steps

1. transport.ts try/finally 清理（A）+ 回归测试
2. session.ts 建立重试（C）+ 回归测试
3. proc.ts 唤醒助手 + ipc.ts/recovery.ts 触发点（B）+ 回归测试
4. 全量测试 + build/typecheck/lint
5. 真机验收：重试风暴不再留孤儿进程；熄屏后打开视图 2s 内出画面；闪断重建一次成功率提升
6. Phase 5/6：review 记录 + summary/issue 写回 + book:index + 提交
