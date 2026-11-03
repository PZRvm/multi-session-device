---
description: 为 GitHub 发布准备三语 README，并确保发布内容和历史均不含 book
status: completed
created: 2026-11-03
---

# GitHub 发布准备

> 本文记录首次快照发布。用户随后明确要求保留原 commit ID，并允许 book 及其历史公开；当前同步方案见[完整历史对齐计划](2026-11-03-github-history-sync.md)，取代下文的 book 排除要求和独立发布目录流程。

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

### 上传决定（2026-11-03）

- 用户指定 `https://github.com/PZRvm/multi-session-device` 并授权上传；已明确采用 MIT，根目录 LICENSE 署名为 2026 PZRvm。
- 远程查询返回空仓库。保留当前开发仓库及其未提交改动，另建独立发布目录，以当前工作树（含未提交源码及测试）生成首个快照，不携带本地历史、book 或被忽略的本地文件。
- 公开分支使用 dev，遵守不直推 main 的规则。发布目录的 origin 指向上述地址；开发仓库不挂公共 origin，避免后续误推 book 历史。
- 发布兼容范围：卫生检查在无 book 的公开副本中保留垃圾文件检查并跳过索引；公开副本 AGENTS.md 改为适用源码仓库的开发说明，开发仓库规则原样保留。
- MIT 元数据：在 package.json 及锁文件根包声明 MIT，并将第三方声明中原有“原创代码许可未定”的说明更新为已选择的根目录 LICENSE。
- 验证：typecheck、lint、测试和构建；检查 README 本地资源、公开树与全部可达历史无 book、无忽略文件、无大文件和明显凭据；核对推送前后提交哈希。不强推。

- [x] Step 0、阶段 1：需求与现状核对。
- [x] 阶段 2：README 设计完成；用户已指定仓库并授权上传，确定 MIT 和独立发布副本方案。
- [x] 阶段 3：三语 README、MIT 声明及无 book 发布兼容完成。
- [x] 阶段 4：typecheck、lint、build 及全量测试复跑通过；472 文件快照、README 资源、无 book 树与历史及卫生检查通过。
- [x] 阶段 5：只读评审，发现事项记录至 publication-review issue，未顺手修。
- [x] 阶段 6：完成发布报告并刷新索引。
- [x] 上传 GitHub：dev 首次提交 5748ed8，远端 HEAD 一致；远端 git-policy 工作流 success。

## 参考

- https://github.com/Genymobile/scrcpy
- https://github.com/localsend/localsend
- https://git-scm.com/docs/gitignore
- https://git-scm.com/docs/git-archive
