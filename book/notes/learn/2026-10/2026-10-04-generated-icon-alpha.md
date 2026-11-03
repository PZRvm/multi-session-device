---
description: 生成式图标的透明外沿会残留杂点；同系列图标导出时复用参考 alpha 通道可固定圆角和留白
tags: [imagegen, icon, alpha, electron, 透明边缘]
---

# 同系列应用图标导出时复用参考 alpha

本次 imagegen 将浏览器窗口替换成手机，内部风格符合要求，但多次生成后透明外沿仍有细碎杂点，圆角和位置也有偏移。

生成工具负责内部图案；导出时对齐底板，将参考图标的 alpha 通道作为外轮廓。ImageMagick 的 `CopyOpacity` 可复制参考透明度，`compare -metric AE` 比较两个提取的 alpha 通道；本次 512×512 成品 AE=0。再从母版生成 ICNS/ICO，检查各尺寸能解码。
