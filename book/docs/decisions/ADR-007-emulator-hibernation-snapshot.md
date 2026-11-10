---
description: 模拟器休眠采用官方命名快照 + 进程退出的适配边界，版本化清单落在 AVD 目录内，能力按平台独立门控
---

# ADR-007: 模拟器休眠 = 官方命名快照 + 进程退出

| | |
| --- | --- |
| Status | Accepted |
| Date | 2026-11-06 |
| Plan | `book/plans/2026-11-06-emulator-hibernation.md` |

## Context

闲置模拟器仍占 CPU/GPU/内存；普通停止后冷启动丢失现场。用户选择"释放内存的休眠"：保存可恢复的桌面与应用状态后退出实例进程。候选方案与调研见 think-report 2026-11-06：原地 pause 不释放内存、OS 冻结平台分叉，均不满足目标；官方 VM 快照是现成能力。旧 Quick Boot 路径（default_boot + mtime 核验）没有休眠事务语义，且其稳定性门槛从未通过——不能复用为休眠。

G0 PoC 证据（emulator 36.1.9.0 build 13823996，M4 Mac，host GPU，隔离一次性 AVD，`book/docs/poc/2026-11-06-hibernation-poc.md`）：附录单机十轮 + 双机各五轮（双机全程在线、逐台串行操作，boot_id/前台应用/截图/输入全保留、端口干净释放、两机 boot_id 互不交叉）+ 失败矩阵：缺失快照 → **静默冷启动回退**（USER_INFO 提示、boot_id 变化）；损坏快照（截断 ram 文件）→ 加载器原生崩溃悬挂（既不 boot 也不 exit）；保存中 kill -9 → 半写快照不可加载；console kill 退出不覆盖所加载快照；快照目录只读 → 保存失败但实例存活；config 变化（RAM 2048→3072）后旧快照仍可加载（qemu 不拒绝，兼容性须由应用指纹校验承担）。Windows 与软件 GPU 未测——保持关闭。

## Decision

1. **快照适配**：休眠使用应用独占前缀的命名快照（`msd-hib-<代次>`），经 emulator console `avd snapshot save` 保存、`-snapshot <名>` 加载。恢复启动去掉 `-no-snapshot`（实测缺失快照名时 `-snapshot` 会**静默回退冷启动**，日志仅 USER_INFO 提示——必须靠 boot_id 复核拦截），并带 `-no-snapshot-save` 防御性兜底（PoC F4：console kill 退出未观察到覆盖所加载快照，二者均保留原现场；仍加此参数以排除任何自动保存路径）。保存完成判定不能依赖 console OK（OK 仅是受理，写盘异步、冷缓存下首字节可 >20s）——以快照目录「首字节出现 + 大小稳定」为准。不触碰 Quick Boot 的 default_boot。
2. **清单**：`<avd>.avd/msd-hibernation.json` 单文件承载休眠事实（schema version、设备 id、快照名、保存时间、guest boot_id、阶段、emulator 版本、镜像包、GPU 后端、硬件指纹）。原子写（tmp+rename），只由主进程读写；renderer 不传路径/端口/快照名。不迁移 devices.json。
3. **状态机**：DeviceStatus 扩展 `hibernating/hibernated/resuming`；主路径 running → hibernating → hibernated → resuming → running。失败不统一回退 stopped：保存失败实例仍活 → 回 running（尝试恢复媒体）；已保存但退出失败 → 留 hibernating 附原因与重试；加载失败 → 回 hibernated 附原因。丢弃（放弃休眠状态）是唯一回到 stopped 的显式路径（清快照 + 清清单）。
4. **提交协议**：保存前写 `stage: 'saving'`；console 保存返回 OK 且快照目录大小稳定后写 `stage: 'saved'`；进程退出且端口释放确认后写 `stage: 'hibernated'` 并投影设备状态。启动扫描把 `hibernated` 且无活体进程的记录投影为 hibernated；`saving/saved` 中断记录显示可解释错误，不静默重置 stopped。恢复成功（快照加载 + boot_id 相同 + ADB 就绪）才消费清单；旧快照清理失败只记重试，不回滚已恢复的运行态。
5. **删除守卫**：用户删除按钮仅 stopped 渲染；用户删除通道在最后一次异步加载之后、首个副作用之前同步核验 stopped。内部 SDK 级联清理走既有授权路径，不受 stopped-only 限制。
6. **能力门控**：`hibernationAvailable` 按平台 × GPU 后端声明。当前仅 Mac + host GPU 通过 PoC；swiftshader 等软件后端与 Windows 未验证，不展示可执行的休眠入口（带原因），不以 Mac 结果外推。

## Consequences

- 恢复必须核对 guest boot_id 与快照加载结果，不能只等 `sys.boot_completed=1`（emulator 自动回退冷启动时该值同样为 1）。
- 休眠/恢复与在途 ADB 恢复、SDK 迁移、应用退出互斥；保存前须释放输入/投屏/日志/剪贴板会话并排空截图副作用，拒绝录屏与 APK 安装。
- 快照占磁盘（PoC 单实例 ~1GiB 级）且镜像/emulator/硬件配置变化可使其失效——恢复前校验指纹，失效时提示，不静默删快照。
- 不承诺宿主总内存下降固定比例、不承诺外部网络/调试器会话无感续接。
