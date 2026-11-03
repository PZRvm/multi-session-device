---
description: Electron 打包图标、macOS Dock 和原生提示框分别配置；主进程共用 NativeImage 可统一运行时图片
tags: [electron, icon, dock, dialog, nativeImage]
---

# 打包图标替换后，还要接运行时入口

electron-builder 的 ICNS/ICO/PNG 控制应用包图标；`BrowserWindow.icon` 供窗口使用，不能替代 macOS Dock 的 `app.dock.setIcon`。原生提示框需传 `dialog.showMessageBox` 的 `icon`。本次主进程从 `resources/icon.png?asset` 创建一个 NativeImage，供两类窗口、Dock 和全部提示框共用；提示框图片由主进程固定，不扩 renderer 白名单。

验证要同时看图片能否解码和应用包内路径是否存在。此次隔离冒烟覆盖 dialog 有/无父窗、非法输入、图片不可被调用者覆盖；macOS 目录包实际显示中文提示框与手机图标。其他系统需要各自验收。

接口参考：[Electron dialog](https://www.electronjs.org/docs/latest/api/dialog)、[Dock](https://www.electronjs.org/docs/latest/api/dock)。
