---
description: 录屏模块的实际落点——主进程媒体订阅/任务/临时段，独立处理页，下载目录发布与全局 UI 镜像；真机音频验收后移
---

# 设备录屏（2026-10-16 实现视图）

录制归属在 main，不在选中的画布。scrcpy reader 取得的原始包在活动视图/ACK 流控之前分发给录制订阅；不会把投屏回放缓存混入视频。切设备、主窗关闭都不改变任务的 deviceId/runId/streamId。

| 模块                                                                     | 实际职责                                                                                        |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `main/scrcpy/recording.ts`                                               | 只读源快照、带代次订阅、后台关键帧请求与结束通知；消费者失败不抛回视频 reader                   |
| `main/recording/index.ts`                                                | 主窗 IPC 白名单、原生无声/尺寸/清理提示和真正退出的三种选择                                     |
| `manager.ts`                                                             | 主进程任务事实源、命令串行、同设备/同实体去重、采集 admission、生成队列、恢复与重试             |
| `preferences.ts`、`prompts.ts`                                           | 按设备/条件记忆原生尺寸和无声选择；版本文件、串行原子写、恢复代次、过期答复检查                 |
| `notifications.ts`                                                       | main 串行结果队列；主窗不可见延后、原生成功/失败、定位/重试/稍后、退出暂停                      |
| `capture.ts`、`timeline.ts`                                              | 配置/关键帧开段、暂停时间移除、连续旋转边界、静止尾帧、AAC-LC 配置与采样时钟                    |
| `audioTransport.ts`                                                      | 独立 scid/jar/forward 的 playback/dup AAC 会话，保留设备本地出声                                |
| `segments.ts`                                                            | 有界二进制写盘、40 字节记录头与原始 PTS/映射 PTS、原子 manifest；读包流式有界                   |
| `source.ts`、`output.ts`                                                 | 按 manifest 映射两轨、兼容配置直接封装，否则统一最大画布；Mediabunny 1.61.5 写 MP4              |
| `processor.ts`                                                           | 单个独立隐藏 BrowserWindow、job/token/sender/序列与包预算守卫；从 main 拉包、向 main 回编码结果 |
| `renderer/recording-processor.html`                                      | WebCodecs 解码与 H.264 试编码/合成/重编码；不持文件路径或 Node 能力                             |
| `preload/api/recording.ts`、`shared/recording.ts`                        | 三进程类型与白名单桥，处理页和主窗互不冒用权限                                                  |
| `renderer/.../recordingStore.ts`                                         | 任务快照镜像，先订阅再 get，按 revision 拒绝旧响应                                              |
| `RecordingControls.tsx`、`RecordingIndicator.tsx`、`RecordingStatus.tsx` | 工具条操作、当前设备计时/生成反馈、两类列表录制状态；App 稳定订阅，顶部结果列表已移除           |

临时目录为 `userData/recordings/<UUID>`，包括 video.bin、audio.bin、manifest.json。片段 sourceStart/end/offset 使用微秒字符串，不序列化浮点秒。连续旋转以新关键帧 PTS 关闭旧配置段，并保持统一时间映射；暂停才移除区间。

全程视频配置兼容时直接 remux。配置/方向变化时，隐藏处理页按有效帧最大宽高建立黑底画布，原比例居中；先真实试编码，必须缩小时由 main 明确提示并记录批准尺寸。每批最多 8 包/8MiB，每任务写盘队列 16MiB，生成同时只一项；首版采集软件上限 2，不宣称硬件最大能力。

MP4 在系统 Downloads 的受控 `.part` 中 finalize 后，用同目录 link 无覆盖占名，重名递增。成功路径保留在 main；renderer 只能按 taskId 定位文件，不能传任意路径。失败保留材料供重试；重启只恢复材料，不重新采集。主窗 activate 依据主窗所有权重建，不因隐藏处理页仍存在而卡住。

录制请求只接受已登记主窗的主 frame。处理页按专属 sender/job/token 校验，不能控制设备或开始任务。真实退出先选择停止保存、留下或放弃，再进入原有设备/投屏清理。macOS 仅关闭主窗不会停止录制。

设置恢复通道仅允许设置主 frame。偏好保存在 `userData/recording-prompts.json`，只有哈希键；恢复只清偏好，不清媒体。原生结果关闭成功展示时不删视频，失败稍后保留素材。当前设备计时与 Logcat 同组排列、相隔 12px，左侧不同时展示多台时长。

实现与交付分开记录：[plan](../../plans/2026-10-16-device-recording.md) 仍为 in_progress；Android 13+ 真机音频按用户批准后移，当前开发验证不代替硬件验收。依赖决策见 [ADR-004](../decisions/ADR-004-recording-media-pipeline.md)。

本批交互实现与验证见 [交互 plan](../../plans/2026-10-16-recording-interactions.md)（completed），不改变父计划未完成的媒体验收。
