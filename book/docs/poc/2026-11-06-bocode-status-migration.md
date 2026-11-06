---
description: BoCode 升级时 68 篇历史 task/issue 状态转换的逐篇依据，原正文和文件位置保持不变
---

# BoCode 状态迁移核对

本次只迁移不符合新枚举的 68 篇记录；原先有效的 57 篇不变。保留原始正文，用 frontmatter 表示当前索引分类。部分处置、监测、延期和未见完整销账证据的记录继续 open。

| 记录 | 原状态 | 新状态 | 依据 |
| --- | --- | --- | --- |
| [2026-10-09-剩余缺口验收后代码审查.md](../../notes/task/2026-10-09-剩余缺口验收后代码审查.md) | completed | done | 原 completed；审查任务已完成且相关检查通过。 |
| [2026-10-09-待修问题清单.md](../../notes/task/2026-10-09-待修问题清单.md) | missing | open | 清单仍有未勾选的延期、监测及决策项。 |
| [2026-10-04-avdmanager-sdk-root-null.md](../../notes/issue/2026-10/2026-10-04-avdmanager-sdk-root-null.md) | missing | resolved | 文内 2026-10-05 修复及官方 avdmanager 验证记录。 |
| [2026-10-04-messageport-bridge-no-delivery.md](../../notes/issue/2026-10/2026-10-04-messageport-bridge-no-delivery.md) | missing | open | MessagePort 作为后续优化保持留置，现有替代方案不等于原通道已修。 |
| [2026-10-05-baseline-lint-debt.md](../../notes/issue/2026-10/2026-10-05-baseline-lint-debt.md) | missing | resolved | 文末记录 3f0a977 清空全部 17 项，并明确与姊妹记录重复。 |
| [2026-10-05-baseline-lint-errors-stage04-files.md](../../notes/issue/2026-10/2026-10-05-baseline-lint-errors-stage04-files.md) | missing | resolved | 文内明确已解决，lint/typecheck 和测试验证在案。 |
| [2026-10-05-device-store-read-error-as-empty.md](../../notes/issue/2026-10/2026-10-05-device-store-read-error-as-empty.md) | missing | resolved | 待修问题清单明确 2026-10-09 读取诊断、校验、错误态与副作用前守卫均已确认完成。 |
| [2026-10-05-lint-baseline-unclean.md](../../notes/issue/2026-10/2026-10-05-lint-baseline-unclean.md) | missing | resolved | 文末跟进记录 3f0a977 已修且主仓复验 lint 清零。 |
| [2026-10-05-phone-avd-rotation-refused.md](../../notes/issue/2026-10/2026-10-05-phone-avd-rotation-refused.md) | missing | open | 手机横屏实际验收仍待补。 |
| [2026-10-05-wizard-download-no-tick-guard.md](../../notes/issue/2026-10/2026-10-05-wizard-download-no-tick-guard.md) | missing | resolved | 文末下载同步 ref 守卫及回归测试记录。 |
| [2026-10-06-download-cancel-review.md](../../notes/issue/2026-10/2026-10-06-download-cancel-review.md) | missing | open | P2-4 完整真机取消仍开放。 |
| [2026-10-06-download-direct-review-findings.md](../../notes/issue/2026-10/2026-10-06-download-direct-review-findings.md) | missing | open | P3 平台依赖并入待修清单，未见整篇完整销账。 |
| [2026-10-06-image-uninstall-review-findings.md](../../notes/issue/2026-10/2026-10-06-image-uninstall-review-findings.md) | missing | resolved | 两轮修复覆盖全部 P1/P2/P3，294 项测试通过。 |
| [2026-10-06-real-machine-acceptance-findings.md](../../notes/issue/2026-10/2026-10-06-real-machine-acceptance-findings.md) | missing | open | Android 实际取景及签名版授权仍待验收。 |
| [2026-10-06-skin-camera-integration-findings.md](../../notes/issue/2026-10/2026-10-06-skin-camera-integration-findings.md) | missing | open | 代码项已修，相机取景等延期验收不变。 |
| [2026-10-06-wizard-category-settings-review-findings.md](../../notes/issue/2026-10/2026-10-06-wizard-category-settings-review-findings.md) | missing | resolved | 修复轮逐项列出 P1、P2、十二项 P3，wear 表头另有 52d7bca 处置。 |
| [2026-10-06-wizard-plan-remaining-acceptance.md](../../notes/issue/2026-10/2026-10-06-wizard-plan-remaining-acceptance.md) | missing | open | Quick 门槛和六类完整验收仍未完成。 |
| [2026-10-07-api32-start-repro-procedure.md](../../notes/issue/2026-10/2026-10-07-api32-start-repro-procedure.md) | missing | resolved | 复现附录末尾明确修复后四组探测均结束；这是复现证据而非新增未修项。 |
| [2026-10-07-manual-rotation-code-review.md](../../notes/issue/2026-10/2026-10-07-manual-rotation-code-review.md) | missing | resolved | 文末明确三项记录均关闭，关联旋转/电源修复计划。 |
| [2026-10-07-rotation-input-pause-review.md](../../notes/issue/2026-10/2026-10-07-rotation-input-pause-review.md) | missing | resolved | 后续处理记载 main 释放旧键，暂停输入丢弃及回归。 |
| [2026-10-07-skin-camera-code-review-findings.md](../../notes/issue/2026-10/2026-10-07-skin-camera-code-review-findings.md) | missing | open | 三项 P3 及验收边界未见整篇完整处置。 |
| [2026-10-08-avd-reconciliation-code-review.md](../../notes/issue/2026-10/2026-10-08-avd-reconciliation-code-review.md) | missing | open | 维持原案及缓解残余并入待修任务，尚有决策项。 |
| [2026-10-08-avd-reconciliation-implementation-review.md](../../notes/issue/2026-10/2026-10-08-avd-reconciliation-implementation-review.md) | missing | open | 高频重查与 EACCES 等保留项仍由任务跟踪。 |
| [2026-10-08-deprecated-skin-display-args.md](../../notes/issue/2026-10/2026-10-08-deprecated-skin-display-args.md) | monitoring | open | 原 monitoring，继续监测弃用参数；新规范监测归 open。 |
| [2026-10-09-config-safety-followup-audit.md](../../notes/issue/2026-10/2026-10-09-config-safety-followup-audit.md) | closed | resolved | 原 closed；四项配置缺口有修复收尾，后续 virtualscene 修复也有实测；独立延期验收保留在任务清单。 |
| [2026-10-10-boardhead-toggle-review-p3s.md](../../notes/issue/2026-10/2026-10-10-boardhead-toggle-review-p3s.md) | missing | open | 两项 P3 只有发现记录，未见处置。 |
| [2026-10-10-logcat-resize-hook-window-recreate.md](../../notes/issue/2026-10/2026-10-10-logcat-resize-hook-window-recreate.md) | closed | resolved | 原 closed；处置记录已将布尔挂钩改为窗口 id。 |
| [2026-10-10-logcat-review-p3-misc.md](../../notes/issue/2026-10/2026-10-10-logcat-review-p3-misc.md) | closed | resolved | 原 closed；处置记录三项同批修复与 883 项测试。 |
| [2026-10-10-logcat-spawn-fail-silent.md](../../notes/issue/2026-10/2026-10-10-logcat-spawn-fail-silent.md) | closed | resolved | 原 closed；处置记录同步 spawn 错误显式反馈及单测。 |
| [2026-10-10-screenshot-review-p3s.md](../../notes/issue/2026-10/2026-10-10-screenshot-review-p3s.md) | missing | resolved | 用户批准的全部修复批逐项处置十项问题。 |
| [2026-10-11-sdk-source-shared-wizard-guide-and-journal-corruption.md](../../notes/issue/2026-10/2026-10-11-sdk-source-shared-wizard-guide-and-journal-corruption.md) | missing | open | 虽有分项 resolved 记录，整篇多问题未见全部销账。 |
| [2026-10-12-devicewizard-setstate-in-effect-lint.md](../../notes/issue/2026-10/2026-10-12-devicewizard-setstate-in-effect-lint.md) | closed | resolved | 原 closed；末尾明确 resolved，lint 恢复。 |
| [2026-10-12-network-switch-code-review.md](../../notes/issue/2026-10/2026-10-12-network-switch-code-review.md) | closed | resolved | 原 closed；四项修复与两项明确接受的批复语义均有处置，不将已接受语义误记为待修。 |
| [2026-10-12-no-single-instance-lock.md](../../notes/issue/2026-10/2026-10-12-no-single-instance-lock.md) | missing | resolved | 2026-10-22-windows-quit-stay-no-window 记录锁已落地；orphan 记录有 second-instance 真机实证。 |
| [2026-10-12-source-aware-filter-batch-review.md](../../notes/issue/2026-10/2026-10-12-source-aware-filter-batch-review.md) | missing | resolved | 文内记录 P2 四项、P3 八项均按用户批复清零。 |
| [2026-10-13-scrcpy-split-review.md](../../notes/issue/2026-10/2026-10-13-scrcpy-split-review.md) | missing | resolved | 文内明确 2026-10-13 已解决并链接修复计划。 |
| [2026-10-13-存量lint不干净.md](../../notes/issue/2026-10/2026-10-13-存量lint不干净.md) | missing | resolved | 文内明确 3ca39e1 已解决，lint/typecheck/1139 项测试验证。 |
| [2026-10-15-刚连上首操作画面冻结数秒.md](../../notes/issue/2026-10/2026-10-15-刚连上首操作画面冻结数秒.md) | closed | resolved | 原 closed；二轮实窗验收后关闭及修复记录。 |
| [2026-10-16-投屏回放无ACK恢复盲点.md](../../notes/issue/2026-10/2026-10-16-投屏回放无ACK恢复盲点.md) | closed | resolved | 原 closed；二轮修复有无 ACK 互等复现与恢复证据。 |
| [2026-10-16-解锁投屏修复-code-review.md](../../notes/issue/2026-10/2026-10-16-解锁投屏修复-code-review.md) | closed | resolved | 原 closed；三项发现修复与 1254 项回归记录。 |
| [2026-10-22-win32-hidden-non-x86-images.md](../../notes/issue/2026-10/2026-10-22-win32-hidden-non-x86-images.md) | missing | open | 一期接受并留后续提示改进，原不可见行为仍存在。 |
| [2026-10-22-windows-emulator-env-review.md](../../notes/issue/2026-10/2026-10-22-windows-emulator-env-review.md) | missing | open | WHPX 真机采样与 IPC harness 前半仍开放。 |
| [2026-10-22-windows-file-resilience-review.md](../../notes/issue/2026-10/2026-10-22-windows-file-resilience-review.md) | missing | open | P3-1/P3-2 明确未修。 |
| [2026-10-22-windows-process-mgmt-review.md](../../notes/issue/2026-10/2026-10-22-windows-process-mgmt-review.md) | missing | open | P3 延期且系统会话结束真机验收保留。 |
| [2026-10-22-windows-quit-stay-no-window.md](../../notes/issue/2026-10/2026-10-22-windows-quit-stay-no-window.md) | missing | resolved | 文内锁与唤回已实现；orphan 记录 P3 剧本终检已真机验证快捷方式唤回。 |
| [2026-10-30-windows-test-suite-platform-assumptions.md](../../notes/issue/2026-10/2026-10-30-windows-test-suite-platform-assumptions.md) | missing | open | 用户裁决暂不修 Windows 测试平台假设。 |
| [2026-10-31-orphan-emulator-after-app-restart.md](../../notes/issue/2026-10/2026-10-31-orphan-emulator-after-app-restart.md) | missing | open | adb 部分闭环但孤儿收养等原问题未见完整销账。 |
| [2026-10-31-shared-mode-bootstrap-button-misleading.md](../../notes/issue/2026-10/2026-10-31-shared-mode-bootstrap-button-misleading.md) | missing | resolved | 两轮修复含模式守卫、五步引导及 45 项向导测试。 |
| [2026-10-31-windows-acceptance-fixes-review.md](../../notes/issue/2026-10/2026-10-31-windows-acceptance-fixes-review.md) | missing | open | 仍开放下载守卫 win32 传参 IPC 直测。 |
| [2026-10-31-windows-dev-merge-integration-review.md](../../notes/issue/2026-10/2026-10-31-windows-dev-merge-integration-review.md) | missing | resolved | 2026-11-02 修复批逐项处置 P2/P3；过程教训无待修代码。 |
| [2026-10-31-windows-sdk-source-switch-matrix.md](../../notes/issue/2026-10/2026-10-31-windows-sdk-source-switch-matrix.md) | missing | open | 矩阵代码已修，后续迁移/回滚与残余备注未见整篇完整验收。 |
| [2026-10-06-向导独立窗口-review.md](../../notes/issue/2026-10-06-向导独立窗口-review.md) | missing | open | 加载生命周期已修，文末非 darwin 标题等决定仍保留；不整篇关闭。 |
| [2026-10-10-styled-refactor-review.md](../../notes/issue/2026-10-10-styled-refactor-review.md) | missing | resolved | 修复记录明确全部九项关闭。 |
| [2026-11-02-screenshot-editor-review.md](../../notes/issue/2026-11/2026-11-02-screenshot-editor-review.md) | missing | resolved | P3 busy ref 已在关联修复计划落地；Windows 基线由独立 issue 跟踪。 |
| [2026-11-02-windows-icon-master-edge.md](../../notes/issue/2026-11/2026-11-02-windows-icon-master-edge.md) | missing | resolved | 旧黑屏母版已被用户选定的新透明版替换，原问题资产不再使用。 |
| [2026-11-02-windows-test-baseline.md](../../notes/issue/2026-11/2026-11-02-windows-test-baseline.md) | missing | open | Windows 测试基线未修。 |
| [2026-11-02-worktree单实例锁互斥.md](../../notes/issue/2026-11/2026-11-02-worktree单实例锁互斥.md) | missing | open | worktree 数据目录隔离未实现，临时参数仅作绕行。 |
| [2026-11-03-actions-runtime-deprecation.md](../../notes/issue/2026-11/2026-11-03-actions-runtime-deprecation.md) | missing | open | Actions 运行时弃用仅记录。 |
| [2026-11-03-editor-refresh-comment.md](../../notes/issue/2026-11/2026-11-03-editor-refresh-comment.md) | missing | resolved | 2026-11-04 修复结果明确注释已更正并有回归。 |
| [2026-11-03-logcat-subscription-test-flake.md](../../notes/issue/2026-11/2026-11-03-logcat-subscription-test-flake.md) | missing | open | Logcat 偶发失败仍需时序核查。 |
| [2026-11-03-low-core-default-settings.md](../../notes/issue/2026-11/2026-11-03-low-core-default-settings.md) | missing | open | 低核默认 CPU 产品行为未改。 |
| [2026-11-03-publication-review.md](../../notes/issue/2026-11/2026-11-03-publication-review.md) | missing | open | hook、旧产品说明及测试偶发项未整体处置。 |
| [2026-11-03-screenshot-layout-review.md](../../notes/issue/2026-11/2026-11-03-screenshot-layout-review.md) | missing | resolved | 文末两项均已修复，Electron 布局与六场景配置验证在案。 |
| [2026-11-03-wireless-unreachable-diagnostics.md](../../notes/issue/2026-11/2026-11-03-wireless-unreachable-diagnostics.md) | missing | resolved | 后续无线诊断与恢复计划及验证记录已实现原始错误诊断；正式包权限等剩余验收由独立 hardware-validation 跟踪。 |
| [2026-11-04-screenshot-per-capture-review.md](../../notes/issue/2026-11/2026-11-04-screenshot-per-capture-review.md) | missing | resolved | 授权修复结果明确两项已修，无新增待处理问题。 |
| [2026-11-05-commit-msg-hook-not-executable.md](../../notes/issue/2026-11/2026-11-05-commit-msg-hook-not-executable.md) | missing | open | hook 权限仍只记录。 |
| [2026-11-05-wireless-recovery-code-review.md](../../notes/issue/2026-11/2026-11-05-wireless-recovery-code-review.md) | missing | resolved | 三项代码问题均销账，c2469d5 已合入 dev。 |
| [2026-11-05-wireless-recovery-hardware-validation.md](../../notes/issue/2026-11/2026-11-05-wireless-recovery-hardware-validation.md) | missing | open | 基础交互完成但正式包与硬件组合验收未全确认。 |
