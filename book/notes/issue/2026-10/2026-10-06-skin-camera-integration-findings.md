---
description: 皮肤和摄像头后续调研发现——37.2 webcam 输出不被旧正则解析；Pixel 7 屏幕偏移取错 part；横屏首布局被拒，rotation 单位测试也偏离官方格式
tags: [camera, skin, layout, fixtures, parsing]
---

# 皮肤布局与摄像头解析缺口

发现于 2026-10-06 22:36；以下为发现时事实。2026-10-07 经用户批准的独立集成任务已修复三项解析缺口，见 [实施证据](../../../plans/2026-10-07-skin-camera-integration.md)。对应 [后续调研](../../../think-report/20261006223636-机型皮肤与宿主摄像头.md)。

## P1 — 新版 webcam 输出不被解析，存在摄像头也返回空

- 环境：应用 SDK 的 emulator 37.2.12.0，build_id 16428233；宿主 shell 实跑 `emulator -avd __webcam_probe__ -webcam-list`，exit 0。
- 输出：`Camera 'MacBook Pro相机' can be specified by label as 'webcam0' or by id as '…' and will use pixel format 'NV12'`。
- [生产正则](../../../../src/main/emulator/cameras.ts) 只接受 `Camera 'webcam0' is connected to device '…'`；对本轮真实 stdout 的 matchAll 结果为 0，尽管其中有 MacBook 名和 webcam0。
- [现有测试](../../../../src/main/emulator/__tests__/cameras.test.ts) 仅覆盖 36.1.9 旧格式。该缺口与既有 Electron 身份下 stdout 无 Camera 行的 TCC 证据独立；修解析后仍需 app 身份下复测。
- 建议：两代真实输出 fixture，保留友好名称和稳定宿主 id，权限/探针错误与无硬件分别反馈；不以空数组掩盖格式异常。

## P2 — Pixel 7 屏幕偏移取外框 part，真实皮肤接入会错位

- [fixture](../../../../src/main/emulator/__tests__/fixtures/skins/pixel_7-layout) 与本机 Studio 官方 layout：part1 `name portrait` at `(0,0)`；part2 `name device` at `(59,58)`。
- [parseSkinLayout](../../../../src/main/emulator/skins.ts) 取首个 part；结果屏幕偏移 `(0,0)`。对应 [测试](../../../../src/main/emulator/__tests__/skins.test.ts) 也断言 `(0,0)`，锁住了错误。
- 当前投屏未消费 skinRef，问题尚未显现为真实边框错位；显示接线前必须修正。
- 建议：按含 display 的实际 part 解析；Pixel 7 断言 `(59,58,1080,2400)`，渲染和触控共用该矩形。

## P2 — 横屏首布局不入库，rotation 单位与官方格式不符

- 本机 `/Applications/Android Studio.app/Contents/plugins/android/resources/device-art-resources/pixel_tablet/layout` 只有 layouts.landscape。解析器要求 portrait，返回 null；官方 Pixel Tablet 会被跳过。
- 本机 Nexus/旧 Pixel layout 的旋转为 `rotation 3`。[官方规格](https://android.googlesource.com/platform/external/qemu/+/emu-master-dev/android/docs/ANDROID-SKIN-FILES.TXT) 定义为 0–3 的 90 度步数；当前注释写“rotation 90”，测试样本也用 90。
- 建议：接受官方首布局与屏幕方向，规范四分之一圈旋转；多屏格式不支持则明确拒绝，避免替换为错误机型外框。

## 2026-10-07 集成 review：P2 — 镜像切换覆盖手选皮肤

- 观察：DeviceWizard 的能力响应仍直接 setAdvancedSettings(result.defaults)。有缓存自动默认皮肤时，选择 null 通用外框后切换镜像会重新选中缓存皮肤。
- 复现：选择 Pixel 机型和已装镜像；切附加设置选通用外框；换另一镜像，等待能力返回。
- 方向：按画像保存明确手选，在新能力响应中恢复。作为 [独立修复任务](../../../plans/2026-10-07-wizard-skin-choice-preservation.md) 实施，review 阶段只记。


2026-10-07 手选覆盖独立修复已完成：失败测试复现后新增画像级显式选择记忆，回归通过。

## review 留项（只记录）

- P2：跨设备摄像头占用核验仍以 webcamN 为键。稳定 hostDeviceId 已用于单设备创建/启动重核验，但宿主排序改变后，新设备 webcam1 与旧设备 webcam0 可能指同一物理相机；占用表尚未按稳定身份聚合。新设备创建时遍历旧 advancedSettings 可复现键不同但 hostDeviceId 相同的情况；后续独立任务改稳定身份优先、兼容旧记录。
- P3：位图字节体积已有限额，导入素材仍没有解码像素数预检。高压缩巨大 PNG 可在浏览器解码前占大量资源；后续给支持格式加像素尺寸上限。当前坏格式和普通损坏会明确报错，不当成功渲染。
- 兼容边界：官方目录 58 项只按 profileId 精确同名匹配；Nexus 等旧画像的空格 id、汽车别名未做模糊转换，折叠资源刻意排除。后续如扩大覆盖，需要逐项核验画像尺寸并登记明确别名。
- 验收留项：授权后的 Android 取景与签名版权限未做；全量 Vitest 有既有下载取消用例触发 MaxListenersExceededWarning，测试通过但独立监听器卫生问题未修。
