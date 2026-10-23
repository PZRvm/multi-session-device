---
description: P5 模拟器环境适配代码评审发现——1 条 P2（繁中功能显示名与系统实际不符）+ 3 条 P3；只记录不修
---

# Windows 模拟器环境适配（P5）代码评审发现

- **评审输入**：feature/windows-emulator-env（a2ee9e4，基 feat/windows-branch 66ebb1c）src 侧全量 diff（25 文件 +558/-41）；门禁 1379 测试全过 / typecheck 0 错 / lint 0 问题；mac 冒烟与 diff 评审已由用户验收。
- **纪律**：只记录，不顺手修——修复是下一轮独立工作。

## P2（应修，建议进修复轮）

- **P2-1 whpxMissing 繁中文案的功能显示名与系统实际不符**：文案指引用户勾选「Windows 虛擬機器監控平台」，但繁中 Windows 的「開啟或關閉 Windows 功能」列表里该项实际显示为「**Windows Hypervisor 平台**」（Dell/MSI/BlueStacks 繁中支持页一致：<https://www.dell.com/support/kbdoc/zh-tw/000195980/>、<https://tw.msi.com/faq/8790>）——繁中用户照文案搜索会找不到要勾的项。zh-CN（「Windows 虚拟机监控程序平台」）与 en（"Windows Hypervisor Platform"）均正确，仅 zh-TW 一处改词即可。

## P3（可顺延，记录在案）

- **P3-1 whpx 匹配只扫双 tail 尾部（各 4KB 截断）**：WHPX 致命句式若被长启动输出顶出 tail 窗口会漏判，回退通用 `unexpected-exit`（可接受降级——指引缺失但错误不丢）。真机样本采样时顺带确认句式在输出中的位置。
- **P3-2 深链链路无失败反馈**：`DeviceRow` 的 `void openWindowsFeatures()` 与 main 侧 `void shell.openExternal()` 均 fire-and-forget——深链拉起失败（协议异常/策略拦截）时用户点击无反应也无日志。与 `shellShowItemInFolder` 先例同构；真机验证深链真实拉起后再决定是否补反馈或日志。
- **P3-3 测试缺口**：`sdkIpcImages` 下载守卫的 win32 传参无直测（单行逻辑，经 `hostImageAbi` 单源间接覆盖）；`DeviceWizard` 渲染层的 win32 verdict 注入无直测（纯函数已测、接线未测）。修复轮或后续批补两条即可。

## 结论

无 P1。核对过的安全点：renderer 运行时错误消费端只按 message 展示、无 code 分支（`App.tsx:175-179`），新 code `whpx-missing` 不影响既有通知链；`DeviceWizard` 两处 `useMemo` 未把 `window.api.platform` 入依赖（运行期常量，eslint 无告警）；darwin 摄像头深链原串逐字节不变、`hostAbi` 缺省值构造性等价于原硬编码；深链通道无 renderer 入参面、win32 外拒绝。P2-1 建议随 P4 合并后的下一批一起修（一处文案改词 + 三语字典），真机项（样本采样、深链拉起）归统一集成验证阶段。

## 修复记录（2026-10-22 修复轮）

- **P2-1 已修**：`errors.ts` zh-TW 的 `whpxMissing` 功能显示名改为系统实际文案「Windows Hypervisor 平台」（附改词理由注释）；zh-CN/en 本就正确未动。1379 测试全绿、typecheck/lint 0 错。
- **P3-1～P3-3 未修**（按纪律顺延；P3-1/P3-2 的裁决点在真机集成验证，P3-3 补测随下一批）。
