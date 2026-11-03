---
description: v1.0.0 Preview 已发布 macOS ARM64 DMG、Windows x64 EXE 和 SHA256SUMS，原生构建及公开下载校验通过
---

# 首次发布 macOS 与 Windows 安装包

用户要求同步源码并将两个平台的安装包发布到 GitHub Releases。本次沿用项目 1.0.0 版本，以 Preview 发布，覆盖现有支持范围 macOS Apple Silicon 与 Windows x64。

## 做了什么

新增发布工作流，以 release/v1.0.0 分支触发，在 macos-15 ARM64 和 windows-2022 x64 runner 原生构建。两个包均通过 asar 主入口字节、语法和归档完整性检查后，独立发布任务才计算校验值并创建 Release。构建任务只读仓库，只有发布任务获得 contents:write；未使用本机凭据，也没有向 electron-builder 示例更新地址上传。

asar 检查脚本增加可选文件路径参数，保留无参数的 macOS 默认路径。首轮 CI 暴露 Windows CRLF 转换和测试依赖宿主核数的问题；已固定 checkout 换行方式，并为 settings 测试明确 8 核宿主条件，保留全部断言。产品逻辑未改，低核数默认配置问题另行记录。

## 发布结果

- [v1.0.0 Preview](https://github.com/PZRvm/multi-session-device/releases/tag/v1.0.0)
- 精确构建提交及标签目标：`a473b0e09263155ebc0a52c64e60ef5f528b0c96`。
- [成功工作流](https://github.com/PZRvm/multi-session-device/actions/runs/41611057405)：两个构建任务和发布任务均 success。
- 本地安装包副本：`dist/releases/v1.0.0/`，已被现有 dist 忽略规则排除，不提交二进制到源码树。

| 附件 | 大小（字节） | SHA-256 |
| --- | ---: | --- |
| multi-session-device-1.0.0-mac-arm64.dmg | 120470209 | c488c52a1ededb9a4d3a4030c737fceeb143f739b71b207d012f90d20f70d842 |
| multi-session-device-1.0.0-windows-x64-setup.exe | 99863857 | b9951873febd2e67779c5a994dd8908f749c2a629cb6d10ba245f25ec436979f |
| SHA256SUMS | 226 | 3c632113326a9f4dd45aebefabed0cbfafaa61bcfa4f0569204f82d1e9918e6f |

## 验证与边界

本地 typecheck、lint、19 项 settings 测试通过；asar 的默认路径、显式 Windows 路径、缺失文件、主入口不一致和截断场景通过验证。原生 CI 的两平台 lint、book 检查、类型检查和构建均通过；macOS 全量测试通过，Windows 未运行有既有平台假设的全量测试。

从公开地址重新下载全部附件，大小及 SHA-256 与 GitHub digest 和 SHA256SUMS 一致；DMG 尾部签名、Windows PE 格式以及 hdiutil verify 均通过。未在本次流程执行真实 Windows 安装或完整硬件验收。

macOS 使用 ad-hoc 签名、未经 Apple 公证；Windows 未提供代码签名。发布说明已写明这些事实及现有验收边界，未宣称全平台稳定版。后续文档记录继续提交 dev，不移动 v1.0.0 标签。

[发布计划](../../../plans/2026-11-03-first-installers-release.md) · [低核数默认配置问题](../../issue/2026-11/2026-11-03-low-core-default-settings.md) · [Actions 运行时提示](../../issue/2026-11/2026-11-03-actions-runtime-deprecation.md)
