---
description: 修复补充复查四项——创建临时行落盘、改名绕过残留事务清理、摄像头占用改启动时仲裁与虚拟场景回退
status: completed
created: 2026-10-09
---

# 配置安全补充复查修复

## Requirements brief

[补充复查](../notes/issue/2026-10/2026-10-09-config-safety-followup-audit.md) 确认 4 项缺口，其中摄像头两项已按同日与用户确认的[设计决定](../notes/issue/2026-10/2026-10-09-config-safety-followup-audit.md#2026-10-09-摄像头设计决定改启动时仲裁待实施)定向：不再保存时独占，改启动时仲裁加虚拟场景回退。用户明确要求编写计划并执行。

范围：`src/main/devices/index.ts` 的元数据提交基线与残留事务处理；摄像头资源预留的移除、编辑提示、启动仲裁与运行时回退通知；`src/shared/types.ts` 的运行态字段；`DeviceRow` 的通知展示；对应单测。

排除：不动恢复模块对真正外部第三种内容的保护；不改 `verifyWebcamsFor` 对托管设置失效摄像头的启动阻断；不做外部进程占用探测与两台真机同时预览验收（保持延期）；不提交或推送当前工作区（含并行开发中的配置偏差采用与同步改动，本计划只叠加不回退它们）。

## Impact range

- `commitMetas` / `commitMetasWithConfig`（写盘基线从全内存列表改为已接纳元数据，是创建/编辑/改名/删除/快照/挖孔全部提交路径的公共底座）。
- 摄像头预留（`reserveDeviceCameras` / `cameraReservations`）删除——创建与编辑共用的并发拦截随之消失，改由启动仲裁兜底。
- runner `beforeStart` / `extraArgsFor`——新增仲裁与虚拟场景参数覆盖；`verifyWebcamsFor` 枚举复用。
- 渲染层 `DeviceRow` 新增运行时通知行；快照类型新增 `cameraNotice`（仅内存，不入盘）。

风险：提交基线切换若漏掉某条 mutate 语义会丢已提交行——用全量回归兜底；仲裁读运行中设备的 config.ini 增加启动路径 IO（本地小文件，带取消与超时语义）。

## Design

### 1. 创建临时行不再落盘（复查 P2 第 1 项）

根因：两个提交器都从 `devices.map(toMeta)` 构造写盘草稿，把其他创建事务的 `creating` 临时行一并写入。

- `commitMetas` 与 `commitMetasWithConfig` 的草稿基线改为 `acceptedMetas`（最后接纳的已提交列表）：`draft = mutate(acceptedMetas)`。`acceptedMetas === null`（库 error 态，上游已被 `assertMetaWritable` 拦截）时防御性拒绝写入。
- 写盘成功后 `devices = rebuildDevices(draft)` 会丢掉在途临时行：提交器改用新助手 `rebuildWithPendingRows(draft)`——在重建结果后追加剧本 `devices` 中 `status === 'creating'` 且 id 不在 draft 里的行（仅内存，供创建进度展示与后续 `requireDevice`）。
- `acceptedMetas = draft`（直接采用写盘内容），不再 `devices.map(toMeta)`——否则临时行又会混进接纳基线。
- 每条 mutate 回调逐一核对：filter/map/spread 语义在 `acceptedMetas` 基线上与原全量基线等价（临时行本就不该出现在任何 mutate 的输入里）。

### 2. 残留事务记录与所有元数据提交共用（复查 P2 第 2 项）

根因：`pendingJournalCleanup` 只在 `commitMetasWithConfig` 内重试；仅改名走 `commitMetas`，改出的名字与 journal 的 old/new 都不一致，重启恢复误判第三种内容。

- `commitMetas` 写盘前对 draft 与 `acceptedMetas` 做 id 级 diff：两边都在且内容变化的 id，若命中 `pendingJournalCleanup`，先重试 `removeJournal`——成功则移出集合并继续提交；失败则中止本次提交并抛出可重试说明（设备名、记录未清理、建议重试或重启后按恢复提示处理）。devices.json 不动。
- 新增行（创建）不命中集合；删除行不设门（恢复模块对目标缺失的 journal 会自清理，且删除流已有自己的 journal 清理）；`commitMetasWithConfig` 维持现有"自身 id 先清理、失败即中止"语义。
- 恢复模块不改：对真正外部修改的第三种内容保护保持原样。

### 3. 摄像头占用改启动时仲裁（复查 P2 第 3 项、P3 第 4 项 + 设计决定）

**3a. 移除保存/创建时的独占拦截**

- 删除 `cameraReservations` / `reserveDeviceCameras` 及三个调用点（创建登记、编辑核验尾、两处 finally 释放）。
- `verifyEditableCameras` 保留所选摄像头有效性核验（存在且宿主身份一致），只去掉尾部的预留登记。
- 多设备绑定同一摄像头从此允许保存/创建。

**3b. 编辑草稿的非阻断提示**

- `readDeviceConfig` 组装 notes 后，对 draft 的前/后摄像头（webcam 模式）计算共享情况：其他设备（排除 creating/deleting）的有效绑定 = 其 `advancedSettings` 的摄像头（含宿主身份）或 legacy 读其 config.ini 的 `hw.camera.front/back`（复用 `parseLegacyCamera`）。
- 身份比较键：`hostDeviceId ?? 当前枚举 label ?? deviceId`（枚举失败退化为编号+宿主身份比较）。命中共享时把提示并入该字段 note.warning：同时绑定在设备「X」，两台同时运行时后启动的一方会自动改用虚拟场景。
- 提示只在确有其他 webcam 绑定时才触发摄像头枚举（`listWebcams` 有界 10 秒）；legacy 对端 config 读取失败按无绑定处理（提示漏报可接受，仲裁才是权威）。

**3c. 启动时仲裁与虚拟场景回退**

- 新增纯函数模块 `src/main/emulator/cameraArbitration.ts`：输入目标绑定、先启动设备绑定（front/back 各自 `deviceId` + 可选 `hostDeviceId`）、当前 webcamN→label 枚举与"枚举是否成功"标记；输出各槽是否回退与原因文案。
  - 比较键同 3b；两边都有宿主身份时以身份为准（编号重排不再误伤，复查第 4 项的修复）；键任一侧无法解析时退化为编号相等即冲突（保守）。
  - 先到先得：只有 startedAt 更早（同毫秒按 id 字典序）的运行中设备能使后启动方回退；并发启动结论确定性成立。
  - legacy 目标的死绑定（枚举成功且 webcamN 不在枚举、又无宿主身份）按"摄像头不存在"回退虚拟场景（设计决定对第 4 项的口径）；托管目标的失效摄像头仍由 `verifyWebcamsFor` 启动前阻断，行为不变。
- `beforeStart` 接线：`readAvdConfigRaw` 后解析目标摄像头；任一槽为 webcam 时枚举一次 `listWebcams`（结果同时供 `verifyWebcamsFor` 复用，避免双跑；枚举失败时托管路径沿用现有阻断语义，legacy 路径带"枚举失败"标记进仲裁，跳过死绑定判断）。
- 运行中对端绑定读取：对每台更早的 starting/running 设备读其 config.ini 解析（`awaitWithAbort` 可取消）；读取失败跳过该设备并 warn（仲裁是尽力而为，macOS 摄像头本可共享；不因读失败阻断启动）。
- 回退落点：结果存 `cameraOverridesByDevice`（按 id + runId 隔离，仿 `displayArgsByDevice`）；`extraArgsFor` 在托管与 legacy 两个分支末尾统一应用——已有 `-camera-front/-camera-back` 对则替换其值为 `virtualscene`，没有则追加该对。config.ini 不动，不产生文件级配置偏差。
- 运行时通知：`Device` 新增 `cameraNotice?: string`（仅内存不入盘；`rebuildDevices` 运行字段保留清单同步加入）。`startDevice` 进入 starting 时清空；仲裁命中时写入当前代次行并广播；`stopDevice` / `cancelStart` 收口、`handleUnexpectedExit`、退出清理时清除。`DeviceRow` 在 lastError 行下以警示样式展示 cameraNotice。

## Build order

1. 修复 1（提交基线）+ 回归；跑全量确认无既有路径回归。
2. 修复 2（残留事务门）+ 回归。
3. 3a 移除预留并改既有占用测试预期；3b 编辑提示；3c 仲裁模块、接线、类型与 DeviceRow 通知。
4. 全量 test / typecheck / lint / build。
5. book 回写：本计划逐项结果、issue 四项状态更新、stage 04 补结果行、learn 记录、`npm run book:index`。

## Test plan

- 修复 1：A 创建挂起（受控 avdmanager mock）时 B 改名/保存网络——落盘 JSON 不含 A；A 失败撤回后仍不含；A 成功后含 A、B。既有创建成功/失败回归全绿。
- 修复 2：提交成功但 `removeJournal` 失败一次后仅改名——重试清理成功且改名落盘；`removeJournal` 持续失败——改名被拒、devices.json 未变、行内可重试说明；重启恢复（journal 在、元数据为 new）不再误冻结。
- 摄像头：共享摄像头保存成功（原"占用拒绝"测试改期望）+ 草稿 note 含提示；仲裁纯函数覆盖身份比较、编号重排、保守编号、先后顺序、legacy 死绑定、枚举失败标记；startDevice 接线——对端运行中共享时 spawn 参数含 `virtualscene` 且行内通知出现，对端停止后重启恢复真实摄像头；DeviceRow 渲染通知行。
- 全量无未处理异常；typecheck / lint / build 通过。

## Done criteria

- [x] 复查 4 项各有代码与回归证据；issue 文档四项状态按实际更新。
- [x] 摄像头行为符合设计决定：可共绑、保存提示不阻断、启动先到先得、后启动方虚拟场景回退并透出原因。
- [x] 全量 test / typecheck / lint / build 通过，无削弱断言。
- [x] book 回写完成（stage、learn、issue、索引）；真机双开预览验收保持延期并如实标注。

## 逐项结果

| 复查项 | 结果 | 主要验证 |
| --- | --- | --- |
| 1 创建临时行落盘 | `commitMetas` / `commitMetasWithConfig` 草稿基线改 `acceptedMetas`，`rebuildWithPendingRows` 在内存保留在途临时行 | A 创建挂起时 B 改名：落盘 JSON 只有 B；A 失败撤回无幽灵记录；A 成功两行共存 |
| 2 改名绕过残留事务清理 | `commitMetas` 写盘前按内容 diff 命中 `pendingJournalCleanup` 的设备重试清理，失败中止提交并给重试说明；删除/新增行不设门（恢复模块自清理） | 清理失败一次后改名：重试成功且落盘；持续失败：改名被拒、devices.json 未变 |
| 3 旧设备摄像头漏计 | 移除保存时独占预留（`reserveDeviceCameras` 及三处调用删除）；仲裁与编辑提示都以实际 config.ini / 实际绑定为数据源 | 共绑摄像头保存成功 + 草稿非阻断提示；legacy 设备 config 绑定参与启动仲裁 |
| 4 编号重排误拦截 | 仲裁比较键：宿主身份优先、当前枚举次之、编号兜底；legacy 死绑定回退虚拟场景 | 纯函数 8 用例（身份/编号/枚举失败/先后/死绑定/双槽）；编号重排不再误伤 |
| 设计决定落地 | 启动先到先得：`beforeStart` 读目标与更早运行设备的实际绑定，冲突槽位经 `-camera-front/-camera-back virtualscene` 会话级覆盖（config.ini 不动），`Device.cameraNotice` 行内透出，停止/取消/退出清除 | 后启动方 argv 含 virtualscene + 行内通知；对端停止后重启恢复真实摄像头；`verifyWebcamsFor` 对托管失效摄像头仍阻断（行为不变） |

## Phase 4 验证

- `npm run test`：48 文件通过、3 文件跳过；689 项通过、6 项跳过（修复前 671 过 6 跳，净增回归），无未处理异常。
- `npm run typecheck`、`npm run lint`（0 error 0 warning）、`npm run build` 通过。
- 改动的既有测试只有两处预期翻转（独占拒绝 → 共绑允许），均为设计决定要求的行为变化，未削弱其他断言。
- 真机边界保持：两台同时预览的硬件表现、安卓相机预览仍在原清单 15–19 延期验收；本轮未启动真实模拟器。

## Phase 5 review（只记录）

- 受控重读（`rereadStore`）在创建进行中仍会从内存丢弃临时行——既有边界：最终状态由创建事务自己的提交修正，只有中间列表闪断；未扩大范围处理。
- 编辑窗打开时若存在其他 webcam 绑定，会额外跑一次摄像头枚举探针（有界 10 秒）；仲裁对更早运行设备的 config 读取为串行小文件读。当前规模可接受，未做缓存/并行化。
- 行内通知复用 `--board-ink-dim`（与 HealthLine 同视觉）；设计系统没有定义琥珀警示色阶，未私自加色。
- 测试挂具的坑（双 `freshDomain` 的 `handlerFor` 取首个注册、mock start 固定 runId 与按代次隔离的映射）已记 learn，供后续用例参考。

## Phase 6 回写

[补充复查 issue](../notes/issue/2026-10/2026-10-09-config-safety-followup-audit.md) 四项按证据关闭，设计决定一节标注已实施；stage 04 runner 步骤补一行结果；新增 learn 一条；`npm run book:index` 重刷。真机双开预览与相机取景验收保持延期，不因单测通过推断关闭。

## 2026-10-09 后续：真机复核 virtualscene 参数兼容性（用户报死机）

用户把摄像头设为虚拟场景后启动即死。隔离实测发现本计划的仲裁回退设计与编辑器写入形态都有真机缺陷（详见 [issue 真机复核节](../notes/issue/2026-10/2026-10-09-config-safety-followup-audit.md#2026-10-09-真机复核virtualscene-参数兼容性用户报启动死机)）：emulator 37.2.12 的 `-camera-*` 参数不接受任何大小写的 virtualscene（进程 5 秒 exit 1，错误只在 stdout），config.ini 只认小写 `virtualscene`（camelCase 静默零摄像头）。当日修正：`cameraConfigText` 统一写入小写、argv 对 virtualScene 不传参、仲裁回退改 `emulated`、drift/legacy 解析双写法接纳、runner 补 stdout 尾部捕获。隔离验证六场景全部符合预期（含小写 config 场景摄像头正常、emulated argv 正常）；全量 691 项通过、typecheck/lint 通过。经验入 [learn](../notes/learn/2026-10/2026-10-09-emulator-camera-arg-compat.md)。
