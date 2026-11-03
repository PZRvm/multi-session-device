---
description: 设备与浏览器三语 README 的十二种 Shields 徽章改为仓库本地 SVG，设备首页使用带背景 logo
---

# README 图片本地化

用户希望 README 图片不再依赖 Shields 服务，并要求设备项目首页恢复带背景的 logo。

设备项目三语 README 改用现有的 `resources/icon.png`，原显示尺寸保留。五种徽章下载到 `.github/assets/badges/`。浏览器项目 `/Users/pangzerui/foreunit/multi-session-browser` 的三语 README 同样改为本地图片，保存七种徽章，保留其现有 logo。每个项目的三语版本共用一组资源，原有徽章样式、内容与点击目标不变。

选择保存 Shields 返回的 SVG，既保留现有外观，也免去阅读时的图片服务请求。徽章为静态快照，依赖版本变化时需同步更新图片。

十二份 SVG 均可解析，未含脚本、事件属性或外部图片引用；六份 README 的图片路径存在，各仓库三语徽章一致且资源不被忽略。README 格式、diff 检查通过，浏览器项目 typecheck/lint 通过。只读复审未发现新增问题；没有改业务代码，未运行实窗验收。

浏览器原有的 `.gitignore` 修改保留，本轮未提交或推送。GitHub 发布目标和 book 排除方式仍待用户答复，不属于此次图片本地化的完成结论。

对应[发布准备计划](../../../plans/2026-11-03-github-publication.md)。
