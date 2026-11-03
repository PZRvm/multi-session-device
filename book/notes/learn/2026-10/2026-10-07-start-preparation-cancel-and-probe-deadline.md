---
description: ADB smart-socket 应按完整帧和总期限结束；启动准备需先登记，并在取消时丢弃迟到结果、释放预留
tags: [emulator, adb, startup, cancellation, lifecycle, race]
---

# 启动准备也属于可取消生命周期

适用：在 spawn 前还有 ADB、端口或其他异步准备，但界面已经显示启动中的流程。对应 [修复 plan](../../../plans/2026-10-07-adb-probe-and-start-cancel.md) 与 [原调查](2026-10-07-adb-fragmented-reply-hangs-ipc.md)。

只在 spawn 后登记实例，会让准备中的取消找不到任务。runner 现在在首次 await 前登记 preparation，相同设备的重复启动共享准备结果；取消/退出将其标为 stopping 并 abort，finally 释放预留。普通进程 entry 仍负责 spawn 后的 boot 和停止。

中止等待必须封住所有后续副作用。awaitWithAbort 在操作开始前检查 signal，监听 abort，同时观察底层 Promise 的迟到拒绝；PortAllocator 在被中止的探测等待结束时释放当前端口，迟到回包不会再次进入分配循环。取消完成前清理本次资源，随后同设备可重新使用该端口。底层共享 ADB 准备可能继续完成，取消不会杀共享服务；已撤销任务不会因此 spawn 模拟器。

devices 在准备前生成 runId 并传给 runner；状态回写校验这次代次。主动取消正常返回当前快照，不当成启动失败；真实准备失败清掉 serial、runId、startedAt 并恢复停止。开始 boot 探测前让接纳结果先交回，避免新增 Promise 层数改变事件与登记的顺序。

TCP 的 data 边界不是协议帧边界，socket inactivity timeout 也不是总期限。probeServer 持续拼接应答，完整帧即结束；end/close/error 都幂等收口，连接前启动 3 秒总期限。实际旧脚本的分段后关闭、半帧关闭、分段保持连接三组由挂起/误判变为正常解析或明确失败。

回归先红 12 项，修复后相关 98 项、全量 443 项通过。实际 API 32 分段后关闭能运行；延迟第二段时取消后停止、无 qemu，迟到应答不反弹，随后可重新启动。不要将受控复现可解释的症状，推广为没有收包证据的自然异常的唯一原因。

涉及源码：src/main/emulator/{adb,runner,ports,abort}.ts、src/main/devices/index.ts。
