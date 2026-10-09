---
description: 修复投屏输入代理缺少 paste 事件处理，支持从宿主复制纯文本并粘贴到当前模拟器
status: completed
created: 2026-10-09
---

# 外部纯文本粘贴

## Requirements brief

用户反馈外部粘贴无法进入模拟器，并明确要求修复，作为本轮实现授权。目标是复制宿主文本后，点击模拟器输入框并按 Cmd+V，文本通过当前投屏会话进入设备。

范围：renderer 输入代理的 paste 事件及回归；中文、英文、换行均走既有剪贴板文本通道。只在当前画布可用并获得焦点时处理，保留 main 的 sender、会话、代次与 4 KiB UTF-8 预算核验。

排除：双向自动剪贴板共享、图片或文件粘贴、修改用户 AVD、前轮两个 review P2、SDK 与传输重构。按 Enter 不会导致布局归零；该 review 问题与本次粘贴缺口分别跟踪。

## Impact range

`src/renderer/src/hooks/useDeviceInput.ts` 与 `src/renderer/src/components/__tests__/DeviceCanvas.input.test.tsx`。本轮开始时备份这两个文件，保留已有未提交改动。

## Analysis / Design

当前 keydown 放行宿主 Cmd 快捷键，但 beforeinput 只处理 insertText，compositionend 只处理输入法确认；没有 paste 监听。原生 paste/insertFromPaste 没有转发，浏览器可能只把文本放进隐藏代理 input。

在代理上同步监听 paste，读取事件 clipboardData 的 text/plain，阻止默认输入，提交 `{ kind: text, text, ime: true }`，沿现有 screen IPC → main validator → clipboardPaste → scrcpy SET_CLIPBOARD 路径发送。不会主动轮询或新增宿主剪贴板读取 IPC；无需新增权限。禁用、组合中、空内容及非文本事件不发送；恢复后不补发。失败继续使用现有画布错误提示；beforeinput 的 insertFromPaste 不另提交，避免重复。

## Test plan

先写旧实现失败的真实 Canvas + hook 回归；覆盖中文/英文/换行、只提交一次、暂停丢弃、空及非文本、错误提示、普通打字及 IME 回归。保留 main 4 KiB 验证，不截断或扩大预算。

隔离 Electron 窗口使用原生粘贴命令验证实际 paste 事件，恢复测试前的宿主剪贴板；只输出合成测试文本，不输出用户剪贴板。沿用既有 scrcpy manager ACK 验收，本轮不把事件层 harness 当真实 Android 控件验收。

全量 test、lint、build（含 typecheck）、改动源码格式检查；八项 review 仅记录新发现，book 写回并刷新索引。

## Done criteria

- [x] 新回归在旧实现失败，修复后通过，普通输入及暂停保护不回归。
- [x] 原生 Electron paste 路径确认纯文本完整且只提交一次，隐藏代理没有留下内容。
- [x] 全量检查通过，review 在案，plan、learn、stage 与索引同步。

## 实施结果

输入代理新增同步 paste 监听，取 text/plain 后阻止默认行为，经现有 `ime: true` 文本请求提交；暂停、组合中、空内容及非文本不提交。事件监听随组件清理，未新增宿主剪贴板读取权限或 IPC。发送失败保留画布提示；main 的 4 KiB UTF-8 限制与会话守卫保持。

新增 8 项回归：旧实现 7 项失败、普通打字/IME 对照通过；修复后本文件 10 项通过，相关 Canvas/布局/scrcpy manager 39 项通过。覆盖三类文本、一次提交、暂停后恢复不补发、空/非文本/组合、失败提示及真实 main validator 的字节边界。

隔离 Electron 39.8.10 使用 WebContents.paste 原生命令：旧实现 paste 未被阻止、beforeinput 为 insertFromPaste、IPC 请求 0 次，隐藏 input 留下 16 个英文字符；新实现英文、中文和含换行/emoji 的三组均阻止默认、完整提交一次、隐藏值为空、无 renderer 异常。测试保存并恢复宿主剪贴板的全部可读格式，不写出原剪贴板内容。临时窗口已退出。

真实 harness 使用生产 DeviceCanvas 和 useDeviceInput，流状态及 screen.input 接口受控，未将本轮测试当成真实 Android 控件接收验收；既有生产 manager 的 ACK/UTF-8 真实模拟器结果在 [前轮计划](2026-10-09-remaining-issue-fixes.md)。

全量 757 项通过、6 项跳过；lint、build（node/web typecheck）及改动源码格式通过。最后只为 ResizeObserver 测试替身补齐 unobserve 类型契约，本文件重跑 10 项通过，build/typecheck/lint 重跑通过。八项 review 无本轮新增明确缺陷；前轮的布局归零释放与控制写失败 ACK rejection 仍在 [原留项](../notes/issue/2026-10/2026-10-09-remaining-fixes-review-findings.md) 跟踪，未顺手改动。

证据保留在系统临时目录 msd-external-paste-t8k4itvj：源码前置快照、red/focused/full-test 日志、前后 native-result.json 及独立 Electron harness。未操作用户 AVD、未提交 git；stage 05 的整项双向共享仍不勾选。
