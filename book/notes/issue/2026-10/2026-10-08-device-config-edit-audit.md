---
description: 配置编辑审查发现恢复覆盖外部配置、目录 symlink 越界、全量旧值校验及 legacy 行为变化；黑屏另已修复
status: resolved
tags: [code-review, emulator, config-edit, transaction, legacy]
---

# 配置编辑实现审查

审查对象：`e134e16` 与 [配置编辑计划](../../../plans/2026-10-08-device-config-edit.md)。用户要求先修复已有设备黑屏，再检查是否修改了范围外配置。按 [workflow Phase 5](../../../guidelines/workflow.md)，本报告只记录后续问题，未扩大黑屏修复。

## 黑屏结论与当前设备

本次黑屏已定位并修复：两台设备共用的不透明皮肤前景盖住了视频，见 [修复计划与验收](../../../plans/2026-10-08-opaque-skin-black-screen.md)。安卓已启动，设备截图正常；当前事务目录为空，没有证据表明下列恢复问题造成了这次黑屏。无法从现有文件判定占位皮肤由谁写入。

编辑 patch 的正常差异映射不含 `disk.dataPartition.size`、镜像路径或画像身份，也未新增 wipe/recreate。当前两台 API 32 设备的配置容量分别为 `10G`、`6144M`，RAM 均为 2048 MiB；这只是当前配置目标值，不能据此推断历史修改或磁盘实际容量。本轮修复未改变这些文件。

## 优先处理的问题

### 1. P1：事务恢复覆盖第三种 config 内容（隔离执行确认）

