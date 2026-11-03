---
description: 录屏采用 Mediabunny 1.61.5 封装 MP4、独立 WebCodecs renderer 处理画布；设备音频独立采集与采样时钟，真机验收后移
status: accepted
created: 2026-10-16
---

# ADR-004：设备录屏媒体管线

录屏需要 MP4、设备声音、暂停续录和旋转后的最大画布。手写 MP4 封装器会引入轨道时间、索引和 codec 配置维护，采用 Mediabunny 1.61.5（MPL-2.0），版本锁定并随包分发许可。库源码不修改，主进程只写容器；WebCodecs 解码/编码仍在独立 renderer，遵守现有架构边界。无新增外部服务、FFmpeg 或本机原生编解码依赖。

视频订阅原 scrcpy reader 的原始包，不依赖活动视图、ACK 或可见 canvas。音频另开 playback/dup AAC 会话，独立 jar/scid/socket，只捕获设备输出并保持设备本地播放。不可用时用户明确选择无声或取消。

[P0](../poc/2026-10-16-recording-p0.md) 在两 AVD 十分钟样本发现原始 AAC PTS 长录漂移。采用首音频 PTS 锚定视频共同时间基准、后续按 ASC 中的采样率与帧样本数累计时间；原始 PTS 保留诊断。配置变化或实质断流明确中断，不在缺音频时悄悄删时段。

2026-10-16 用户批准先继续实现，将 Android 13+ 真机音频验收后移；同步目标 ≤100ms 不变，未验项不能标通过，plan 在交付验收前保持 in_progress。模拟器和现有 Android 12 真机的静音选择路径可先验证。

详情见 [plan](../../plans/2026-10-16-device-recording.md)。
