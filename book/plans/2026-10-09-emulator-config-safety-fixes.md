---
description: 修复用户指定的前十四项配置安全、下载创建、编辑差异、摄像头并发、皮肤残留及文档问题
status: completed
created: 2026-10-09
---

# 模拟器配置安全修复

## Requirements brief

用户在本会话明确要求修复上一条清单的第 1–14 项，已给定技术上下文和建议方向，作为 Phase 2 → Phase 3 的开工依据。背景是已有设备编辑必须保留数据和未修改配置，不能以修复显示为由重建设备。

范围：config 读写与恢复、下载镜像身份文件、编辑草稿和差异校验、运行态阻断、摄像头预留、事务清理、皮肤挖孔恢复入口、RAM 规则、测试异常、SDK 升级回归与文档。

排除：不改机型/API/镜像身份和内部存储，不擦除或迁移数据，不批量重写用户 AVD，不开放 Quick，不执行清单 15–19 的完整验收，不提交或推送当前工作区。

## Impact range

编辑窗口 → shared 差异校验 → devices 保存互斥/资源预留 → config 安全写入与 journal → 元数据广播。下载器生成身份文件 → 官方 avdmanager 隔离验证。runner 启动准备/启动完成 → 屏幕尺寸保护与挖孔恢复。

主要风险：未知旧值被默认值取代、异步保存交错、外部文件变动、安卓挖孔无法追溯来源、取消后的迟到命令。所有实机验证使用专用临时 AVD；已有设备与已有未提交改动保留。

## Design

- 恢复同时核对 config 与 metadata 的 old/new 状态；第三种内容、缺失或读取失败冻结单目标。清理失败保留记录并继续其他目标。
- config 根、AVD 父目录、文件逐层检查普通类型与真实路径；写入使用独占临时文件，写前复验。保存前即时健康核验，不依赖旧扫描。
- 创建归一化保留；新增共享编辑归一化只接纳实际差异，RAM/heap 联动单独检查。未修改字段不归一化，不补摄像头身份。只改名绕过能力查询。
- schema 使用真实 `name = ...` 格式；legacy GPU 保持 runner 的 host 优先。不能无损构造完整旧设置时返回空附加草稿、说明仅可改名，绝不生成默认值落盘。
- 编辑快照分离运行状态和永久保存阻断；停止推送撤销运行态阻断但保留文件/事务错误。
- 创建、编辑共用同步摄像头预留，核验至提交/回滚期间持有，失败/退出释放。未修改摄像头不因旧枚举失效阻止无关编辑。
- 两文件提交成功后，journal 清理失败反馈保存成功并广播；保留清理诊断。下一次事务不得覆盖仍待清理的旧记录而失去证据。
- 皮肤只负责外观，继续固定设备自身分辨率；安卓挖孔的来源无法从旧文件可靠推断。对历史残留提供明确的恢复默认挖孔入口，用户选择后在目标下次启动恢复并等待重启完成；不无条件删除开发者设置。对应用可追踪的变更保留恢复记录，取消/失败可重试。
- RAM 下限只匹配已验证版本、build 和镜像 revision；创建默认值与有效下限一致。
- 修复测试的拒绝观察时序；提供隔离 SDK 升级回归脚本，检查真实 boot/尺寸/密度与选择、移除皮肤后的 overlay。
- 权限：恢复命令只给绑定设备的编辑窗，主进程复验；不增加任意 shell/文件 IPC。通知：保存与恢复结果经现有 changed/runtime-error 通道，保留用户草稿。

## Build order

1. 回归用例与配置路径/事务恢复修复（1、2、9）。
2. 镜像身份生成和官方工具隔离验证（3）。
3. 编辑差异、legacy、实时阻断、摄像头预留及 RAM（4–8、11）。
4. 挖孔恢复、SDK 升级回归与测试时序（10、12、13）。
5. 全量测试、typecheck/lint/build、结构化 review；更新原计划与 issue（14）。

## Test plan

正常、第三种 config/metadata、缺失、路径 symlink/非普通文件、清理失败；只改网络/名称保留旧值，legacy 不完整与 GPU host；运行→停止解锁、永久阻断保留；两设备/创建编辑摄像头竞争及失败释放；RAM 精确组合与默认值；package.xml 官方 schema 要素及真实创建；目标挖孔恢复、用户主动设置保留、取消/重启失败；全量无 unhandled rejection。

## Done criteria

- [x] 1–14 逐项有代码/文档和验证证据。
- [x] 相关测试和全量测试无未处理异常；typecheck/lint/build 通过。
- [x] 官方创建工具与皮肤选择→移除→重启隔离验证完成。
- [x] 八项 review 已记录，未扩大到清单 15–19。
- [x] 原计划和 issue 状态真实；learn 与 book 索引同步。

## 逐项结果

