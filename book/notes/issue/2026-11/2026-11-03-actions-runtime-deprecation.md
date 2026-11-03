---
description: GitHub 提示 checkout 和 setup-node v4 使用已弃用的 Node 20 运行时，目前由平台强制切换到 Node 24 并构建成功
---

# Actions v4 的运行时弃用提示

- 观察：安装包工作流的 check annotations 提示 `actions/checkout@v4`、`actions/setup-node@v4` 面向 Node.js 20，平台已强制改用 Node.js 24 执行。成功工作流 41611057405 仍保留该提示。
- 复现：打开 release-installers 的任务注释；git-policy 也使用相同两个 action 版本。
- 当前结果：两个平台构建、附件上传和发布全部成功；这是 action 自身的运行时提示，项目构建所用 Node.js 22 未改变。
- 建议方向：单独核对官方 action 的支持版本、runner 兼容性后升级并回归。本次阶段 5 只记录，不顺手更新版本。
