---
description: 配置偏差提示已支持逐项采用文件值；未采用时保存按表单同步差异，等价容量单位不再误报
status: resolved
priority: P3
tags: [config-edit, copy, code-review]
---

# 配置偏差警告没有说明“只有修改该字段才覆盖”

- **观察**：2026-10-09 安全修复 Phase 5 review，src/main/devices/index.ts 的 buildEditDraft 对已存设置与 config 不同的键显示“以应用记录为准；保存后将覆盖该键”。当前保存只构建差异 patch，未编辑的键保持原文。
- **复现**：元数据 ramMiB=2048，config.ini 的 hw.ramSize=3072，打开编辑页；RAM 警告如上。只改名称或网络保存，hw.ramSize 实际仍为 3072。提示让用户误以为任何保存都会重写 RAM。
- **影响**：文案与实际安全边界不一致；没有发现因此额外写入配置。旧注释中 saveBlockedReason 仍包含运行态的说明也需同步，运行态现已由独立 status 表达。
- **建议方向**：改为“修改此字段并保存时以表单值覆盖；未修改时保留 config 原值”，补对应提示断言；同步契约注释。按 workflow review 只记录，本轮不修。

审查范围见[安全修复计划](../../../plans/2026-10-09-emulator-config-safety-fixes.md)。

## 2026-10-09 按用户新需求修复

用户随后明确要求两条路径，因此未采用原建议中的“只改文案”方案：每个可识别偏差旁显示“采用配置值”，只更新对应输入；不点击时保存也按表单同步该差异项。main 重新检测并校验待同步字段，不能因输入没变绕过校验；容量 228 与 228M 按等价比较。无法识别的原值不提供采用按钮，可用合法表单值覆盖。存储/ABI 继续只读，未知 legacy 不补默认值。

全量 671 项通过、6 项跳过，typecheck/lint/build 和源码格式检查通过；实际编辑组件的亮暗、窄窗和采用后输入更新已预览。saveBlockedReason 注释同步为文件/事务/设备库阻断，运行态继续独立表达。实现与边界见[采用与同步计划](../../../plans/2026-10-09-config-mismatch-reconcile.md)。
