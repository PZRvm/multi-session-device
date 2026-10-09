---
description: emulator 虚拟场景只认 config 小写；创建和编辑共用映射，复现先保留原配置以免掩盖相机闪退
tags: [emulator, camera, argv, config-ini, virtualscene, crash, investigation]
---

# emulator 摄像头取值的真机兼容口径（37.2.12 实测）

适用场景：任何给 `emulator` 传 `-camera-front/-camera-back` 或写 AVD `config.ini` 的 `hw.camera.*` 的代码。2026-10-09 用户报"设虚拟场景后启动死机"，隔离矩阵实测结论：

## 1. 命令行参数与 config.ini 的值域不同

- **argv 不接受 virtualscene（任何大小写）**。合法值：`webcam<N>`、`emulated`、`environment`、`videofile:options`、`imagefile:options`、`image360:options`、`none`。传 virtualscene → 进程约 5 秒 exit 1。
- **config.ini 只认小写 `virtualscene`**。写 camelCase `virtualScene` 不报错也不生效——**静默变成零摄像头**（logcat `0 cameras are being emulated`），系统照常启动，最阴险的形态。
- 小写 config 正常：虚拟场景摄像头（EmulatedCamera_QemuCamera3）注册并可用。
- argv 合法值里的 `environment` 实测未确认等价虚拟场景（场景后端日志未出现）——没有证据前不要用它当场景别名。

**规则**：需要"虚拟场景"时只走 config.ini（小写）；argv 只用于 webcamN/none/emulated 这类确定值；应用内 camelCase 枚举（`virtualScene`）在写文件处必须映射（本仓库 `cameraConfigText`）。

## 2. emulator 的致命参数错误只打 stdout

`Invalid value for -camera-front...` 与合法值列表都在 **stdout**，stderr 为空。只捕获 stderr 的宿主进程看到的是"exit 1 无原因"——与端口被占/AVD 锁的静默 exit 1 症状完全一致，极易误判。捕获子进程输出做诊断时 stdout/stderr 都要留尾部（runner 已补 `stdoutTail`）。

## 3. 顺带

- 隔离验证的稳妥写法：临时目录 + 符号链接只读复用真实 SDK 的 emulator/platform-tools/cmdline-tools/jre 与镜像，每场景全新 AVD + 独立端口（复用同一 AVD 连续启停时 multiinstance 锁会让后续启动静默 exit 1，污染结论）。
- 同一 AVD 上 avdmanager 重建（--force）不清理锁；杀进程后留 3–5 秒再启下一次。
- 测相机 App 打开：用 `am start -a android.media.action.STILL_IMAGE_CAMERA`（AOSP camera2 的 Activity 类是 `com.android.camera2/com.android.camera.CameraActivity`，类在 `com.android.camera` 子包，直接猜 `camera2/.CameraActivity` 会 Error type 3）。判存活用 `pidof com.android.camera2`——`ps -A` 的 NAME 列会截断包名。
- 克隆在用的 AVD 做实验：复制 .avd 内**普通文件**（目录里有 qemu 控制台 socket，copyFile 会 ENOTSUP），ini 改 path 指向克隆，同 AVD 身份并行启动要加 `-read-only`；config.ini 的 `image.sysdir.1` 按 SDK 根解析，隔离 SDK 里要把镜像目录也挂上。
- virtualscene 场景摄像头的帧时间戳为负且不单调（37.2.12，`Camera3-Stream: returnBuffer ... is not increasing` 刷屏）：AOSP 相机 App 容忍，严格断言时间戳的第三方相机类 App 可能闪退。

## 4. 创建和编辑必须共用映射，错误大小写不能视为等价

2026-10-09 13:40 原配置复现：前后摄像头均写 `virtualScene` → Android 注册 0 个摄像头 → AOSP 相机打开时 `ArrayIndexOutOfBoundsException: length=0; index=0`。改为小写后注册 1 个后置场景摄像头，预览正常、crash 缓冲为空。模拟器和 Android 系统在原故障中仍存活。

此前只修 `settingsToConfigPatch`，编辑的 `buildConfigEditPatch` 仍有独立映射且直接输出内部枚举。修复时先找全同类写入路径，共用 `cameraConfigText`；`configMismatchesOf` 必须把错误大小写当未知值，让既有保存同步流程修正，即使表单模式没有变化。metadata 内部 `virtualScene` 与文件 `virtualscene` 的转换是必要契约，不能靠接纳错误别名掩盖。

复现先对原始配置、数据和参数留证，再做单变量对照。早期克隆先将摄像头设为小写，验证了正确配置，却跳过用户的实际故障；由此推断时间戳为根因是不成立的。时间戳异常与本次零摄像头崩溃分开跟踪。

调查类型：`investigation`；置信度 9/10；证据为实际 AVD 数据副本三轮运行和 6 项红绿回归。涉及 `src/main/emulator/deviceConfig.ts`、`src/main/emulator/configDrift.ts`；[完整报告](../../../plans/2026-10-09-virtual-scene-camera-edit.md)。
