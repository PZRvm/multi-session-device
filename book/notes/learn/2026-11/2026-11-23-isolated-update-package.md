---
description: 隔离应用升级测试需要拆分应用身份、数据和更新缓存，关闭真实设备跟踪并明确打包输入
tags: [Sparkle, NSIS, electron-builder, app-update, isolation]
---

# 隔离更新包需要分开身份、数据和缓存

- **场景**。在日常工作机器上制作两个多开模拟器测试版本，用环回更新源验证真实替换或下载。
- **原因**。独立 `appId` 和 `userData` 还不足以隔离环境。Windows 的 electron-updater 缓存目录取自包名。应用启动也会主动连接共享 ADB。另设打包输出目录后，electron-builder 的默认文件 glob 可能把仓库原有 `dist/` 带进 asar，本轮首次归档增至约 1.2 GB。
- **做法**。隔离包保留独立包名、应用标识及数据目录，使用临时签名和环回源，关闭真实设备跟踪。更新打包明确收录 `package.json`、`out/` 和 `resources/`，仍由 builder 收录生产依赖。通过 `verify-packaged-asar.mjs` 对账包内实际文件。真实设备回归应另用专用夹具。
