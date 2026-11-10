---
description: 暂停 macOS 证书签名，使用无需钥匙串密码的匿名签名
status: completed
---

# macOS 暂停证书签名

## Step 0：需求简报

- 背景：本地打包访问 msd-sign 钥匙串时反复要求密码，当前开源项目暂不使用证书签名。
- 范围：macOS 打包钩子和 electron-builder 的证书选择配置。
- 排除项：不改 Windows/Linux、运行时业务、系统钥匙串或证书，不删除本机密码文件。
- 需求：打包不读取私钥或密码文件，保留无需证书的 ad-hoc 签名以支持本地运行。

## 阶段 1：分析

现有 afterPack 钩子主动读取项目证书，并尝试解锁专用钥匙串；后续 electron-builder 也可能自动选择本机证书。匿名签名可能使升级后的摄像头等权限需要重新授权，用户已选择暂停证书签名。

## 阶段 2：设计

- scripts/adhoc-sign-mac.cjs：仅调用 codesign --force --deep --sign -，移除证书检测、钥匙串解锁和密码读取。
- electron-builder.yml：mac.identity 设为 null，禁用后续证书签名，保留 afterPack 生成的匿名签名。
- 验证：运行 build:mac、检查产物为 Signature=adhoc、深度验证签名并执行现有 asar 校验。

## 阶段 3–6

已完成：钩子仅做匿名签名，mac.identity=null 阻止证书自动选择。build:mac 成功产出 DMG/ZIP，asar 校验通过（6621 个文件）；codesign 显示 Signature=adhoc，--verify --deep --strict 通过。钩子隔离检查确认非 macOS 跳过，含空格/中文路径作为单独参数传入。评审未发现本次范围内的额外问题，git diff --check 通过。总结见 [功能报告](../notes/summary/2026-11/2026-11-05-mac-without-certificate.md)。
