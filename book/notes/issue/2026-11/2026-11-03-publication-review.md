---
status: open
description: 首次公开发布检查发现 Logcat 测试偶发失败、hook 未执行和旧产品说明待核对
---

# 首次公开发布的后续检查项

## Logcat 订阅断言偶发失败

- 观察：macOS 首次 `npm test` 中 App.logcat.test.tsx 第 135 行断言 subscribe 收到 d1 时调用数为零；其余 1559 项通过。单独重跑该文件 36 项通过，再次全量运行 1560 项通过、6 项跳过。
- 复现：全量运行 `npm test`；目前不能稳定复现，尚未确认原因。
- 建议方向：核对异步订阅完成时机与测试断言等待方式。发布过程只记录，未修改相关代码或断言。

## commit-msg hook 未设置执行权限

- 观察：发布副本首次提交时 Git 提示 `.githooks/commit-msg` 因不可执行被忽略；索引模式为 100644。提交主题已另行运行校验脚本并通过。
- 复现：设置 `git config core.hooksPath .githooks` 后提交，查看 Git 提示或使用 `git ls-files -s .githooks/commit-msg`。
- 建议方向：单独处理 hook 的可执行位和跨平台使用方式，本次不顺手修。

## PRODUCT.md 保留早期规划

- 观察：PRODUCT.md 仍引用未公开的 book 路径，并含“一期不支持 Windows”等早期边界；当前 README 已描述 Windows 已实现范围和未完成验收。
- 复现：对照 PRODUCT.md 的 Capabilities and Constraints、Evidence on Hand 与 README 平台状态。
- 建议方向：单独核对产品说明的时效性和公开副本引用；当前能力以 README 和源码为准。本次未改产品说明。
