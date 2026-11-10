---
description: 模拟器休眠 G0 原生快照 PoC：双机各五轮全通过；缺失/半写/配置变化快照会静默冷启动回退，损坏快照原生悬挂——设计以 boot_id 复核与指纹校验拦截
---

# 模拟器休眠原生快照 PoC（G0）

- 时间：2026-11-06 15:24–16:11（Asia/Shanghai）
- 环境：Apple M4（10 核 / 32GB），macOS 15.8；emulator 36.1.9.0（build 13823996，共享 Studio SDK 只读复用）；镜像 `system-images;android-36.1;google_apis_playstore;arm64-v8a`；画像 pixel_7，显式 `-gpu host`、`-no-window`
- 隔离：一次性 AVD（`msd_hib2_a/b`）于独立 ANDROID_AVD_HOME/ANDROID_USER_HOME/ANDROID_EMULATOR_HOME；端口 5710/5720（应用端口段之外）；全部进程由脚本 spawn 并收尾，未触碰用户实例。脚本：`/tmp/msd-hib-poc2/run.mjs`（临时，结论沉淀于本报告与 ADR-007）；原始事件流：[results.json](./2026-11-06-hibernation-poc-results.json)
- 单机十轮（附录前轮）：plan 附录已记录，boot_id/前台保留；本轮补齐双机与失败矩阵。

## 双机各五轮（双机全程在线，操作逐台串行——产品口径「一次一台」）

- 10/10 轮通过：每轮 save → console kill 退出 → `-snapshot` 加载，boot_id 与前台应用（Settings 主页）逐轮一致；两机 boot_id 互不交叉；退出后 console/adb 端口无 LISTEN（connect 探测，非 bind 误判）、无残留进程。
- 保存（OK 受理 → 首字节 + 目录稳定）：2.7–4.2s；恢复（spawn → ADB boot_completed/boot_id 可查）：1.6–3.3s；退出（console kill → 进程消失）：1.6–2.6s。恢复耗时不含产品投屏/输入链路重建。
- 资源：双机运行 ~5.2–5.9GiB RSS 合计；退出后宿主可用内存回升（采样见 results.json host_mem_*）。末轮快照 ~1.0GiB/台。
- 观察：round 5 B 机恢复后短暂 `adb: device offline`（数秒后随 final_exit 的 console kill 正常收口）——adb 连接窗口抖动，不影响状态保持；产品恢复流程以 ADB 复核 + 媒体重建兜底。

## 失败矩阵（A 机）

| 场景 | 结果 | 产品含义 |
| --- | --- | --- |
| 缺失快照 `-snapshot msd_missing_snap` | **静默冷启动**：日志 USER_INFO「performing a cold boot…」，boot_id 变化，进程正常起 | 只等 `sys.boot_completed=1` 不够——必须核对 guest boot_id（已实现于 afterBoot 复核） |
| 损坏快照（截断 ram 文件至 1/3） | `Loading snapshot…` 后 `length_error "vector"` 原生崩溃 **悬挂**（180s 既不 boot 也不 exit） | 恢复流程靠 boot 超时 + runner 失败收口回 hibernated；不能期望进程自行退出报错 |
| 保存中 kill -9 → 加载半写快照 | 快照未登记（「does not have the requested snapshot」）→ **静默冷启动回退** | 同缺失快照；boot_id 复核拦截 |
| console kill 退出（±`-no-snapshot-save`） | 退出后重载，前台保持保存时状态——**未覆盖所加载快照** | `-no-snapshot-save` 保留为防御性参数；休眠快照仅由显式保存产生 |
| 快照目录只读（模拟保存失败/低磁盘） | console 仍回 OK（受理），零字节；随后实例进程死亡 | 保存完成判定不能信 OK；流程的「保存失败→实例仍活恢复运行 / 进程丢失→stopped」两条收口都要存在 |
| config 变化（hw.ramSize 2048→3072）后加载旧快照 | `Error -1 from the snapshot callback / Failed to load snapshot` → **静默冷启动**（MemTotal 3GB=新配置，boot_id 变化） | qemu 不拒绝启动只回退——应用级硬件指纹校验必须在 spawn 前拦截（已实现） |

## 协议坑（脚本调试期发现，均为可复现事实）

1. `avd snapshot save` 的 console OK **只是受理**：写盘异步，冷缓存/双机下首字节可 >20s。完成判定 = 目录首字节出现 + 大小稳定（本轮 90s/180s 预算内全部命中）。
2. **运行中实例下删除快照目录再同名保存** → 返回 OK 但零字节。休眠快照必须每次唯一命名，旧快照仅在进程退出后清理。
3. console token 路径以 greeting 原文为准：本机即便设置 ANDROID_EMULATOR_HOME/ANDROID_USER_HOME，36.1.9 的 greeting 仍指向 `$HOME/.emulator_console_auth_token`。
4. bind 探测受 TIME_WAIT 干扰（附录已知）；本轮以 connect（LISTEN 语义）+ 进程探测复核端口释放，全部干净。

## 未覆盖（不据此开放能力）

- Windows（独立门槛，能力保持关闭）；软件 GPU 后端（swiftshader/angle/auto）；低磁盘真实填充（以只读目录替代模拟保存失败，实例死亡路径已覆盖）；恢复中取消（产品层事务，单测覆盖）；产品投屏/输入/日志链路的恢复后重建（G7 人工验收覆盖）。