[configTransaction.ts](../../../../src/main/emulator/configTransaction.ts#L139) 只比较当前元数据是否等于 old/newMeta。config 不等于对应目标时，直接写 old/newConfig，没有检查当前 config 是否属于记录中的两种内容。

隔离记录：oldConfig=`original=1`，newConfig=`updated=1`，当前 config=`external=1`，元数据仍为 oldMeta。调用真实恢复函数，返回 rolledBack，writeConfigRaw 收到 `original=1`，frozen 为空。外部第三种配置会被覆盖。newMeta 分支同样存在。

建议：同时核对元数据和 config 内容；第三种内容或缺失不能盲写，冻结目标并保留记录。读取/清理错误逐设备收口。

### 2. P1：编辑读写能跟随 AVD 目录 symlink（隔离执行确认）

[deviceConfig.ts](../../../../src/main/emulator/deviceConfig.ts#L24) 用 resolve 做词法包含检查，只 lstat 最后的 config.ini；writeAvdConfigRaw 没有独立路径核验。[保存守卫](../../../../src/main/devices/index.ts#L1350) 也没有即时复验 AVD/镜像健康。

在专用临时根中，将 `avd-home/a.avd` 链接到同一临时根下的外部目录：readAvdConfigRaw 成功读到外部 config，writeAvdConfigRaw 成功改写外部 config。正式设备未参与试验。

建议：重用对账的受控路径与健康核验，读、写和恢复均检查父目录真实路径、文件类型和 symlink；不能把上次扫描当作写入授权。写前检查仍需承认外部工具的竞争窗口。

### 3. P2：全量校验会强迫用户修改未编辑的旧值（函数执行确认）

[main 保存](../../../../src/main/devices/index.ts#L1863) 和 [编辑页](../../../../src/renderer/src/components/DeviceEditor.tsx#L170) 都把合并后的整套配置传给创建用 normalizeAdvancedSettings。计划要求只校验改动及关联字段，旧值未改时保留。

隔离调用：原 RAM 2048，当前能力下限 2560，仅把网络改成 lte，仍返回 ramMiB 错误；原存储 65536、当前范围上限 32768，仅改网络，仍返回 internalStorageMiB 错误。renderer 过滤存储错误而 main 不过滤，形成“页面可保存，main 拒绝”的分歧。已存失效皮肤、旧摄像头或超出当前能力的 CPU 也会阻断无关编辑。创建归一化还可能补记未提交的摄像头身份。

建议：按 diff 校验并合并；仅 RAM/heap 联动等真正关联规则扩展校验范围。只改名也不应被旧附加设置错误挡住。已有 Quick 修改附加设置转 Cold 是计划明确允许的行为，不能把它单独算作越界。

### 4. P2：真实 schema 解析为空，legacy 值被新建默认值替代（真实文件执行确认）

[readHardwareSchemaDefaults](../../../../src/main/emulator/deviceConfig.ts#L189) 期待字段名独占一行；本机 Emulator 37.2.12 的真实格式是 `name = hw.cpu.ncore`。调用真实函数返回 0 个默认值。[测试](../../../../src/main/emulator/__tests__/deviceConfig.test.ts#L214) 使用了错误的手写格式，因此未发现问题。

[buildEditDraft](../../../../src/main/devices/index.ts#L1485) 随后用 capabilities.defaults 填未知 RAM、CPU、heap，且生成完整 advancedSettings；未知存储虽然对外显示 null，内部草稿仍填创建默认容量，保存其他字段时会把该占位写进元数据。config 容量键不写，但已不符合“不用新建默认值补记”的要求。

建议：用所装 schema 的真实 fixture；Emulator 自动值或无法识别的值保持未知。legacy 无法无损形成完整配置时保留原语义或限制相关编辑。

### 5. P2：legacy 首次编辑可连带改变 GPU 启动策略（静态确认）

[legacy runner](../../../../src/main/devices/index.ts#L892) 对 advancedSettings=null 固定使用 host GPU；[legacy 编辑回填](../../../../src/main/devices/index.ts#L1534) 却优先读取 config 的 hw.gpu.mode。如果 config=auto，仅编辑网络并保存，会持久化 graphics=auto，[settingsToRunnerArgs](../../../../src/shared/settings-contract.ts#L281) 随后省略 `-gpu host`。未编辑 GPU 也改变了运行行为。

建议：回填和提交按“启动参数覆盖 → config → schema”的实际优先级构造基线；加入 legacy 仅改网络前后的 argv 比较。

### 6. P2：运行中打开编辑，停止后仍被旧阻断原因锁住（静态确认）

[DeviceEditor.tsx](../../../../src/renderer/src/components/DeviceEditor.tsx#L191) 在实时状态已 stopped 时得到 liveBlockedReason=null，又用 `?? snapshot.saveBlockedReason` 恢复初载“请先停止”。用户需要关闭重开窗口才能保存。

建议：把运行状态阻断与文件/事务阻断分开；实时停止状态应撤销旧的运行态阻断，同时保留真正的文件错误。

### 7. P2：不同设备保存摄像头缺少资源预留（静态确认）

[verifyEditableCameras](../../../../src/main/devices/index.ts#L1696) 在全局提交队列之前读取 devices 的占用；核验通过后未预留摄像头。两台设备并发选择同一空闲 webcam，均可在任一提交前通过，之后分别排队成功提交。同设备 editFlights 不能解决跨设备资源竞争。

建议：创建与编辑共用稳定身份的资源预留，覆盖核验至提交/回滚；无 webcam 且未改摄像头时不要强制枚举宿主相机。

### 8. P2：提交成功后的 journal 清理失败被反馈为保存失败（静态确认）

[commitMetasWithConfig](../../../../src/main/devices/index.ts#L1818) 已成功写 config 和元数据后，直接 await removeJournal；清理失败会向上抛错，broadcastChanged 不执行。页面保留旧草稿，重试又因指纹变化失败。

建议：成功提交后仍返回成功并广播；记录残留清理问题，由重启幂等恢复处理，不能把已提交误报为未保存。

## 其他检查记录

- RAM 规则用版本 startsWith('37.2.12')，未核验 Emulator build 或镜像 revision，也会误匹配 37.2.120；范围宽于报告的已实测组合。创建默认 RAM 仍按旧下限计算，可能低于新能力下限。见 [settings.ts](../../../../src/main/emulator/settings.ts#L40)。P3，后续限定证据边界并同步默认值。
- 计划 frontmatter 仍 draft、开头仍称未实现，下文却记录实现完成；应在配置编辑修复轮更新实际阶段，不能直接宣称功能验收完成。
- 全量测试 599 项通过、5 项跳过，但有 1 个未处理拒绝，整体非绿。单独运行未改动的 runner.test.ts 也复现：取消启动后隔一个 tick 才绑定 rejects 断言，Vitest 先捕获 StartCancelledError。runner.ts 与 runner.test.ts 本轮无改动；这是既有测试处理时序问题，另轮应先绑定拒绝观察再触发 disposeAll，不得忽略未处理异常来凑绿。

## 八项 review 覆盖

白名单映射和窗口 sender 绑定符合核心范围；未发现新增模型/API/存储写入口。权限边界见问题 2；竞态见 7；事务和通知见 1、8；旧值与边界见 3–6。复杂度主要集中在 devices 域的整套草稿重建，与创建契约复用没有落实编辑差异语义。修复前应先覆盖上述反例，再缩小实现。

## 2026-10-09 修复结果

本页保留历史复现；上述问题已由[安全修复轮](../../../plans/2026-10-09-emulator-config-safety-fixes.md)处理。

| 原问题 | 当前处理与回归证据 |
| --- | --- |
| 1 恢复覆盖 | old/new 元数据 × old/new config 双重裁决；第三种/缺失冻结，单设备读写/清理错误不阻断其余恢复 |
| 2 目录链接 | 根、直接父目录、config 的类型与真实路径检查，O_NOFOLLOW、独占临时文件及写前内容复验；附加设置保存即时核验健康 |
| 3 全量校验 | main 与 renderer 共用 normalizeEditedSettings；仅实际差异及 RAM/heap 联动参与，未改字段不归一化，改名绕过能力查询 |
| 4 schema/未知值 | 按真实 name = key 格式解析；未知值保持未知，无法无损构造的 legacy 只允许改名或明确恢复挖孔 |
| 5 GPU | legacy 草稿沿用运行时 host 优先级，仅改网络不会改 GPU config/argv |
| 6 运行态 | 快照状态与文件阻断分离，停止推送解除运行阻断；文件/事务冻结继续保留 |
| 7 摄像头 | 创建/编辑共用同步预留；竞争被拦截，提交/回滚后释放；未改旧相机不阻断 RAM/网络修改 |
| 8 清理反馈 | 两文件提交后清理失败仍成功广播，保留诊断；后续事务先清理旧记录，失败不覆盖证据 |

其他三项：RAM 精确匹配 37.2.12/37.2.12.0、build 16428233、API 34 default arm64 revision 2 与 pixel_8；默认值不低于有效下限。runner 测试先绑定拒绝断言再取消，全量未处理异常消失。原编辑计划改为 in_progress 并如实区分实现与未完成的完整验收。

边界：应用进程内互斥不能锁住外部编辑器；文件复验至 rename 仍有操作系统竞争窗口，不宣称跨进程原子 CAS。已有用户 AVD 未批量修改，内部存储编辑边界未放开。
