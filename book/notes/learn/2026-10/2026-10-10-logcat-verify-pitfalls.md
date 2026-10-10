---
description: 日志面板验证期两个环境陷阱：npm run format 不透传参数全仓扰动；npx electron 直指 js 文件会换 app 名隔离 userData
created: 2026-10-10
tags: [electron, tooling, prettier, userdata, cdp, verification]
---

# 日志面板验证期陷阱：format 参数与 userData 隔离

## 现象一：`npm run format <路径>` 不透传，全仓重排

`package.json` 的 format 脚本是 `prettier --write .`——`npm run format src/main/logcat` 实际执行 `prettier --write . src/main/logcat`，两个路径都处理，等于全仓格式化。结果 worktree 里几十个未改动的 book/*.md 被重排（单引号、换行风格归一），`git status` 满屏无关改动，第一次提交差点混入。

**正确姿势**：全仓格式化只有 `npm run format`；单文件用 `npx prettier --write <路径>`。

**复盘**：混入后靠 `git reset --soft HEAD~1` + `git restore --staged .` + `git checkout -- book/` 拆干净，只提交 src 与 vite 配置。提交前 `git status` 逐行核对是最后防线。

## 现象二：`npx electron out/main/index.js` 换 app 名、隔离 userData

CDP 真机验证想用构建产物（比 dev 稳定），用 `npx electron out/main/index.js` 启动后 `devices.list()` 返回空——`app.getPath('userData')` 落到了 `~/Library/Application Support/Electron/`（Electron 直指 js 文件时 app.name 取二进制名 "Electron"），与主仓 `multi-session-device/` 的 devices.json 完全隔离，看起来像数据丢失。

**正确姿势**：以项目根为入口 `npx electron .`——读取 package.json 的 name/productName，userData 与打包应用一致。`--remote-debugging-port=9222+` 照常附加。

**附带收获**：`devices:list` 对隔离目录返回空表而非报错，域守卫（requireSender）工作正常；CDP 驱动窗口时按 URL（index.html / logcat.html）识别比按 title 可靠（页面 title 初始都是 "Electron"，ready 后才变）。

## 适用场景

- Electron 应用做 CDP 自动化验证（本仓库 e2e/cdp-smoke.mjs 同款场景）。
- 任何 `npm run <script> <参数>` 调用前——先确认 script 模板是否以 `.` 硬编码路径。