| 用户清单 | 结果 | 主要验证 |
| --- | --- | --- |
| 1 恢复覆盖外部配置 | 双文件 old/new 内容裁决，第三种或缺失冻结，记录保留 | configTransaction 的外部/缺失/单设备错误矩阵 |
| 2 父目录 symlink | 类型、真实路径、O_NOFOLLOW、有界读取与独占写入，写前复验；保存即时健康检查 | 临时 symlink 外部文件内容不变，非普通文件及 CAS 反例 |
| 3 package.xml | 五要素对齐官方 schema | 结构单测；API 32 与 37.2 多 tag 的官方 avdmanager 隔离创建 |
| 4 旧值挡无关编辑 | main/renderer 共用差异归一化，只联动 RAM/heap | 旧 RAM/存储/相机不阻断网络或名称，改动不合法资源仍拒绝 |
| 5 未知旧值变默认值 | 真实 schema 格式；不可无损识别 legacy 的附加草稿为 null | 仅改名保持 advancedSettings=null 与原 config |
| 6 legacy GPU | 沿用 runner host 基线 | 仅改网络前后 GPU argv/config 保持 |
| 7 停止后编辑仍锁定 | 实时状态与文件/事务阻断分离 | 运行→停止解除；永久阻断与草稿保留 |
| 8 摄像头竞争 | 创建和编辑共用同步预留 | edit/edit、edit/create 竞争拦截，失败释放 |
| 9 清理失败误报 | 提交后仍成功广播，下一次事务先清理旧记录 | 成功返回和 changed，清理持续失败不覆盖 journal |
| 10 挖孔残留 | 原生尺寸防新残留；编辑页明确请求恢复历史状态 | API 32 选择→移除→重启、主动挖孔保留、恢复与新 boot_id；取消/失败保留 pending |
| 11 RAM 规则 | 精确版本/build/画像/镜像 revision；默认值跟随 min | 37.2.120、未知 build/revision 不误匹配，默认值可通过校验 |
| 12 未处理拒绝 | 取消前先绑定拒绝断言 | 全量无 Unhandled Errors |
| 13 弃用显示参数 | 真实 SDK 升级回归命令已交付；保留弃用风险监测 | 生产 nativeDisplayArgs 与 runner 共用；当前 SDK 实测通过 |
| 14 文档阶段冲突 | 原编辑计划改 in_progress，区分已实现与完整验收 | 原计划、issue、learn 和索引同步 |

## Phase 4 验证

- npm run test：46 文件通过、3 文件跳过；646 项通过、6 项跳过，无未处理异常。跳过项需要显式环境开关，不是失败测试被屏蔽。
- npm run typecheck、npm run lint、npm run build 通过；git diff --check 通过。
- npm run test:emulator-config：Emulator 37.2.12（build 16428233）× API 32 default arm64 revision 2，完整隔离链路 57.57 秒通过。240×320 / 120dpi 保持，主动启用的 hole 普通重启保留，明确恢复后等待新 boot_id 且 overlay 禁用。
- 同命令 --image system-images;android-37.2;google_apis_playstore_ps16k;arm64-v8a --create-only：官方创建 1.12 秒通过，未冒充 API 37.2 boot 验收。
- 实机测试只写 mkdtemp 创建的 SDK/AVD，结束清理自身进程/目录；原镜像 package.xml hash 不变，既有外部 5554 实例未操作。

## Phase 5 八项 review

| 项目 | 结论 |
| --- | --- |
| 重复代码 | 编辑规则、真实显示参数与资源预留共用；未引入第二套任意配置写入口 |
| 授权/权限 | 恢复仅绑定设备编辑窗，main 校验布尔请求；ADB 核验目标、当前用户及内置包闭集 |
| 竞态 | 同设备 editFlights、跨设备摄像头预留、写前内容复验；afterBoot 可取消，runId 防迟到推进 |
| 事务边界 | journal 在写前持久化，提交后清理失败不撤销成功；pending 恢复成功后才清除 |
| 通知 | 保存成功广播；恢复完成才发布 running，失败沿用 runtime-error 并保留重试标记 |
| 边界 | unknown/null、RAM/heap、第三种内容、symlink、无 overlay、旧 boot_completed 已覆盖；旧偏差提示文案另记 P3 |
| 复杂度 | 新增受控恢复模块和隔离测试开关；未新增通用 shell/文件 IPC 或数据迁移 |
| 范围 | 完成清单 1–14；15–19 未执行；无擦除/重建/存储修改、提交或推送 |

review 新发现只记录：[偏差警告文案 P3](../notes/issue/2026-10/2026-10-09-config-mismatch-warning.md)，没有顺手修复。已知边界继续保留：外部编辑器不受进程内锁约束，文件复验至 rename 仍有竞争窗口；-skin 官方弃用风险由升级回归监测；挖孔历史来源未知，必须明确请求恢复。

## Phase 6 回写

原编辑计划保持 in_progress，因为应用/登录保留和所有附加字段的完整真实验收尚未完成；本安全修复计划按限定范围 completed。审查问题、package.xml 与取消拒绝记录已关闭；显示参数风险状态为 monitoring。stage 04 已完成步骤补充本次相关结果，不新增或转正阶段步骤。新增 learn 与 review issue，最后重刷并检查 book 索引。

## 2026-10-09 后续复查

[补充复查](../notes/issue/2026-10/2026-10-09-config-safety-followup-audit.md) 确认 4 项仍可复现：创建临时行落盘、清理失败后改名导致恢复误冻结、旧设备摄像头占用漏计、编号重排误拦截。前两项涉及持久化与恢复，建议优先处理。本计划保留此前实现与验证记录；这 4 项另行跟踪，不能据本计划的 completed 状态推断所有交错路径均已关闭。


原偏差提示 issue 已按用户后续需求在[采用与同步计划](2026-10-09-config-mismatch-reconcile.md)中解决；本计划 Phase 5 的“只记录”保留为当时结果。上述补充复查 4 项仍未关闭。
