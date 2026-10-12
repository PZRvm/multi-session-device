---
description: 出身标注 + 过滤视图两批（含六轮验收期修复）合并前 code review——无 P1；4 项 P2（跨桶运行设备查看回归、许可静默文本匹配、级联编排零测试、计数时间窗）与 8 项 P3
created: 2026-10-12
tags: [code-review, sdk-source, device-list, origin, store, ipc]
---

# 来源感知 + 出身过滤两批 code review（2026-10-12，合并前）

范围：`feature/device-list-source-aware` 分支全部代码改动（33 文件 +1247/-78）——出身标注、切来源重查、指路文案、过滤视图、空横幅修复、store 投影修复、通知视图口径、跨桶只读、清除级联、向导引导入口与两段化。结论 **总体 pass，无 P1**；4 项 P2 建议合并前处置，8 项 P3 记录备查。测试基线 1132 项全绿、typecheck/lint/build 干净。

## P2（建议合并前处置）

- **P2-1 跨桶一刀切禁编辑窗，运行中"查看配置"能力回归**：`DeviceRow.tsx:306` edit 钮 `disabled={crossBucket || …}` 无条件禁用——而 props 注释与原设计是「运行中也可查看（保存要求停止）」。跨桶运行设备（豁免显示）本应仍可打开编辑窗查看，保存由 `updateDeviceConfig` 的 `assertDeviceInCurrentBucket` 拦。修法：crossBucket 且非 running 才禁（或钮不禁、开窗后保存拦截）。
- **P2-2 许可拒绝静默依赖错误文本匹配**：`emulator/index.ts` bootstrap handler 用 `error.message === msg('licenseRejected')` 识别取消——跨函数字符串契约，confirmLicenses 未来改动（包 cause/换词条）即静默断裂回退为报错。建议 confirmLicenses 改返回 boolean 或抛哨兵类型。
- **P2-3 清除级联编排零测试**：clear-retained handler 的「先清 SDK → purge → 失败汇总上报」顺序与 `sdk:app-owned-device-count` 通道（settings 守卫、dep 缺席回落 0）无任何域测试——接线断裂或顺序回归无感知（域层只测了 purge 本体）。
- **P2-4 级联计数时间窗**：确认框数字来自点击时刻的 `appOwnedDeviceCount`，实际 purge 以执行时内存为准——中间新建/删除的自有设备会导致确认数与实际删除数不符（破坏性操作下数字失准）。低概率；可在 purge 前校验或文案改约数口径。

## P3（记录备查）

- **P3-1 出身回落口径四处重复**：`?? 'app-owned'` 在 main 三处（assertDeviceInCurrentBucket / purgeAppOwnedDevices / appOwnedDeviceCount）与 renderer `originView.originOf` 各写一遍——建议提升到 shared 单源。
- **P3-2 渲染层死字段**：`ReconciliationSummary.unavailableCount` prop 化后渲染层不再读取（详情窗仍用 report 真值）——保留可，但值得注释标明口径已视图化。
- **P3-3 折叠区跨桶设备的启动语义待确认**：双根并存时折叠区 stopped 设备 availability 可为 valid → 启动钮可用 → 启动后（transient 豁免）跳进主列表、停止后回折叠。功能自洽但"视图跳动"语义未与用户确认过。
- **P3-4 scanError 场景的通知静默**：`reconcileAnomalyHiddenFromView` 只认可见异常/孤立组/库健康——扫描失败（summary 不可见）时签名非空也会被静默 ack。窄边界，接受并记录。
- **P3-5 集成层测试缺口**：DeviceListPane 折叠区行的 crossBucket 禁用/拦截未在集成层验证（DeviceRow 直测 prop）；wizard 引导探测负路径（报错但组件齐全 → 仅重试无引导钮）未测；通知补漏分支（弹窗在途新隐藏签名 → 静默不开窗）未测。
- **P3-6 测试态复位**：App.reconciliation 测试 beforeEach 未复位 `sourceBucket`（zustand 单例泄漏同款，learn 已记）；当前无 shared 设置者故无实害。
- **P3-7 onSdkSourceChanged 单监听器**：覆盖式注册、测试间需手动复位（过滤视图批 review 已记，携带）。
- **P3-8 rmTree 部分失败的半删状态**：清除保留根 rmTree 失败即中止（purge 不跑），错误只含 rmTree 原因——SDK 半删 + 设备未删的现场无专门指引。低频，接受。

## 处置

review 当日用户批复「全部修复」，P2 四项同批清零：

- **P2-1 已修**：edit 禁用改 `crossBucket && status !== 'running'`——跨桶运行设备恢复「查看配置」（保存由 updateDeviceConfig 跨桶守卫拦），停止/删除禁用不变；测试补运行态编辑可用/删除禁用断言。
- **P2-2 已修**：`confirmLicenses` 改返回 boolean（拒绝=取消），bootstrap handler `if (!(await confirmLicenses())) return snapshot`——文本匹配契约删除，`licenseRejected` 词条三语移除。
- **P2-3 已修（编排部分）**：级联编排自 ipc handler 下沉 `clearRetainedWithCascade`（sdkSourceSwitch），handler 只留守卫与本地化上报；新增 4 项域测（先清后删顺序 / 失败聚合不抛 / purge 缺席 passthrough / 非共享态守卫拒绝且级联不启动）。**残留**：`sdk:app-owned-device-count` 通道仍是薄透传（两行、settings 守卫），未单测——留置为 P3。
- **P2-4 已修**：三语确认文案改「当前/目前/currently {count} 台」时点口径，明示数字为确认时刻快照。

修复批全量 1136 项通过、typecheck/lint/build 干净。

**P3 批（用户批复「全部修复」，同日清零八项）**：

- **P3-1 已修**：出身/桶口径单源到 `@shared/deviceOrigin`（originOfMeta/bucketOfShared），main 四处（守卫/级联/计数/快照桶）与 renderer originView 全部换用。
- **P3-2 已修**：`ReconciliationSummary.unavailableCount` 注释标明全量口径、主窗已视图化经 prop 传递。
- **P3-3 已修（语义决策）**：跨桶 stopped 设备启动钮禁用（tooltip 通用化「切换来源后可用」）——与"另一侧只读"对齐，消除启动跳视图的语义越界；运行豁免不受影响。
- **P3-4 已修**：summary 增 `scanError`（可选字段，builder 恒填）——扫描失败时通知不适用视图静默，照常弹；App 判定纳入 + 用例。
- **P3-5 已修**：三个测试缺口补齐——折叠区行跨桶只读集成断言、引导探测负路径（组件齐全不出引导钮）、通知补漏分支守视图口径（隐藏签名静默 ack 不开窗）。
- **P3-6 已修**：App.reconciliation beforeEach 显式复位 sourceBucket。
- **P3-7 已修**：onSdkSourceChanged 改多监听 Set + 退订返回，测试改显式退订（不再覆盖式复位）。
- **P3-8 已修**：clearRetainedRoot 的 rmTree 失败包裹指引（可能半删、可重试收尾、级联未启动）。

P3 批全量 **1139 项通过**、typecheck/lint/build 干净。本 issue 全部发现清零，关闭。
