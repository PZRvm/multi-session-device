---
description: 系统镜像 zip 两个实测坑——adm-zip 单条目 Buffer 撞 2^31 上限（userdata.img 恰 2147483648 字节）必须走系统 unzip；zip 不带 package.xml 且首层是 <abi>/，直连安装要自生成身份文件
tags: [android-sdk, zip, adm-zip, unzip, package-xml, downloader]
---

# 镜像 zip 的 2GB 条目上限与自生成 package.xml

- **Scenario**: 直连下载镜像 zip 后用 adm-zip 解压，`RangeError: length 必须 <= 2147483647`；换成系统 unzip 后落位，`scanLocalImages` 又扫不到包。
- **Why**: 系统镜像 zip 的 `userdata.img` 解压后恰好 2147483648 字节（2^31）——adm-zip 按未压缩大小整条目分配 Buffer，撞 Node 上限直接崩；且 zip 首层是 `<abi>/`（不带 platform/tag 层）、**不含 package.xml**（sdkmanager 是从 repo manifest 元数据生成的，catalog 的本地扫描与三件套核验都依赖这个文件）。
- **How to apply**: 镜像级 zip 解压用系统 `unzip`（macOS/Linux 自带、支持 zip64；与皮肤下载的系统 tar 同策略），adm-zip 只留给小型 zip（皮肤导入）；直连安装必须从 manifest 元数据自生成 package.xml（`localPackage path` + `type-details` 的 api-level/tag/abi + revision），布局探测按「system.img 所在目录 ≤3 层」泛化而不是赌固定层级。实证记录在 fixtures README 的「系统镜像 zip 布局」节。
