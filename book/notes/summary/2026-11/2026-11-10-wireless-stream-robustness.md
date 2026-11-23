---
description: 无线投屏健壮性修复——建流失败不再泄漏 server 进程与 forward、无线视图激活/恢复时唤醒屏幕、建立期失败自动重试一次；真机整链路验收待执行
created: 2026-11-10
---

# 无线投屏健壮性修复（泄漏 / 熄屏停帧 / 建流重试）

## Background

用户报告：无线连接真机时「画面连接失败」高频，且无线设备画面卡顿。$investigate 实测定位三根因（详见
[learn](../../learn/2026-11/2026-11-10-无线scrcpy熄屏停帧与建流泄漏谱系.md)）：

1. 建流失败/中断时 `session.transport` 尚未赋值，teardown 不执行——server 进程、本地 adb shell、
   forward 全部泄漏（实机曾同时 3 个孤儿 server）。
2. 无线 adbd 传输闪断 → 设备 offline → track 全量重建会话，重建窗口内建流竞态失败即复现上一条。
3. 熄屏(doze)时表面编码器零帧（实测 57.7s 静默），画面冻结；恢复链 resetVideo 熄屏下产不出新帧。

链路本身健康：5GHz/-49dBm、RTT ~50ms、吞吐 31-35Mbps、server 冷启动 1-2s。用户选择修复 A+B+C。

## Changes

- `src/main/scrcpy/transport.ts`：spawn 之后包 try/catch，失败/中断即 kill serverProc + 移除
  已建立的 forward，再重抛原错误；错误语义不变。
- `src/main/scrcpy/session.ts`：建立段最多 2 次尝试（间隔 1s，仅 transport 从未建立且未 aborted
  时重试），吸收无线闪断后的瞬时建流竞态；重试仍败保留原始错误。
- `src/main/scrcpy/proc.ts` + `ipc.ts` + `recovery.ts`：`wakeDeviceScreen`（KEYCODE_WAKEUP 224，
  仅无线 serial），触发点两处——打开设备视图、恢复节拍（resetVideo 旁）。
- 新增回归 `src/main/scrcpy/__tests__/wireless-robustness.test.ts`（6 项）。

## Outcome

- typecheck/lint/build 通过；全量 1707 项测试通过（首轮 3 个失败为高负载下既有 flaky，隔离复跑
  均过，与本批无关）。
- 真机整链路验收（重试不留孤儿、熄屏后打开视图 2s 内出画面、闪断重建成功率）待在常规 dev/正式
  包环境执行——见 [issue](../../issue/2026-11/2026-11-10-wireless-robustness-hardware-validation.md)。
  dev 实例在本 agent 派生环境启动挂起（复现 3 次，常规终端正常），真机验收由用户环境补做。
