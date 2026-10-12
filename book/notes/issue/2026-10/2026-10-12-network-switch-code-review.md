---
description: 断网开关批 code review（八项清单）——总体 pass；3 项 P3 已修复（解析降级/networkGet 刷新初值/mock helper）、2 项批复语义不修，处置记录在内
created: 2026-10-12
status: closed
---

# 断网开关批 code review（含 DeviceWizard 追加修复）

审对象：feature/network-switch-group `e603edf..9bb66d4`（src 21 文件 +996）与追加修复（DeviceWizard lint 豁免 4 行）。基线：1085 项测试全绿（6 项原有跳过）、typecheck 0 错、lint 全仓归零、build 通过、用户真机验收 ①–⑦ 通过。

## 八项清单逐项

| 项 | 结论 | 证据 |
| --- | --- | --- |
| 重复代码 | pass（1 项 P3 见下） | 域模块镜像 screenshot 结构为惯例复用非复制；4 个既有测试手写同形状 network mock（P3-C） |
| 授权 / 权限漏洞 | pass | `networkSet` 双守卫：`isMainSender`（主窗 webContents id 比对）+ 载荷白名单校验；命令串由 `buildSetCommand` 固定拼装（target 枚举 + 布尔），无用户可控命令注入面；`networkChanged` 仅推主窗（`getMainWindow().webContents`）；均有直测 |
| 竞态条件 | pass | 三层防线齐备且各有测试：main 同步占位互斥（连点第二发拒 `networkBusy`）、轮询在途不叠发（finally 重查防复活）、renderer busyTarget 静默吞 + main 兜底；`publishIfChanged` 比较与写入之间零 await，单线程内不可交叉 |
| 事务边界 | pass | 命令→读回非原子：读回失败返回 null 不判错、轮询 1s 补推（plan 定案语义）；无持久化写，无跨文件事务 |
| 漏掉的通知 | pass | set 失败原生 dialog（词条附 stderr）；busy/disabled 态齐；轮询静默失败为设计（plan 已记）；变化才推避免稳态噪音 |
| 漏掉的边界 | 1 项 P3（见下） | 解析已覆盖 0/1/2/'null'/垃圾/行数不足/CRLF（7 案直测）；P3-A 为三键缺一即整体失效 |
| 新增的复杂度 | pass | 新域 ~190 行 + 定时器每设备一个；`registerNetworkIpc` 返回句柄（轮询态随 register 闭包重建，测试免复位）是本批唯一新模式，有必要（轮询需要 deps 闭包） |
| 越出批准范围的改动 | pass（均已记录） | 4 个测试文件 mock 补齐（plan 偏差 1）、DeviceCanvas 渲染期派生自纠（偏差 2）、mainWindow 词条较 plan 多 2 键（P3-B）；DeviceWizard 修复为用户批准的追加批 |

## 新发现（只记录不修）

- **P3-A 解析全有或全无**：`parseNetworkState` 要求三键（airplane/wifi/data）全部为数字，任一键未设（`settings` 输出 `null`，如未来 wifi-only 平板/电视画像、或精简 AOSP 镜像）→ 整体读回 null → 轮询永不发布 → 三开关永久禁用。当前设备范围（蜂窝手机画像）三键都在，不触达。处置建议：按键级降级（`null` 行 → false），或触达时再改。
- **P3-B 词条超 plan 清单**：mainWindow 域实加 5 键（plan 列 3）——多出 `networkGroupAria`（分组可访问名）与 `networkToggleFailed`（失败弹窗标题），实现必需的合理增补，记录备查。
- **P3-C mock 形状四重复制**：`network: { set, onChanged }` 字面量在 4 个既有测试文件各手写一份（house 手写 mock 惯例的一致性延续）；若第五处出现可提炼共享 helper。

## 已在 plan Phase 5 登记不重复展开

- 刷新后初值不可达（仅变化才推）；飞行下 wifi 意愿态显示为开；`applyNetworkState` 不校验设备存在（快照剪除自愈）。

## 追加修复复核（DeviceWizard lint）

- 修法与同文件 391 行先例同款（`react-hooks/set-state-in-effect` 豁免 + 「写入即停不级联」注释）；不改渲染期派生的语义理由成立（选中须在共享态条件消失后持久）。无行为变化，41 项向导测试通过。

## 结论

**pass**（3 项新 P3 + 3 项已登记 P3，均不阻塞合并；发现只记录，处置等用户指示）。

## 处置记录（2026-10-12，用户批准「修复掉这些问题」）

- **P3-A 已修**：`parseNetworkState` 的 `toBool` 增加显式分支——settings 键未设输出 `'null'` 映射为该键 false，垃圾值（非数字非 'null'）仍整体放弃（保住「读失败不清态」的护栏）；解析测试两案更新（`'0/null/1'`、`'0/1/null'`）。
- **P3-1 已修**：新通道 `network:get`（仅主窗，返回 main 内存 `lastStates` 快照，不触 adb）+ preload `getAll` + store `applyNetworkStates`（合并后按当前设备表剪枝）+ App 挂载拉快照——renderer 刷新后初值 ≤1s 恢复。域单测 +1（快照返回/不触 adb/非主窗拒绝）、store 单测 +1（合并剪枝）。修复中踩一坑：get handler 首版同步函数直调时同步抛出（Electron 会包成 reject、vitest 直调不会）——改 async 对齐 set 通道。
- **P3-B 已修**：plan i18n 键清单对齐实际（mainWindow 5 键含 `networkGroupAria`/`networkToggleFailed`）。
- **P3-C 已修**：提炼 `src/renderer/src/components/__tests__/networkApiMock.ts`（含 getAll），4 个 App 级测试换用，后续 mock 扩键只改一处。
- **P3-2 不修**：飞行模式开启时 wifi 意愿态显示为开是批复语义（PRD 80 行与 think-report 写明「意愿排队，系统托管」）；改区分「意愿/实际」需换 dumpsys 级读回，成本不值且偏离批复。
- **P3-3 不修**：给 `applyNetworkState` 加设备存在性守卫会引入「推送早于快照被丢后不再补发（仅变化才推）」的真故障模式，劣于现状「stale 键下次快照剪除自愈」；且无实际触达路径（推送仅来自本应用 watch 的 running 设备）。
- 验证：新增 2 项测试、全量 **1087 项通过**（6 项原有跳过）、typecheck 0 错、lint 归零、build 通过。
