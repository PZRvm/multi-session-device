---
description: 修复布局归零漏释放、控制写失败未处理异常、官方皮肤别名与监听器卫生；设备库和摄像头占用已确认完成，卡顿暂缓
status: completed
created: 2026-10-09
---

# 剩余代码缺口修复

## 需求与范围

用户确认待修清单第 3、4 项已完成，直接勾选；第 7 项 Pixel 7/API 34 卡顿暂不处理。此次在 `codex/fix-remaining-issues` worktree 实施第 1、2、5、6 项。

目标：投屏布局归零能释放已有按下状态；粘贴写失败与连接关闭不产生未处理异常；已核验的旧机型和汽车画像能匹配官方皮肤；定位全量测试的监听器警告并修复实际清理缺口。

范围限输入 hook、scrcpy 控制发送、官方皮肤匹配、下载监听器与对应测试。保留 IPC 权限、设备/会话/代次守卫、旋转丢弃输入、固定上游皮肤白名单、像素预算及既有取消语义。排除 GPU 卡顿、快照、跨平台、SDK 升级和其他延期验收；不改用户 AVD、剪贴板或运行中的模拟器。

## 分析

- 输入 hook 禁用后经普通 send 释放被 enabled 守卫拒绝，本地按下集合却被清空。
- 库 setClipboard 先注册 ACK，再依次等待写入与 ACK；写入失败时 ACK 无人观察。Consumable 写入同样先等 write 再等 consumed，失败时会遗留独立 rejection。
- 官方皮肤仅精确同名匹配。当前 SDK XML 明确记录皮肤名；本机 Studio layout 可用于逐项核对屏幕尺寸。只登记证实对应的别名，拒绝模糊推断与路径输入。
- 下载取消历史全量警告未在上一轮三个文件测试重现；先保留 trace-warnings 全量基线，再针对实际警告栈实施。不能靠提高监听器上限掩盖问题。

## 设计与实施顺序

1. **输入释放**：release-all 独立于新输入开关，仍使用当前合法 envelope 和视频尺寸，保留 main 权限/代次校验；禁用时释放旧状态、清 RAF 和 IME，不补发新输入。回归键盘及触点按下 → 归零 → 恢复 → 松开，以及旋转和卸载。
2. **控制写失败**：增加局部安全 writer 接缝，复用库 serializer 与 parser，立即观察写入/consumed 和写入/ACK 两组 Promise；发送失败及时关闭会话，清理 ACK 与计时器，保留原失败原因。覆盖同步/异步写 callback 失败、停止、关闭、迟到 ACK 与正常粘贴，断言一次收口且无未处理 rejection。
3. **皮肤别名**：登记 Nexus 旧画像及汽车画像的精确 id → 官方目录与屏幕尺寸证据。精确白名单优先；下载入口先归一到官方目录，再构造缓存键和 URL，别名与官方名共享任务/缓存。用官方 XML 和 layout 测试对应关系，不改变显示分辨率。折叠和未核验名称继续拒绝。
4. **监听器**：按基线栈确定来源，检查下载成功、取消、失败时监听器注册/解除；针对已证实路径补回归，再做最小清理。若全量也不能重现，记录结果，保持该项开放，不编造根因。

文件：`src/renderer/src/hooks/useDeviceInput.ts`、画布输入及 hook 测试；`src/main/scrcpy/controlWriter.ts`、`index.ts` 和控制发送回归；`src/main/emulator/skinSource.ts`、`skinSources.json` 和别名回归；下载监听器文件按诊断结果补入本节后实施。

2026-10-09 诊断补充：Node 20 全量 trace-warnings 复现 AbortSignal 上 11 个监听器，栈指向 runner.test.ts 的 abortableSleep；runner.ts 默认等待函数也有同样缺口。正常计时结束不移除 abort 监听，反复启动轮询会积累。将默认等待移入既有 `emulator/abort.ts`，成功/取消时都清理监听与计时器，测试使用同一生产函数；增加连续等待、取消、已取消的监听器数量回归。文件范围改为 `abort.ts`、`runner.ts`、`runner.test.ts`，不改下载逻辑。皮肤别名使用 XML 明确记录且尺寸核验通过的 12 个 Nexus 系列名称（含 Galaxy Nexus）、automotive_1080p_landscape、automotive_ultrawide；尺寸允许横竖对换。

## 验收与收尾

- 每批先写失败回归再实现，相关测试全绿；全量 test、typecheck、lint、build 和改动文件格式检查通过。
- review 按仓库八项检查，只记录新发现，不在 review 阶段修代码。
- 回写清单、stage 对应步骤结果及 learn，刷新 book 索引。第 1、2 项关闭后同步原五项修复 plan 的 B3/B5 状态；监听器未定位则明确保留开放，不把整份计划标为 completed。

## 进度

- [x] 输入归零释放及回归。
- [x] 写失败、ACK 与 consumed 统一收口及回归。
- [x] 已核验皮肤别名与下载缓存归一。
- [x] 监听器诊断与实际缺口修复。
- [x] 总门禁、review、清单与 stage/learn 回写。

## 实施与 review 结果

- 输入的 4 个归零回归先在旧实现失败；键盘/触点均能释放，RAF/IME 不补发，旧代次不向新代次释放。旋转回归仍由控制层释放旧键，不出现重复按键 Up。
- 写失败回归在旧库产生 4 个未处理错误；安全 writer 与会话清理后，立即/延迟 socket callback 失败均返回原错误，pending、计时器及 data 监听清空，迟到 ACK 不重复结算。正常 ACK、64 项预算、超时、关闭和停止回归保持通过。
- 14 个明确别名均通过官方 XML 绑定与 layout 尺寸检查；本机 fixture 与固定上游 ref 的远端 layout 字节全部相同。新增下载别名/目录名并发合并、缓存复用与尺寸不符拒绝回归。精确名称和路径白名单仍有效。
- Node 20 基线出现 11 个 abort 监听警告，栈定位到 runner 等待；默认生产函数同样遗漏正常结束清理。修复后连续 20 次等待监听数均为 0，取消及已取消不残留计时器；Node 20 全量复验不再出现警告。

最终门禁：Node 22 与 Node 20 全量均 786 项通过、6 项既有跳过，无未处理异常、无 MaxListenersExceededWarning；npm run build（含 node/web typecheck）与 npm run lint 通过。改动文件格式与 book 索引/卫生检查通过。依赖使用原 lockfile；首次安装 Electron 下载失败后，Node 22 安装完成，复用主仓库同版本 Electron 39.8.10 二进制。

八项 review 已核对重复代码、权限、竞态、事务、通知、边界、复杂度与范围，未发现需新挂账的明确问题。IPC/main 的归属和尺寸守卫保留，官方源 ref、字节/像素预算及原子入库未改变；测试没有削弱权限或事务断言。新增生产 writer 对已安装库 API 有依赖，升级库时应运行控制失败与真实 ACK 回归。

清单第 3、4 项按用户确认关闭，第 7 项暂缓；第 1、2、5、6 项已关闭。stage、原五项修复计划和 learn 已回写。未启动或修改用户 AVD，既有真实硬件与跨形态验收保持延期；本轮没有重新验收真实安卓内的粘贴效果或相机取景。改动留在独立 worktree，尚未合入 dev。

2026-10-09 用户确认本轮验收完成，随后重新审查本计划与皮肤网络补充修复的新增代码：未发现新增明确缺陷，148 项相关回归及 node/web 类型检查通过，见 [验收后审查](../notes/task/2026-10-09-剩余缺口验收后代码审查.md)。原延期验收范围保持原记录。
