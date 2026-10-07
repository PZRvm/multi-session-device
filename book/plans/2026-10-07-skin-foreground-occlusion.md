---
description: 按用户最新决定启用真实皮肤前景遮罩，让圆角和摄像头挖孔可以遮住视频
status: completed
created: 2026-10-07
---

# 真实皮肤允许遮挡画面

## Brief、分析与设计

用户本轮明确改为“模拟器有边框，还是允许被遮住”，覆盖此前完整视频不被皮肤遮挡的决定。

范围：共享皮肤方向模型补 foregroundMask；layout 按方向读取 foreground.mask；资源接口受控读取 mask；canvas 上方放对应透明前景，随视频方向转动。保持视频比例及现有屏幕矩形/输入坐标，遮罩 pointer-events:none。不增加通用外框的假挖孔，不改 AVD、下载、摄像头或视频协议。

本机 Pixel 7 mask.webp 实读为 1080×2400 RGBA：中心 alpha 0，圆角和摄像头区域 alpha 255。因此直接叠图，不能把整张 mask 当普通不透明底图；quarter-turn 使用已解析 display rotation 与缺方向时的附加旋转。

## 验证与收尾

先补失败测试：真实 layout 返回 mask，资源接口带 mask；竖横屏遮罩尺寸/转动与屏幕一致。实现后相关测试、typecheck、lint，生产组件回归确认遮罩在 canvas 上方、不接管输入。review 只记录，更新原约定并刷新 book 索引。


## 结果

真实 layout 的 foreground.mask 已进入共享模型和受控资源列表；canvas 上方叠透明图片，0–3 quarter-turn 与缺方向附加旋转均使用屏幕几何，pointer-events:none。视频尺寸和输入矩形不变。没有 foreground 的皮肤保持原有显示。

测试先复现了 mask 字段和资源缺失；实施后全量 398 通过、5 项既有跳过。typecheck、lint 通过，三进程构建通过。组件回归确认图片位于 canvas 上方、不拦截输入，切换通用外框移除遮罩；几何覆盖四种旋转和横屏回退。真实 Pixel 7 位图 alpha 已实读确认；本轮未重新启动用户 AVD，实际运行画面待重启 dev 后确认。

review 未发现本轮新增阻塞。之前占位 ZIP 的图片并非真实透明遮罩，仍只能测试导入链路；验收外观请使用官方素材。此前的完整视频截图属于旧约定证据，不作为当前挖孔/圆角效果证明。
