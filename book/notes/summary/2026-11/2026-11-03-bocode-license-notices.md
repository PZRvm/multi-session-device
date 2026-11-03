---
description: 补充 BoCode 原始 MIT 许可和第三方来源声明，标明规范与两份维护脚本的改编范围
---

# 补充 BoCode 许可声明

本项目采用了 BoCode 的开发规范，也适配了索引生成与模板检查脚本。原有注释说明了来源，仓库尚未附上完整许可文本。用户要求补齐许可和第三方声明。

新增 [licenses/BoCode-MIT.txt](../../../../licenses/BoCode-MIT.txt)，原样保存上游 MIT LICENSE，保留 `Copyright (c) 2026 Focus`。下载内容的 Git blob SHA 与上游 API 返回值一致：`a598087fed4b06c6eee99432ae97b0c6fdaf4ddf`。

新增 [THIRD_PARTY_NOTICES.md](../../../../THIRD_PARTY_NOTICES.md)，列出规范、模板及两份维护脚本的来源和适配情况，并链接许可原文。采用独立的第三方许可文件，避免将整个项目的原创代码标为 MIT。

本次仅补文档；未修改业务代码、打包配置或项目整体许可证。后续分发相关内容时，应随附版权和许可声明。许可原文一致性、本地链接和 book 索引检查通过。
