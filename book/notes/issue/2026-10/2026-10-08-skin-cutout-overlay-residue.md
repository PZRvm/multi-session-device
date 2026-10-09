---
description: 皮肤不再改变安卓显示尺寸；历史挖孔残留可在编辑页明确请求恢复，隔离选择移除重启回归通过
status: resolved
priority: P2
created: 2026-10-08
---

# 移除皮肤后仍可能保留安卓挖孔屏模拟

- 观察：QVGA 已没有 `skin.name`、`skin.path` 或元数据 skinRef，安卓的 `com.android.internal.display.cutout.emulation.hole` 却仍启用。240×320 的屏幕因此被顶部 136 像素 inset 挤坏。此前所选 Pixel 7 皮肤的 layout 含 `cutout hole`；本轮确认了残留状态，没有单独重建从选择到移除的完整链路。
- 核验：对目标设备读 `cmd overlay list` 和 `dumpsys window displays`。分辨率、密度正常不能排除这个问题；外框回退或清除 skinRef 也不代表安卓 overlay 已恢复。
- 当前处理：只关闭用户指出的 QVGA 实例的 hole overlay，正常重启后生效，用户确认应用列表正常。自动处理尚未加入应用。
- 建议方向：单独设计皮肤切换与 Android cutout 的同步规则，并补选择→移除→重启的隔离回归。需要区分应用设置与用户在开发者选项里主动启用的挖孔模拟，不能无条件禁用所有设备的 cutout overlay。

实例修复见[计划](../../../plans/2026-10-08-qvga-cutout-repair.md)。

## 2026-10-09 产品修复与验证

- 防止新残留：真实启动与 SDK 回归共用 nativeDisplayArgs；选择皮肤时固定设备自己的宽高，皮肤 layout 的 display/cutout 不再用于安卓画面。
- 恢复旧残留：编辑页勾选“恢复安卓默认挖孔”，保存 cutoutResetPending 后下次冷启动执行。只核验目标 AVD、当前用户及内置 com.android.internal.display.cutout.emulation.* 模拟包；禁用后等待新的 boot_id 和 sys.boot_completed=1，完成才发布运行态并清除标记。失败/取消保留请求，可重新启动。
- 意图边界：旧 overlay 没有来源标记，不能可靠判断由皮肤还是开发者选项设置。因此不按移除皮肤动作无条件清理；用户明确选择恢复会关闭该设备当前用户的挖孔模拟，界面已说明。未选择时应用不执行恢复命令。
- 实机：Emulator 37.2.12（build 16428233）× API 32 default arm64 revision 2，独立临时 AVD；选择 Pixel 7 皮肤→移除→重启均保持 240×320 / 120dpi 且无挖孔。主动启用 hole 后普通重启仍保留；明确恢复后新一轮安卓启动完成、hole 禁用。整条测试 57.57 秒通过，临时进程和目录已清理，原镜像 package.xml hash 不变。
- 自动化：目标身份错误、当前用户、取消、禁用失败、旧 boot_completed 误判、pending 标记持久化与失败重试均有用例。

回归命令与 SDK 升级风险见[显示参数记录](2026-10-08-deprecated-skin-display-args.md)，实现见[安全修复计划](../../../plans/2026-10-09-emulator-config-safety-fixes.md)。本页关闭的是产品处理缺口，不代表 Android 所有版本均已验收。
