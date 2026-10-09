---
description: 直连 package.xml 的官方创建兼容性已修复并实测；Android 相机取景与签名版权限验收仍待完成
tags: [real-machine, downloader, package-xml, avdmanager, tcc, acceptance]
---

# 真机验收发现（2026-10-06，验证 plan 执行中）

## P1 — 直连下载镜像的 package.xml 被 avdmanager 拒收，下载→创建断裂

- **现象**：向导选 API 37.2（`system-images;android-37.2;google_apis_playstore_ps16k;arm64-v8a`，直连下载入库、三件套自验通过、向导显示「已安装」）→ 创建 → `avdmanager create avd 失败（exit 1）：Warning: Invalid package.xml found at …android-37.2/…/package.xml and failed to parse using fallback. Error: Package path is not valid. Valid system image paths are: system-images;android-32;default;arm64-v8a`。
- **根因（现场文件对比实证）**：`buildPackageXml` 生成的 `<type-details>` **无 xsi:type 声明**；官方 sdkmanager 写的是 `<type-details xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:type="ns14:sysImgDetailsType">`。avdmanager 按 schema 反序列化依赖 xsi:type 识别 details 类型，缺失即 fallback 失败 → 不认该包 → 只把官方安装的 android-32 列为合法路径。此前 [download-direct review](2026-10-06-download-direct-review-findings.md) 的 P2 修了**元素顺序**，但 xsi:type 缺失才是 avdmanager 拒收的决定性差异（次级差异：官方另有 `<abis>`、`<tag><display>`、`<uses-license>`、`<dependencies>` 等，修复时一并比对）。
- **影响**：**所有经应用内直连下载的镜像都无法创建设备**——三件套自验（自家解析器）与官方工具验收不一致，向导「已安装 ✓ 可创建」的承诺对直连包不成立。stage04 时代官方 sdkmanager 装的包不受影响。
- **根因修正（探测实证，17:40 定稿）**：决定性差异共**五要素**，缺一分层报错——①根元素声明 `xmlns:xsi` 与 `xmlns:ns14`（sys-img2/05）；②`<type-details xsi:type="ns14:sysImgDetailsType">`；③schema 必需的 `<abis>arm64-v8a</abis>`；④⑤**每个** `<tag>` 必须带 `<display>` 子元素。分层表现：缺①② → `Invalid package.xml … Package path is not valid`；补①②缺③ → exit 1、stderr 仅 "null"；补③缺④⑤ → **AVD 已写出仍抛 `getDisplay(...) must not be null` 退 1**（应用按退出码判败并回滚，看似创建失败实为收尾异常）。五要素齐 → 应用同款调用真实 exit 0、零 stderr、ini+avd 双落盘。
- **建议方向**：`buildPackageXml` 按五要素对齐官方形态（tag display 文案：`Google Play` / 按原始 tag 映射，参考官方 fixture）；真机 37.2 包 avdmanager create 回归（含退出码与 stderr 双断言）；单测补「自生成与官方 fixture 的结构要素集比对」。修复属新任务。验收绕行：已按配方现场修补 37.2 `package.xml`（原件备份 /tmp/package.xml.bak；修复自有工件、非产品代码），向导内可直接用 37.2 创建。

## P2 — 应用内摄像头枚举为空（宿主 CLI 枚举正常）——Electron 身份下复现实锤，TCC 授权绑定嫌疑

- **现象**：终端跑 `emulator -webcam-list` 枚举到 2 台（MacBook + iPhone 连续互通）；应用向导摄像头下拉始终只有 关闭/虚拟场景（提示「未枚举到宿主摄像头」）。用户已在系统设置给 Electron 授摄像头权限并重启 dev。
- **复现实证（最小探针，17:18）**：以 Electron 运行时身份 spawn 同一条枚举命令——exit 0、stdout 只剩 AVFoundation 的 Continuity Camera 警告、**无 Camera 行**；同一命令在终端/node 下返回完整两台。构建新鲜度已排除（out/main 含批次 1 代码）。结论：**Electron 进程身份下 AVFoundation 把枚举判为未授权、静默返回空列表**（macOS 12+ 行为：未授权 app 的 `AVCaptureDevice.devices` 返回空、不弹窗）。
- **嫌疑与方向**：dev 模式的 Electron.app 为 ad-hoc 签名，macOS TCC 对此类 app 的授权绑定可能不稳定/失效——方向：①系统设置里关掉再重开 Electron 的摄像头开关强制刷新 TCC 记录；②`sudo tccutil reset Camera com.github.Electron` 后重授；③打包签名后的正式 app 复测（签名固定则 TCC 绑定稳定）。另需更正 `cameras.ts` 注释「macOS 授权归属模拟器进程」——实测枚举/取流的 TCC 责任链归属宿主 app（Electron），emulator 无 Info.plist 用途声明，静默拒绝不弹窗。
- **影响**：A1 摄像头项与「真实取景」验收阻塞；webcam 配置链路（占用核验/启动重核验）无法真机验证。验收内以「模拟画面」绕行（`hw.camera.front=emulated` 的 config 落位断言仍可做——写路径与 webcam 同一管道）。
- **处置**：记档不修（环境/系统层）；`devices.test` 对 webcams 为空路径已有降级覆盖，产品代码无需变更即可安全降级。

## 绕行与验证 plan 的关系

A1 皮肤项 UI 侧已过（导入成功、字段解锁、自动选中 `b32af0f9 (imported)`，截图在案）；创建断言以官方安装的 **API 32（AOSP default）** 绕行继续——皮肤 `skin.path` 与摄像头 `hw.camera.*` 的 config 落位验证不受 37.2 包问题影响。

## 2026-10-09 P1 已修复

buildPackageXml 补齐 xsi/sys-img2 命名空间、xsi:type、abis 及每个 tag 的 display，结构断言覆盖五要素。隔离 SDK 使用重新生成的 XML，真实官方 avdmanager 接受 API 32 default 包和原问题的 API 37.2 多 tag 包，均正常返回并写出 ini/AVD；原镜像 XML hash 不变。回归命令见[SDK 检查记录](2026-10-08-deprecated-skin-display-args.md)。P1 关闭，历史现场绕行记录保留。

P2 的解析与本应用权限入口已由后续集成实现；Android 实际取景和签名版授权仍待验收，不能因创建问题关闭而关闭整篇遗留。

> 待验收项已并入 [待修问题清单](../../task/2026-10-09-待修问题清单.md)；本文保留修复与验收历史。
