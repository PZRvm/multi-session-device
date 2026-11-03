---
description: 从同步后的 dev 构建 macOS ARM64 和 Windows x64 安装包，校验后发布首个 GitHub Release
status: in_progress
created: 2026-11-03
---

# 首次安装包发布

## Step 0：需求简报

- 背景：项目已公开，用户要求推送源码，并把 macOS 和 Windows 安装包发布到 GitHub Releases。
- 需求：同步 dev；为现有 1.0.0 版本生成 macOS Apple Silicon DMG、Windows x64 NSIS EXE，以及 SHA-256 校验文件，发布到 v1.0.0。
- 范围：GitHub Actions 打包发布工作流、发布说明、asar 校验脚本的文件路径参数、必要的测试宿主隔离、本计划和收尾记录。
- 排除：不改产品功能，不改版本号，不推 main，不使用或上传本机签名凭据，不为尚未验证的 Intel Mac/Linux/Windows ARM64 生成安装包，不声称公证或完整硬件验收通过。
- 验收：源码及标签已推送；两个平台的原生构建与包内校验成功；Release 包含 DMG、EXE 和 SHA256SUMS；公开下载入口存在，附件大小及校验值可核对。

## 阶段 1：分析

本地和远端 dev 已同步为 42b5030，无未提交改动，package.json 版本为 1.0.0，无既有 tag。macOS ARM64 与 Windows x64 为当前项目支持范围；Windows 全量测试存在既有平台假设，不能据此宣称全量跨平台测试通过。

本机为 Apple Silicon，没有 Wine，gh 未登录；SSH 推送可用。通过 release/v1.0.0 分支触发 GitHub Actions，在 macos-15 ARM64 与 windows-2022 x64 原生 runner 构建，使用工作流自身的短期 GITHUB_TOKEN 发布，避免新增本机认证或交叉编译依赖。两个构建都成功后才创建 v1.0.0 标签，构建失败时可正常推进发布分支修复，无需移动标签。

现有 asar 校验器固定查找 mac-arm64，需增加可选归档路径参数，以便在 Windows 上复用同一套主入口字节、语法及归档边界检查。无参数行为保持不变。

## 阶段 2：设计

新增 release workflow：仅匹配 release/v* 发布分支，核对分支与包版本，npm ci、lint、book 检查和构建；mac job 额外运行全量测试，Windows job不运行已知不兼容的全量测试。分别构建 ARM64 DMG 与 x64 NSIS，显式禁用 electron-builder 自动上传，校验 asar 后上传工作流产物。两者都成功才由独立发布 job 收集安装包、计算 SHA256SUMS，以精确构建 SHA 创建标签及 GitHub Release，不覆盖既有 Release。

发布 job 单独授予 contents:write，构建 job 为 contents:read。CI 下载使用官方 npm、Electron 与 electron-builder 二进制源。版本沿用 v1.0.0，以预览版发布，说明 macOS 未经公证、Windows 未提供代码签名以及现有验收边界。只附两个安装包及校验值，不上传构建目录。

## 执行记录

- [x] Step 0、阶段 1：核对源代码、版本、架构、环境和认证能力。
- [x] 阶段 2：确定原生双平台工作流及发布门禁，无待确认缺口。
- [x] 阶段 3：双平台工作流、可选 asar 路径参数和预览版发布说明完成。
- [ ] 阶段 4：本地检查、原生构建及产物校验。
- [ ] 阶段 5：只读评审，只记录。
- [ ] 阶段 6：报告、计划、索引及 Release 结果核对。

本地验证：typecheck 通过；asar 使用真实构造归档验证无参数 macOS 默认路径、显式 Windows 路径、缺失文件拒绝、主入口不一致拒绝和截断拒绝；workflow YAML、权限/依赖关系及全部 Bash 步骤语法通过。lint 首次指出两处格式警告，已按项目 Prettier 修正后复验。

首轮原生 CI 在打包前失败：Windows checkout 的 CRLF 触发 Prettier；macOS 3 核 runner 上 settings 的两个测试带入固定 4 核设置而失败。阶段 4 回到阶段 3 作定向调整：checkout 前禁用自动换行转换；settings 测试显式设定 8 核宿主，保留全部原断言。发现的低核数默认配置问题另记 issue，不修改产品逻辑。

## 参考

- https://www.electron.build/v26/docs/features/multi-platform-build/
- https://docs.github.com/en/actions/how-tos/write-workflows/choose-where-workflows-run/choose-the-runner-for-a-job
- https://cli.github.com/manual/gh_release_create
