---
description: 修复 Android 设置页手动横屏后被自动旋转立即恢复竖屏的问题
status: completed
created: 2026-10-07
---

# 手动旋转保持方向

## Brief 与分析

用户在 Android 设置页点击工作台的旋转按钮，横屏后马上恢复竖屏。工具条只发一次 rotate；scrcpy 3.3.3 的 Device.rotateDevice 先冻结方向，再恢复原来开启的自动旋转。模拟器传感器仍报告竖屏，因此覆盖手动操作。

Pixel 10 Pro API 34 实测：初始 accelerometer_rotation=1、wm user-rotation=free；点击后仍为 rotation=0。执行 wm user-rotation lock 后，同一按钮得到 lock 1、rotation=1，横屏保持。

范围只含 main/scrcpy 的旋转注入及回归测试。手动旋转会关闭该设备的自动旋转，后续点击继续切换横竖屏；用户仍可在 Android 设置里重新开启。保持现有视频尺寸、皮肤、触控、会话归属守卫和 AVD 初始朝向，不改启动参数、server、协议或其他输入操作。

## 设计

沿用 screen:input 的闭集 rotate 请求。control.ts 释放现有触点后，等待 InjectContext.lockRotation，再发 writer.rotateDevice。index.ts 的回调使用绑定会话的 serial 执行 adb shell wm user-rotation lock（10 秒超时），非零退出码或命令异常直接 reject，不继续旋转。命令成功后复核会话和活动视图仍有效，避免等待期间切设备或停机会继续发送旧输入。

生产修改：src/main/scrcpy/control.ts、index.ts。测试修改：同级 **tests**/control.test.ts、index.test.ts。主进程依赖增加可注入的 adb 命令接缝，测试不启动真实进程。

## 实施与验证

1. 先写失败测试：释放触点 → 等锁定 → 一次旋转；锁定失败不旋转；命令只绑定当前 serial，等待期间归属变更拒绝。
2. 按设计实现，再跑相关测试、全量 npm test、typecheck、lint 和格式检查。
3. 新鲜 main 构建后用同一设备设置页重测：从自动旋转开启开始，点击横屏并观察保持，再点击恢复竖屏。
4. review 只记录；补 learn、更新 stage04 已完成步骤的结果与 plan 状态，运行 book:index。

完成条件：回归测试修复前失败、修复后通过；设置页真机复现通过；检查全绿，文档和索引同步。

## 结果与 review

两处生产代码按设计实现。初始新增 6 项回归测试在旧实现失败：lockRotation/adb 命令调用次数为 0，锁定失败仍发送旋转；另补等待期间停机回归。相关 26 项通过，全量结果：

```text
Test Files  33 passed | 2 skipped (35)
Tests       413 passed | 5 skipped (418)
```

npm run build（含 typecheck）、npm run lint 通过；四个变更代码文件的 prettier --check 和 git diff --check 通过。全仓 npx prettier --check src 被既有 fixtures/README.md 格式阻断，提交版本复核仍为 false，记录在 [issue](../notes/issue/2026-10/2026-10-07-fixture-readme-format-baseline.md)，未修改基线文档。

新鲜 npm run dev 主进程实测 Pixel 10 Pro API 34：打开 Android 设置页，wm user-rotation free 后确认 accelerometer_rotation=1；点击工作台旋转，0、2、10 秒的观测均为 lock 1、rotation=1，截图保持横屏；再次点击，同样观测均为 lock 0、rotation=0，恢复竖屏。停止本轮启动的设备，保留更新后的 dev 应用。

review 核对 serial 绑定、窗口和会话守卫、等待期间归属变化、触点释放顺序与失败路径，未发现本轮新增阻塞。既有 API 32 手机主页/应用朝向限制不在此次设置页验收结论内。经验已写入 [learn](../notes/learn/2026-10/2026-10-07-scrcpy-manual-rotation-auto-revert.md)，stage04 原步骤补结果，索引重建。未提交 git。

调试状态：DONE_WITH_CONCERNS；功能已修复且真实模拟器验证通过，唯一检查遗留是上述既有文档格式问题。investigate 辅助日志/telemetry 脚本未安装，经验保存在仓库 book。

2026-10-07 用户要求进一步 code review 后，临时测试确认两项 P2：锁定等待期间新触点未在旋转前释放、锁定失败被工具条静默吞掉；另确认既有 power 按钮入参守卫问题。详见 [review 记录](../notes/issue/2026-10/2026-10-07-manual-rotation-code-review.md)。本次只记录，源码和正式测试未修改；该记录补充上轮 review 的结论。

用户随后授权修复两项 P2，并要求电源停止模拟器；后续实现和验收见 [plan](2026-10-07-rotation-review-and-power-stop.md)。
