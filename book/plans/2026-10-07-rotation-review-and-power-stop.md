---
description: 修复旋转等待期间触点竞态与失败提示，将工具条电源接入设备停止链路
status: completed
created: 2026-10-07
---

# 旋转 review 修复与电源关机

## Brief 与分析

用户要求修复 [review](../notes/issue/2026-10/2026-10-07-manual-rotation-code-review.md) 的前两项 P2，并明确电源按钮关机后显示设备已停止，只从左侧启动设备。现有 devices.stop 和 runner 已覆盖停止进程组、清理会话、回写 stopped；电源应接入这条链路。

范围：旋转等待期间拒绝新触点及重复旋转；renderer 暂停画布输入并显示当前视图的真实失败；电源停止当前设备。保留左侧启停、旋转锁定命令、视频和皮肤布局、runner 停止与错误状态机。排除其他输入协议缺陷、SDK、AVD 配置、启动方式和既有资料格式问题；不增加依赖或新 IPC。

## 设计

- main 的 StreamSession 登记 rotating，在任何异步旋转步骤前置位，用 finally 解除；等待期间拒绝 touch 和重复 rotate，仍允许 release-all 清理；既有取消/归属检查继续生效。
- DeviceCanvas 用 ref 防重复旋转、state 禁用普通工具条与画布输入；screen.input 经 toApiResult 包装，当前归属失败接入提示，切视图/代次/卸载后的失败忽略。捕获信封副本，避免 hook 原地更新 generation 影响对比。
- 工具条电源独立调用 onStop，沿用 App 的 handleStop 和原生失败提示。旋转或投屏未就绪时仍可关机；停止期间防重复点击。App 按 device.id/runId 挂载画布，设备切换取消旧组件的显示状态。
- ScreenInput 的 button 闭集只保留 Android 按键，删除不可达的屏幕电源切换和 screenOn 状态；工具条保留电源图标，提示“关闭设备”。

涉及 main/scrcpy 的 index.ts、control.ts 和测试，shared/types.ts，renderer 的 App.tsx、DeviceCanvas.tsx、DeviceToolbar.tsx 和组件测试。

## 实施与验收

1. 回归先行：阻塞锁定期间新 Down 和第二次 rotate；失败后可再操作；旋转失败可见、旧归属失败静默；电源走 stop，不走 screen.input，停止后占位且只能由左侧启动。
2. 最小实现，相关测试、全量 test、typecheck、lint、变更文件格式检查；全仓格式遗留照实记录。
3. 用新鲜 dev 主进程实测 API 34 设置页旋转保持、工具条电源停止与左侧重新启动。
4. review 只记录新增发现；回写 issue、learn、stage 和 plan，刷新 book 索引。

## 结果与 review

实现按设计完成。新增回归先在旧实现得到 6 项失败：新 Down 被接受、旋转失败提示缺失、旋转未禁用输入、电源未走停止。增加切设备后旧失败静默的回归后，全量结果为：

```text
Test Files  34 passed | 2 skipped (36)
Tests       421 passed | 5 skipped (426)
```

npm run build（含 typecheck）、lint、10 个变更源码/测试文件的 prettier --check、git diff --check 通过。全仓 prettier --check src 仍被既有 fixtures/README.md 阻断，见 [原 issue](../notes/issue/2026-10/2026-10-07-fixture-readme-format-baseline.md)。没有修改基线资料。

新鲜 dev 主进程、Pixel 10 Pro API 34 实测：左侧启动成功；设置页从 wm user-rotation free 开始，工具条旋转后 0、2、10 秒均为 lock 1、orientation=1、2856×1280，截图横屏；再次点击同样采样均为 lock 0、orientation=0、1280×2856，截图竖屏。新构建工具条电源将状态变为停止中，再变为停止；右侧显示“设备已停止，从左侧列表启动它”，工具条消失，左侧恢复启动入口，adb devices 无模拟器残留。最终保留停止状态和更新后的 dev 应用。

review 核对八项检查单：rotating 在首次 await 前置位，finally 解除；释放操作仍可执行，旧归属取消继续生效。失败按信封副本核对且卸载后静默，旋转和停止都有即时重复点击守卫。电源沿用现有停止权限、进程组回收与快照状态机，不新增 IPC 或依赖。未发现本轮新增阻塞问题。

原 [review issue](../notes/issue/2026-10/2026-10-07-manual-rotation-code-review.md) 三项均已关闭；[learn](../notes/learn/2026-10/2026-10-07-rotation-await-input-guard.md)、PRD 和旧投屏 plan 同步电源语义，stage04 原步骤补结果。未提交 git。

2026-10-07 用户要求再次 code review：真实 useDeviceInput 对照探针发现新的 P2，旋转暂停会清空按下键登记而未发送 KeyUp，失败恢复后也无法补齐；同场景 HEAD 通过。相关正式测试 6 文件、87 项通过。只记录，源码与正式测试未改，详见 [后续 review issue](../notes/issue/2026-10/2026-10-07-rotation-input-pause-review.md)。该发现补充上面的 review 结论。

同日用户要求旋转期间的操作直接丢弃：[后续 plan](2026-10-07-discard-input-during-rotation.md) 已实现，main 内部释放旧键和触点，期间全部合法新输入（含 release-all）丢弃，renderer 清掉移动 RAF 与跨暂停 IME；上述按键 P2 已关闭。此处的“仍允许 release-all”是前轮行为，当前以新 plan 为准。
