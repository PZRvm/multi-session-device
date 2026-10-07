---
description: 修复已复现的 ADB 分段应答挂起与启动准备无法取消，覆盖迟到结果和端口清理
status: completed
created: 2026-10-07
---

# ADB 探测与启动准备取消

## Brief 与分析

用户要求修复 [问题报告](../notes/issue/2026-10/2026-10-07-api32-start-smoke-blocked.md) 已确认的原因。受控分段应答后关闭连接可稳定复现：probeServer 只接一次 data，且没有 end/close 收口，等待失去超时；runner 又在准备完成后才登记，导致取消找不到实例。

范围：修复共享 ADB 只读版本探测；启动准备立即登记并支持取消、退出清理；取消后迟到结果不再 spawn 或修改下一次启动，失败释放预留。沿用现有 IPC 和共享 server 复用策略。

排除：投屏/旋转输入、SDK/AVD 配置、设备元数据、外部模拟器、共享 server 重启策略、端口冲突重试流程、已有格式问题。上次自然异常没有收包证据，本次不将受控原因冒称为它的唯一触发。

## 设计

- probeServer 在连接前启动 3 秒总期限；connect 后写请求，持续拼接 data，完整帧即解析；error/end/close/总期限统一幂等结束并销毁 socket。连接建立和持续碎片都不能无限等待。
- runner 增准备登记表，首次 await 前入册。相同设备重复启动共享结果；取消将准备改为 stopping，AbortSignal 打断等待，任务 finally 清掉本次登记和预留；disposeAll 也覆盖准备任务。现有 spawn/boot/停止流程保持原样。
- 小型 abort 辅助函数结束等待并移除监听，同时观察底层 Promise 的迟到拒绝。只放弃本次等待，不终止共享 ADB 服务。
- PortAllocator.acquire 接可选 signal；serial/TCP 探测的等待可被打断，预留在异常时同步释放。底层探测迟到后不继续分配，也不删除后续启动的端口。
- devices 在准备前生成 runId 并交给 runner，事件可以识别本次启动；回写按此 runId 校验。主动取消正常返回现态，不弹启动失败；真实准备失败回停止并清掉运行字段。
- 源码范围为 emulator/{adb,runner,ports,abort}.ts、devices/index.ts；对应 adb/runner/ports/devices 测试。新增文件仅为两处共用的取消等待辅助，无新依赖或跨进程契约。

## 验收

1. 先补失败回归：分段应答后关闭、半帧/空帧关闭、无连接及持续碎片的总期限；准备期间取消、重复启动、退出、真实失败与迟到结果。
2. 取消时端口预留释放，迟到探测不再占端口或污染新启动；devices 主动取消不报错，旧结果不回写新代次。
3. 相关测试、全量测试、typecheck、lint、build、变更文件格式检查；使用报告中的同一注入方法做新鲜窗口回归，覆盖分段后关闭成功及准备期取消。
4. review 只记录；结果返写问题报告、learn、stage、plan，重刷索引并跑 release-check。

## 结果与 review

按设计完成五个源码文件及四个测试文件。probeServer 使用持续 data 监听、end/close/error 收口和连接前开始的 3 秒总期限；准备任务在首次 await 前登记，取消/退出中止等待并释放预留。devices 提前登记本次 runId，主动取消返回现态，旧结果不能覆盖新代次。

旧实现先出现 12 项失败：四项分段/关闭场景挂起、两项总期限缺失、端口取消不结束、准备登记/失败清理/取消/退出缺失。实现后相关四文件 98 项通过；新增共 15 项回归，包括 devices 取消无错误、迟到结果和提前 running 事件。全量结果：

```text
Test Files  36 passed | 2 skipped (38)
     Tests  443 passed | 5 skipped (448)
```

build（含 typecheck）、lint、变更文件 prettier、git diff --check 均通过。全仓格式的既有资料问题仍见 [原 issue](../notes/issue/2026-10/2026-10-07-fixture-readme-format-baseline.md)，本轮不修改。

用 [原复现脚本](../notes/issue/2026-10/2026-10-07-api32-start-repro-procedure.md) 在新鲜 dev 再测，分段后关闭已正常启动 API 32 并显示画面；电源关闭后恢复停止且无本次 serial/qemu。将第二段延迟 2500ms，准备期间取消后立即停止，迟到完整应答及 GC 后仍未生成本设备进程，也没有报错；随后重新启动成功。仅回 OKAY 后关闭则约 17ms 内明确拒绝启动，提示后保留停止和启动入口。组件原脚本四组均结束，分段关闭返回协议 41（33ms），半帧关闭返回未运行（32ms），分段保持连接也返回协议 41（31ms）；这些为本轮测量，不是固定耗时。

review 核对本次 diff 的资源所有权、准备到 boot 的交接、取消/退出、迟到回写、重复启动和共享 server 策略；权限与 IPC 契约未变，未发现本轮新增的可确认缺陷。未扩大到既有端口冲突重试、SDK/AVD 或投屏逻辑。

[问题报告](../notes/issue/2026-10/2026-10-07-api32-start-smoke-blocked.md) 的已确认缺陷关闭，[learn](../notes/learn/2026-10/2026-10-07-start-preparation-cancel-and-probe-deadline.md) 与 stage04 已返写。临时注入已删除，普通 dev 已恢复为停止占位，外部 API 34 emulator-5554 全程保留。上次自然异常的具体触发仍因缺少收包证据而未知。未提交 git。
