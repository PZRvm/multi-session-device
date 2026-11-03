---
description: 输入释放要与新输入门控分开，控制发送同时观察 write/consumed/ACK，正常等待结束也要移除 abort 监听；皮肤别名以官方绑定和尺寸为证
tags: [input, scrcpy, clipboard, unhandled-rejection, abort, listeners, skin, aliases]
---

# 清理操作不能依赖正常操作仍可用

- **输入**：真实 Canvas 和输入 hook 的按下 → 布局归零回归确认，普通 send 的 disabled 门控把 release-all 一起挡住。释放单独放行，保存最后输入的 envelope/视频尺寸，发送前核对当前归属；旧代次由 main 释放，禁用期间的新操作仍丢弃。
- **控制发送**：安装库先等 write 再等 ACK，write 失败会留下无人观察的 ACK；Consumable 写入还有同型 consumed 缺口。局部 writer 复用库 serializer/parser，同时观察两个 Promise；上层收到发送失败后关闭会话，清 ACK 和计时器。旧实现三个回归虽断言通过，Vitest 仍报告 4 个未处理错误；修复后错误被正常返回，没有独立 rejection。
- **监听器**：历史清单归因于下载取消，本次 Node 20 全量 trace-warnings 的栈实际指向 runner 测试 sleep。默认 runner sleep 也仅在取消时清计时器，正常轮询会积累 abort 监听。生产等待移入 abort.ts，成功与取消都清监听/计时器，测试复用生产函数；同一 signal 连续 20 次等待，每次结束监听数为 0。不要把 once:true 当作正常结束的清理，也不要用提高上限消除警告。
- **皮肤**：12 个 Nexus 系列（含 Galaxy Nexus）及 2 个汽车别名来自仓库官方 XML 的明确 skin 字段，横竖交换后屏幕尺寸一致。14 份 layout fixture 与固定来源 c500183b708aedf521b05e304e0e7f8d771d22b1 的远端字节完全一致。先归一目录名再生成 URL、并发键与缓存键；别名不会重复下载。缓存和新获取均核验登记屏幕尺寸，名称相近或折叠画像不推测匹配。

实施与验证见 [修复计划](../../../plans/2026-10-09-remaining-code-gaps.md)。本轮只读官方资源并操作测试文件，未更改用户 AVD 或运行中的模拟器；模拟器内硬件取景等延期验收维持原状态。
