---
description: 自定义 hook 的返回对象不能进 effect 依赖（枚举态每次换引用 → 无限重拉 OOM）；devices 域测试里 runtime 状态必须真实驱动，store fixture 塞 status 无效
tags: [react, hooks, effect 依赖, vitest, devices 域, oom]
---

# hook 返回对象不入 effect 依赖；runtime 状态 fixture 无效

**场景**：`plan 2026-10-08-device-config-edit` 实现轮，把 DeviceWizard 的皮肤/摄像头资源逻辑抽成共用 hook 时踩到。

## 1. 自定义 hook 的返回对象是「状态容器」，不能整只进 effect 依赖

- **症状**：测试文件跑到 ~400 秒后 Node 堆 OOM（`Ineffective mark-compacts`）。不是断言失败，是资源耗尽。
- **根因**：hook 返回 `{ skins, reloadSkins, ... }` 对象；`skins` 是 state，每次 `setSkins(新数组)` 必然换引用 → hook 返回对象随之换引用（即使用 `useMemo` 收敛，依赖里的 `skins` 变了照样重建）。消费方 effect 写了 `useEffect(() => { reloadSkins() }, [data, page, resources])` → 拉取→setState→新 resources→effect 重跑→无限循环，每次都打一遍真实 IPC mock。
- **修法**：effect 依赖只放**稳定的函数引用**（`useCallback([])` 的 `reloadSkins`）或原始值：`[data, page, resources.reloadSkins]`。需要整只容器时，把动作从「拉取后 setState」改成「拉取后仅在内容变化时 setState」也只是缓解——依赖列表写错才是病根。
- **判别**：hook 返回对象里只要有 useState 派生成员，它就不是稳定依赖；`useMemo` 包一层只在「成员都不变」时稳定，任何 state 更新照样破功。

## 2. devices 域测试：runtime 状态（status/lastError/serial）不进 store，fixture 塞了也白塞

- **症状**：`readDeviceMetas.mockResolvedValue([{ ...device, status: 'running' }])` 后走 `readConfig`，期望 `saveBlockedReason` 提示「请先停止」，拿到 null。
- **根因**：`DeviceMeta` 是落盘形状，没有 status；域代码 `rebuildDevices` 对新 id 一律给 `stopped`。运行态只活在上层 devices 模块的内存里（architecture「主进程是唯一事实源」的直接后果）。
- **修法**：想测「运行中」必须真实驱动状态机——`startThroughPreflight()` + `devicesStart` handler 走完启动（health/webcam mock 给 valid 即秒过）。同理，任何依赖 `snapshotReadyAt` 变化的用例要经过 `commitMetas`，直接改 fixture 不会反映到域内存。
- **推广**：mock 适配层让 store fixture 看起来「什么都能塞」，但只有**同构于真实落盘形状**的字段才会被载入；runtime 字段是另一个世界的（learn 2026-10-08 对账轮第 6 条的同族问题——mock 全绿 ≠ 路径被覆盖）。
