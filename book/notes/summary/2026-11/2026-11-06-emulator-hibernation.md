---
description: 模拟器手动休眠（官方命名快照+进程退出）与停止态删除入口的完整交付：协议实证、状态机、门控与验证证据
---

# 模拟器休眠与停止态删除（plan 2026-11-06-emulator-hibernation）

## 背景

闲置模拟器占 CPU/GPU/内存，普通停止后冷启动丢现场。用户选择"释放内存的休眠"：
保存官方 VM 快照后退出进程，恢复回到原桌面与应用（允许恢复稍慢）；另要求运行时
隐藏删除入口防误删。L 级：跨设备生命周期、共享 IPC 契约、持久休眠清单。

## 交付内容

- **协议（G0，先于实现）**：隔离一次性 AVD 上完成附录单机十轮 + 双机各五轮（双机
  全程在线、逐台串行=产品"一次一台"口径）+ 六项失败矩阵。关键实证：console save
  的 OK 只是受理（写盘异步、冷缓存首字节 >20s）；缺失/半写/**配置变化**快照都会
  **静默冷启动回退**（boot_id 变化）；损坏快照原生悬挂；退出不覆盖所加载快照。
  报告与原始事件流：`book/docs/poc/2026-11-06-hibernation-poc*`。
- **主进程**：新增 `emulator/emuConsole.ts`（greeting→auth→命令状态机、按命令发出
  点切分响应）与 `emulator/hibernation.ts`（`msd-hibernation.json` 原子清单、硬件
  指纹、快照稳定探测、退出后清理）。runner 增 `portOf/quit`（console kill 优雅退
  出，失败保留 entry）。lifecycle 增休眠/恢复/放弃三流：saving→saved→hibernated
  清单推进；保存失败实例仍活回 running、进程丢失回 stopped、退出失败留
  hibernating 可重试；恢复用 `-snapshot <名> -no-snapshot-save`（去掉
  `-no-snapshot*`）并以 guest boot_id 复核 + 指纹前置校验；取消恢复回 hibernated；
  放弃是回 stopped 的唯一显式路径。启动扫描把有效清单投影为 hibernated、中断/
  损坏/快照缺失解释为 stopped 附明确原因。
- **忙态与媒体（G4）**：休眠与该设备 APK 安装、录屏（含暂停）互斥（hibernationGate
  注入）；保存前释放已按下输入（scrcpy releaseInputs）、排空在途截图
  （waitScreenshotIdle）、经 beforeKill 桥拆除投屏/日志/剪贴板/网络轮询。
- **共享契约与 UI（G5）**：DeviceStatus 增 hibernating/hibernated/resuming；三条
  IPC 通道与 preload 桥；Device 行内休眠/恢复/取消动作 + 能力禁用带原因；已休眠
  画布占位（说明 + 恢复/放弃）；放弃走原生确认（说明"快照以外现场不再恢复、之后
  冷启动"）；简中/繁中/英文三语全量。
- **删除策略（G6）**：用户删除按钮仅 stopped 渲染（其他状态无 DOM/焦点入口）；
  确认前后双重复核最新状态；主进程用户通道在最后一次异步加载后同步拒绝非 stopped
  （零停止/删除副作用）；内部 SDK 级联（purgeAppOwnedDevices）走 internal 路径保
  留先停后删；移除"运行中先停止再删除"文案路径。
- **能力门控**：仅 darwin + host GPU（含 legacy 设备）；auto/软件后端/Windows 未
  验证 → 按钮与画布入口禁用并说明原因，不以 Mac 结果外推。

## 验证

- 自动：typecheck/lint 零告警；vitest 1640 通过（新增清单/console/runner quit/
  生命周期休眠流/行内与画布动作/删除守卫测试；既有删除用例改为用户通道拒绝 + 内部
  路径保留语义）。
- 真机：`MSD_SMOKE_HIB=1` 真模块冒烟（真 TCP console、真 fs 稳定探测、真进程退出、
  boot_id 复核）通过：save 10.1s(983MiB)/quit 2.1s/resume 2.1s，现场清零。
- 装配：隔离 userData（`--user-data-dir`）启动 dev 应用，主进程装配（含休眠门）无
  运行时错误、Vite 6175 正常服务；共享单实例锁未被改动（隔离目录自带独立锁）。

## 遗留与边界

- 评审轮三项发现已记录 issue（清单消费失败陈旧投影/编辑无前置提示/serial 残留
  毛刺），未随手修复。
- Windows 与软件 GPU 后端未验证，能力保持关闭；低磁盘未实测（以只读目录模拟保存
  失败路径）；UI 级人工点检（按钮逐个点击）未在本轮执行——逻辑层由组件测试与真机
  冒烟覆盖，建议下次真实使用时点一遍三语界面。
- 不承诺宿主总内存下降固定比例、外部网络/调试器会话无感续接（PRD 风险表同步）。
