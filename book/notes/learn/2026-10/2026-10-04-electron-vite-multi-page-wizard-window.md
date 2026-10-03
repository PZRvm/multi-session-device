---
description: electron-vite 加第二个 HTML 入口的三件套——rollupOptions.input、嵌套目录入口的相对路径（./ 还是 ../）、modal 子窗 dev/prod 双加载分支
tags: [electron-vite, multi-page, browserwindow, modal, gotcha]
---

# electron-vite 多页入口（模态子窗）三件套

- **Scenario**: 主进程按需开第二扇 BrowserWindow（如新建设备模态向导），需要独立的 HTML 入口。
- **Why**: 三处不同步就白屏/500：① `electron.vite.config.ts` renderer 段要加 `build.rollupOptions.input`（多页)；② 嵌套目录的入口 tsx（`src/wizard/index.tsx`）从兄弟目录引资源要用 `../styles/global.css`——照抄 `main.tsx` 的 `./` 会得到 vite `Failed to resolve import` + 页面挂 `<vite-error-overlay>`（500 不报在主进程日志以外的地方）；③ 子窗加载分支必须与主窗同款 dev/prod 判断（`ELECTRON_RENDERER_URL` + `/wizard.html` vs `loadFile('../renderer/wizard.html')`）。
- **How to apply**: 冒烟白屏先看向导窗自己的控制台（CDP targets 里它是独立页），`<vite-error-overlay>` 直接指向 import 解析错；preload 沿用同一份 `window.api`（白名单共享，无需第二份桥）。模态窗 `parent + modal: true + show: false + ready-to-show 再 show`，单例引用存模块级并在 `closed` 清空。
