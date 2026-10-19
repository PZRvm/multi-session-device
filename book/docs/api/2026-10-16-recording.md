---
description: 录屏 IPC 实际契约——主窗任务快照、设置窗恢复提示、原生选择/结果与隐藏处理页专属 job 通道的权限边界
---

# 录屏 IPC（2026-10-16）

类型单源为 `src/shared/recording.ts`，通道名单源为 `src/shared/ipc-channels.ts`。preload 只暴露 `window.api.recording` 和专属 `recordingProcessor` 方法，不透出原始 ipcRenderer。

## 主窗

所有 invoke 校验已登记主窗 sender 且 senderFrame 是其 mainFrame。非法 payload/状态/身份以 reject 返回，UI 经 toApiResult 显示错误。

| 方法 / 通道                   | 输入                                                                               | 返回                                            |
| ----------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------- |
| start / recording:start       | `{deviceId: string}`，非空、最多 256 字符；serial 只由 main 查询                   | RecordingSnapshot；同步预占任务，准备在后台进行 |
| get / recording:get           | 无                                                                                 | 完成材料扫描后的全量 RecordingSnapshot          |
| command / recording:command   | `{taskId: string, command}`；command 只允许 pause/resume/stop/retry/reveal/dismiss | 全量 RecordingSnapshot；同任务串行              |
| onChanged / recording:changed | main 推送；订阅返回解绑函数                                                        | 同样的全量快照；先装订阅再 get                  |

RecordingSnapshot：revision（number，递增）、limit（number，首版 2）、tasks（RecordingTask 数组）。UI 拒绝更旧 revision。

RecordingTask 的必填字段：taskId、deviceId、deviceName（string）；state（starting、awaiting-silent-choice、recording、pausing、paused、resuming、stopping、queued、processing、saved、error、cancelled 闭集）；audio（preparing、available、silent）；durationMs、bytes、width、height、progress（number）。可选字段：canRetry（boolean）、fileName、error、interruption（string）。serial、临时绝对路径、最终路径与句柄均不进入快照。

- pause/resume 只在 recording/paused 合法；继续等待新关键帧，不复用旧截图。
- stop 幂等，采集与音频收尾后即可返回；queued/processing 不占采集名额。
- retry 只消费封存材料，不能重连旧任务；reveal 只接受已保存任务的 main 路径；dismiss 只关闭终态，失败材料删除需原生确认。
- 采音不可用的选择由 main 原生 dialog 处理；旧任务的迟到答复无效。不中途自动降成无声。
- 设备断连/声音中断保留 interruption；如有可解码材料，可生成带中断提示的结果。

## 设置窗与原生交互

`resetPrompts / recording:reset-prompts`：无输入，返回 `Promise<void>`。只允许已登记设置窗 sender 且为其 mainFrame；主窗、子 frame 和媒体处理页均拒绝。统一清除尺寸与无声提示的偏好，跨重启生效；不删除视频/材料，不停止任务。写盘失败 reject，设置行显示错误，不宣称恢复成功。

记忆只由 main 创建：尺寸提示以方向归一后的原尺寸/采集尺寸为条件；无声提示以 SDK 与稳定失败类别为条件。设备键采用 AVD id、可验证真机实体身份，或未知实体的单 transport 身份；JSON 中仅保存哈希键。未识别的 SDK/临时故障不永久记忆。用户取消/任务过期不记住，恢复操作递增代次，旧弹窗不能重新写回。resize/discard/退出确认不受此偏好影响。

成功/失败结果由 main 的通知队列呈现，非新增 renderer 通道。成功定位仍走受控 reveal；关闭成功结果只移除任务展示，不删 MP4；失败「稍后处理」保留材料，当前设备可重新生成。无可见主窗时保留队列，重新打开后展示；真正退出暂停结果弹窗，留在应用时恢复。不自动播放。

## 私有处理页

ready 只接受当前 main 创建的处理页主 frame，返回 `{jobId, token, width, height}`。其余方法同时核对 sender、主 frame、jobId/token，不接受文件路径。

| 通道                         | 额外输入 / 返回              | 守卫                                                                  |
| ---------------------------- | ---------------------------- | --------------------------------------------------------------------- |
| recording:processor-size     | 候选 width/height → 是否批准 | 偶数、正值、不得扩大、保持比例；缩小由 main 原生确认                  |
| recording:processor-pull     | seq → ProcessorFrame[]       | 序列严格递增、单次在途、最多 8 包/8MiB；只有通过尺寸选择才可拉取      |
| recording:processor-push     | seq + ProcessorPacket        | 同序互斥；编码数据 ≤8MiB、时长/时间戳有限有效、配置尺寸必须匹配批准值 |
| recording:processor-complete | 无                           | 输入已到 EOF、无拉取/写入在途；主进程仍检查完整输出时长及 finalize    |
| recording:processor-failed   | error string                 | 最多保留 4096 字符，保留原始录制材料                                  |

ProcessorFrame：data（Uint8Array）、keyframe、boundary（boolean）、codec（string）、timestamp/duration（number，微秒）。ProcessorPacket：data、type（key/delta）、timestamp/duration，和可选的 codec/codedWidth/codedHeight/description 配置。

身份过期、未知 task、重复采集、并发上限、非法状态、关键帧超时、AAC 不支持/中断、磁盘/封装失败、保存文件被移走均有明确失败路径。主窗不能冒充处理页，处理页不能开始录制、发设备输入或打开任意文件。
