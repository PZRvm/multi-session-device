---
description: Electron 39 拖放文件路径必须经 preload webUtils.getPathForFile 中转；jsdom 拖放测试三个坑（小写事件名、relatedTarget 不进 init、DataTransfer 靠 fireEvent init）
tags: [electron, drag-drop, webUtils, preload, vitest, jsdom]
---

# Electron 39 拖放取路径与 jsdom 拖放测试

- **File.path 已死**：Electron 32 起 renderer 拿不到 `File.path`（39 彻底移除）。拖放文件的绝对路径只能在 preload 里 `webUtils.getPathForFile(file)`（Electron 30+）转出来；File 对象经 contextBridge 传给 preload 函数受支持。落法：preload 暴露 `resolveDropPaths(files: File[]): string[]`，不占 ipcMain 通道（本地同步调用）。
- **非本地文件**：`getPathForFile` 对拖入的非文件条目返回 `''`——调用方必须判空，别把空串喂给 adb。
- **jsdom 坑一（事件名）**：把 React 风格 `onDragEnter` 直接 `Object.assign` 到裸 DOM 节点不生效——DOM 属性是全小写 `ondragenter`；测试挂载面用 `addEventListener('dragenter', handler)` 最稳。fireEvent.dragEnter 派发的是小写 `dragenter`，所以 React 合成层（组件测试）与原生监听（hook 测试）都能接住。
- **jsdom 坑二（relatedTarget）**：`fireEvent.dragLeave(target, { relatedTarget: child })` 不会把 relatedTarget 放进 jsdom 的 DragEvent——init 里给的字段被构造器忽略，事件到手是 null，「经过子元素不收高亮」这类断言必假。要手工 `new Event('dragleave')` + `Object.defineProperty(event, 'relatedTarget', ...)` 再 `act(() => dispatchEvent)`。
- **jsdom 坑三（dataTransfer）**：`fireEvent.drop(el, { dataTransfer: { types: ['Files'], files } })` 可行——DTL 会把 init.dataTransfer 挂到事件上；`files` 用真 `new File(...)`，`types` 悬停期判断只能看它（dragover 时拿不到文件名，扩展名守卫只能放 drop 时——Chromium 安全限制，产品上接受「非 apk 也短暂高亮」）。
- **真机必验点**：webUtils 链路 jsdom 测不了（mock 掉了），集成冒烟至少一次「真拖真装」。
