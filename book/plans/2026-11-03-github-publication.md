---
description: 为 GitHub 发布准备三语 README，并确保发布内容和历史均不含 book
status: in_progress
created: 2026-11-03
---

# GitHub 发布准备

## Step 0：需求简报

- 背景：项目将上传 GitHub；现有 README 停留在早期阶段，book 为本地开发知识库。
- 需求：编写简体、繁体、英文 README；参考成熟开源项目；book 不上传且不加入 .gitignore。
- 范围：README、发布排除配置与必要的发布流程兼容；发布到用户指定的 GitHub 仓库。
- 排除：不改产品功能、不生成虚假截图、不擅自决定许可证、不破坏本地历史、不强推已有远端。
- 验收：三语内容一致，链接可解析，开发命令与实际脚本一致；发布仓库当前树与可达历史无 book；.gitignore 不增加 book 规则。

## 阶段 1：分析

当前无远端；book 已被跟踪并进入大量历史。info/exclude 仅忽略未跟踪文件，export-ignore 只影响 archive，均不能单独阻止历史上传。现有 GitHub 工作流调用 book 校验，公开树去掉 book 后需要相应处理。本机没有 gh CLI。

README 依据源码与已交付报告核实：模拟器、USB/无线真机、投屏输入、日志、截图编辑、录屏、APK、剪贴板、网络与 SDK 来源设置已实现；平台和录屏验收仍有边界，不能写成全平台稳定版。

## 阶段 2：设计

README.md 使用简体中文，README.zh-TW.md 使用繁体中文，README.en.md 使用英文；统一图标、语言导航、功能表、平台状态、快速开始、开发/打包、反馈与上游致谢。无公开安装包和许可的证据时不补造下载入口或许可徽章。

发布方案建议：保留开发仓库，另建无 book 历史的发布仓库；本地排除规则用 info/exclude，不改 .gitignore。具体发布方式、远端地址及可见性等待用户答复后落地，不推送当前历史。

顶部标签补充 Android 与随包 scrcpy server 3.3.3，突出目标平台和投屏核心。保留 Electron、React、TypeScript；WebCodecs、Konva、Mediabunny 留在正文，避免标签堆叠。三个语言版本保持一致。

## README 图片本地化追加（2026-11-03）

- 需求：设备项目三语 README 改用现有带背景 logo；设备和浏览器项目的三语 README 均将 Shields 图片下载到各自仓库。
- 范围：设备项目使用 `resources/icon.png`，两仓库徽章存入 `.github/assets/badges/`；浏览器保留当前 logo。保留徽章原样式、标签与外链点击目标，不动两仓库 .gitignore。
- 分析：设备五种、浏览器七种徽章，各项目三语共用；当前全是静态徽章，本地化后版本标签需随依赖升级手动更新。
- 设计：下载并校验 SVG 后替换图片 URL 为相对路径；检查六份 README 链接、三语徽章一致性与 SVG 安全内容；只读复审，不改业务代码。
- [x] 下载资源与更新 README：设备五种、浏览器七种 SVG，各仓库三语共用；设备 logo 改为现有带背景 icon.png。
- [x] SVG、链接、格式与 diff 验证：12 份 SVG 可解析且不含脚本或外部图片引用；六份 README 图片路径存在、三语徽章一致，格式与 diff 检查通过；浏览器 typecheck/lint 通过。
- [x] 评审及记录：只读核对未发现新增问题；保留浏览器原有 .gitignore 修改；本轮未提交或推送。

## 执行记录

- [x] Step 0、阶段 1：需求与现状核对。
- [x] 阶段 2：README 设计完成；发布方案有真实缺口，已询问。
- [ ] 阶段 3：三语 README 与发布配置。
- [ ] 阶段 4：链接、格式、发布树与历史、工作流检查。
- [ ] 阶段 5：只读评审，只记录。
- [ ] 阶段 6：报告、计划与索引。
- [ ] 上传 GitHub。

## 参考

- https://github.com/Genymobile/scrcpy
- https://github.com/localsend/localsend
- https://git-scm.com/docs/gitignore
- https://git-scm.com/docs/git-archive
