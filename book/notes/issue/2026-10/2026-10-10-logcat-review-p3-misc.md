---
description: 日志面板 review P3 备忘——主窗宽度注释过时、快照导出面扩大、日志窗 URL 参数重复解析
created: 2026-10-10
status: closed
severity: P3
---

# 日志面板 review P3 备忘（三项）

## 1. createMainWindow 注释与行为不符

`src/main/window/index.ts` 建窗注释写「日志 dock 默认固定在右侧」——第三批反馈后 dock 已改为**默认收起**（不持久化）。注释误导后续维护者对默认行为的理解。建议下次动该文件时顺带订正（一行）。

## 2. currentDeviceSnapshot 扩大 devices 域公共面

`src/main/devices/index.ts` 新增导出 `currentDeviceSnapshot()`（全量快照：设备名、serial、健康状况）。当前唯一消费方 logcatContext 有日志窗 sender 守卫 ✓；但导出本身使未来任何域可无守卫取得。注释已声明「各域自行守卫」——新增消费方时必须守住，建议后续若消费方增多考虑收窄返回面（仅 running 设备的 id/name）。

## 3. LogcatApp 每渲染重复解析 URL 参数

`src/renderer/src/logcat/LogcatApp.tsx` 渲染体内 `new URLSearchParams(window.location.search)` 每次渲染重算（?device= 在窗口生命周期内不变）。无正确性问题，纯微开销；重构时可提为模块级常量。

## 备注

- 均 review（plan 2026-10-10-logcat-panel 正式 review 轮）发现，按 workflow 只记录不修复。

## 处置记录 — 2026-10-10

三项同批修复：① 注释订正为「dock 默认收起，展开/贴回时窄窗拉宽」；② `currentDeviceSnapshot` 全量快照导出移除，改 `listDeviceRuntimeViews()`（DeviceRuntimeView 窄视图：id/名称/status/serial/runId），logcat 域 deps 与 `logcatContext` 返回同步收窄，LogcatApp 广播侧同样窄化；③ `?device=` 解析提为模块级常量 `INITIAL_DEVICE_ID`。883 项测试通过，真机窄视图通路（context → 下拉空态）验证正常。
