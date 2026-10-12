---
description: 双分支合并 review 经验——生成物 README 冲突必须重跑生成器收敛（手拼必漂移）；lint/测试「通过」注记要复跑验证，基线问题在两父提交上分别复跑定位归属
created: 2026-10-12
tags: [git, merge, code-review, book-index, eslint, react-hooks, verification]
---

# 双分支合并 review：README 重生成收敛 / lint 基线复跑定位

来源：fix/issue-audit 与 feature/network-switch-group 先后合入 dev（5316b7b、0d6ad6f）后的合并 review + 清基线批。

## 1. 生成物（book/README.md）的合并冲突不能手拼——重跑生成器收敛

README 是 `npm run book:index` 的产物，两次合并中它在 M2 冲突，手工解决后出现三处漂移：两条 issue 条目插错排序位（生成器按路径字典序，手拼按时间直觉插）、尾部计数注释 228 vs 实际 231、且 `book:release-check` 直接挂。**条目集合本身没丢**（盘上文件与索引链接双向核对无缺失），但一致性校验过不去。

- 规则：凡生成物冲突，解完冲突立刻重跑生成器，不人工判断「看起来两边都有了」。
- 快速判据：`npm run book:release-check` 过不过，比肉眼 diff 生成物可靠。

## 2. 「typecheck/lint/test 通过」的注记不能当证据——复跑才算

e49db02 的 stage 注记写「lint 通过」，merge review 复跑发现基线实际有 4 errors（dialog 测试 mock 未用参数 ×2、ReportApp set-state-in-effect ×1、DeviceWizard ×1）。分支侧只验证自己 worktree 里动过的文件或沿用 `--cache`，存量问题会被注记口径掩盖。

- 合并 review 定责方法：worktree checkout 两个父提交分别跑同一命令（`git worktree add` + 软链 node_modules），对比问题归属——本批据此确认 3 项 lint error 全是 dev 存量、网络分支反而修掉了 1 项。
- 顺手收益：deviceStore 测试 mock 的 `vi.fn<(locale: string) => Promise<void>>()` 泛型先例直接套用到 dialog 测试——实现零参 + 泛型签名描述调用面，`mock.calls` 元组类型也齐（[同日 learn §2](2026-10-12-app-mount-subscription-test-mock-shape.md)）。

## 3. 订阅型 effect 的依赖补齐优先于豁免

`showAlert` 原是每渲染新建的普通函数（只依赖 `copy`），既有代码用 `eslint-disable exhaustive-deps -- 理由` 压 warning。改成 `useCallback(..., [copy])` 后身份稳定，两个订阅型 effect 完整声明依赖、旧豁免一并撤销——能用稳定化消除的告警不新增第二条豁免。挂载即拉取的 effect（ReportApp）确需同步置位的，沿 DeviceWizard 先例：说明注释 + 定向 `set-state-in-effect` disable。
