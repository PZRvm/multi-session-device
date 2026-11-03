---
description: 已提供隔离 SDK 升级回归并在当前版本通过；-skin 的官方弃用风险继续监测
status: monitoring
priority: P3
created: 2026-10-08
---

# SDK 升级时检查固定屏幕尺寸的启动参数

> 监控项已并入 [待修问题清单](../../task/2026-10-09-待修问题清单.md)追踪；本文保留回归方法与证据。

- 观察：当前 emulator 37.2.12.0 的 `-help-skin` 支持 `-skin WIDTHxHEIGHT`，实测能阻止皮肤覆盖 QVGA 尺寸；[官方命令行文档](https://developer.android.com/studio/run/emulator-commandline#deprecated-options)已将 `-skin` / `-skindir` 列入弃用选项。这是升级风险，当前没有复现启动故障。
- 回归方法：隔离 AVD 配置 240×320、120 dpi，选择 display 为 1080×2400 的皮肤；带 `-skin 240x320` 启动，确认 `sys.boot_completed=1`，`wm size=240x320`，`wm density=120`。不能仅检查 CLI 退出码或外框图片。
- 建议方向：升级 emulator 时跑上述案例；若参数被忽略或拒绝，再设计将皮肤彻底留在 renderer 的方案，避免批量改写已有 AVD 配置。

本轮实现与范围见[修复计划](../../../plans/2026-10-08-skin-native-display.md)。

## 2026-10-09 已加入升级回归

```bash
npm run test:emulator-config -- --sdk-root "/path/to/AndroidSDK"
```

默认使用已安装的 `system-images;android-32;default;arm64-v8a`。脚本创建独立临时 SDK/AVD，只读复用工具和镜像，生成产品同款 package.xml 并交给官方 avdmanager；随后通过生产 runner 和 nativeDisplayArgs 执行真实启动。覆盖皮肤选择→移除→重启、尺寸/密度/boot、主动挖孔保留及明确恢复。常规 npm run test 跳过这条实机测试，不冒用用户已有 AVD。

当前版本 Emulator 37.2.12（build 16428233）、API 32 revision 2 实测通过（57.57 秒）。参数尚未替换，官方弃用风险仍存在；每次升级后执行此命令，不以本次通过推断未来 SDK 可用。

仅验证某个直连包能被官方创建工具接受：

```bash
npm run test:emulator-config -- --sdk-root "/path/to/AndroidSDK" --image "system-images;android-37.2;google_apis_playstore_ps16k;arm64-v8a" --create-only
```

37.2 多 tag 包已真实创建通过（1.12 秒）；此模式不声称完成该镜像 boot、摄像头或跨形态验收。
