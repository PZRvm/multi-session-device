---
description: 录屏 P0 的三个边界——独立 scrcpy 会话各持 jar 路径，WebCodecs decoder flush 后重新等关键帧，音画测试源按实际播放时间校准
created: 2026-10-16
tags: [recording, scrcpy, audio, webcodecs, poc, timestamps]
---

# 录屏验证要分清会话资源、解码边界和测试源延迟

## 原生提示记忆与结果通知的边界

Electron MessageBox 的 checkbox 只返回勾选状态，不自动持久化。按设备/条件记忆时，写盘前检查答复仍属于有效任务；恢复提示还要递增独立代次，使已打开弹窗的旧答复无法重新写回。原子文件替换仍需串行写队列，避免并发任务覆盖另一项选择。

原生完成通知归 main：媒体发布成功后才入队，一次显示一项；主窗关闭/reject 时保留待提示项，真正退出暂停通知，不能让保存后退出被新增成功弹窗拦住。renderer 卸载旧结果组件时，必须把任务订阅迁到 App 等稳定所有者。

macOS 上辅助文件不能只靠首字母大小写与组件区分：`recordingStatus.ts` 与 `RecordingStatus.tsx` 会让 TypeScript 的扩展名查找命中错误模块。使用不同词根（本批为 `recordingPresentation.ts`），不靠大小写表达组件/工具文件区别。

录屏 [plan](../../../plans/2026-10-16-device-recording.md) P0 中，视频会话建好后，再从同一设备 jar 路径启动 audio-only 会话，Android 16 发生 ClassNotFoundException / SIGABRT。视频 server 已按自身生命周期清理该 jar；第二会话必须独立 push 到自己的路径，并只清理自己的 forward/socket/进程。这是探针修正，不是 Android 16 不支持音频的证据。

WebCodecs VideoDecoder.flush 不适合作普通批次背压：flush 后下次 decode 需要关键帧。批次之间用 dequeue 控制队列；只在片段/配置边界 flush，并从配置+关键帧恢复。

合成闪光与短音若都按 Activity 启动时间调度，会把 AudioTrack 输出缓冲延迟当成录制不同步。首版源测出约 210–220ms；改用 AudioTimestamp 的 framePosition/nanoTime 驱动可见闪光后，首段录制样本为 20–60ms。这个结果仅覆盖早期样本，十分钟漂移和旋转/暂停后的结果另记 P0 报告，不能提前认定门槛全过。

## 长录复验不能用早期样本代替

两 AVD 连续 620 秒后，原始 AAC PTS 跨度相对实际采样时长多了 319–414ms；直接封装和旋转/暂停处理都出现长录偏差。保留共同起点、按采样数推进的候选在中/末段复验降至 90ms 内，但真实设备与静音中断尚未验证。完整结果见 [P0 报告](../../../docs/poc/2026-10-16-recording-p0.md)，不以候选样本通过提前宣布产品完成。

## 正式采集的旋转边界必须来自设备 PTS

正式录制接入 UI 后，配置变化时用“最后视频 PTS + 宿主收包间隔”封闭旧段，再从新关键帧开段，造成 150ms 级的重叠/空洞。多次旋转后出现数百毫秒偏差。连续配置重建应等新关键帧，以其 PTS 作为旧段 end 和新段 start；新段保留 continuous 标记，AAC 跨配置边界不丢整帧。暂停与停止才需要静止尾帧的宿主单调时间投影。两设备短录修订后，按解码音频帧 PTS 测得最大偏差 72/79ms。

能力试编码的 OffscreenCanvas 必须先 getContext 并绘制有效像素。直接从未初始化的画布构造 VideoFrame 会失败，不能把这类测试源错误报成“所有尺寸均不支持”。

同步测量导出原始 PCM 会丢包 PTS。按 ffprobe 解码帧的 pts_time/nb_samples 重建音频事件时间，保留轨道启动偏移与合法间隔；只在两轨均有完整上下文的窗口内配对，不能把停止边界截断的最后短音与前一个两秒前脉冲配对。门槛仍是 100ms。修订仪器复验旧材料：A 末段原始 PTS 362ms 未过、采样时钟 46ms 通过；B 中段原始 235ms、采样时钟 120ms 均未过。旧的 90ms 不能继续当全面通过证据，正式长录需重新测量。
