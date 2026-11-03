---
description: 两台已有设备的黑屏来自不透明皮肤遮罩；校验前景透明度并回退通用外框，随后审查配置编辑范围
status: completed
created: 2026-10-08
---

# 不透明皮肤遮罩导致黑屏

## Step 0：需求简报

用户反馈配置编辑实现后，现有模拟器启动后均黑屏，要求修复并检查配置编辑是否越界。修复范围是皮肤渲染的失败回退；随后只记录配置编辑审查结果。保留现有 AVD、应用和文件，不改机型、API、容量、数据盘、皮肤资源文件或元数据。

## Phase 1：分析

两台设备 `emulator-5556`、`emulator-5558` 的 `sys.boot_completed=1`、bootanim stopped、屏幕 Awake；ADB screencap 返回正常安卓画面。应用显示灰色整框，没有连接错误。

两台设备均使用 `imported:b32a0f89-5dd6-4c73-9339-e86bd0239b17`。该皮肤 `mask.webp` 与 `back.webp` SHA-256 完全相同，均为灰色不透明图片：`0aa418d51b09306995a6978beb05c845e582b53e6a732b244462e5b200aff03b`。DeviceCanvas 将 foregroundMask 放在视频上方，但只检查图片能否解码，未检查透明度，整幅视频被遮住。现有代码和素材足以解释症状；尚未确认该素材由谁写入，不能归因于某个 agent 或配置编辑提交。

影响链：皮肤资源读取 → 图片预加载 → SkinMask 覆盖 canvas。安卓启动与数据盘不参与修复。

## Phase 2：设计

在 DeviceCanvas 图片预加载时，对 layout 引用的前景遮罩检查 alpha。用最多 64×64 的离屏 canvas 采样；完全不透明或无法检查时沿用现有皮肤加载失败路径，显示原因并使用通用外框。正常透明遮罩、普通不透明背景、旋转、输入坐标及视频链路保持原行为。图片只能来自现有受控 data URL。

文件：`src/renderer/src/components/DeviceCanvas.tsx` 与对应 `__tests__/DeviceCanvas.test.tsx`。先用不透明遮罩复现失败，再实现守卫；测试覆盖透明前景、完全不透明前景、不透明背景和检查失败。真实 dev 热更后切换两台设备，检查画面及工具条输入。修复前后校验 config.ini、devices.json 与皮肤素材哈希相同。

## 执行记录

- [x] Phase 3：透明度守卫与既有失败回退。只改 DeviceCanvas 和对应测试，没有写入 AVD 或用户皮肤文件。
- [x] Phase 4：不透明/检查失败用例先失败再通过；相关 4 文件 20 项通过，typecheck、lint、生产构建通过。真实应用刷新后，Pixel 8 API 32 显示相册原内容，QVGA 显示安卓桌面；Pixel 8 主页按键后 ADB 确认焦点为 Launcher。未重新启停安卓，也未重新验证商业应用登录。
- [x] Phase 5：修复 diff 无新增阻塞发现；配置编辑实现的问题只记录在 [审查报告](../notes/issue/2026-10/2026-10-08-device-config-edit-audit.md)。未扩大实现。
- [x] Phase 6：[经验](../notes/learn/2026-10/2026-10-08-opaque-skin-mask-black-screen.md)、问题与索引返写。当前 stage 无对应独立步骤，不改正式阶段安排。

全量检查的限制：599 项通过、5 项跳过，既有 runner 取消测试有 1 个未处理拒绝，整体非绿；单独运行同样复现，本轮 runner 及其测试未改。相关 20 项及静态检查、构建均通过，既有异常纳入上述报告。

修复前后 SHA-256 对比：两个 config.ini、devices.json、皮肤 layout/back.webp/mask.webp 共 6 文件一致。设备数据盘不进入本轮写入集合；没有重建、擦除、扩缩容或更换镜像。两台真实画面恢复确认了本次症状来自前景遮罩。
