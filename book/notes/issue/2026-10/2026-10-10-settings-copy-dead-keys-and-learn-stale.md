---
description: 已修复：设置窗三语字典的 title/preview 死键已删，learn 笔记「open/close 桥」表述已更正为仅 open
status: resolved
priority: P3
tags: [settings, copy, i18n, learn-notes, review]
created: 2026-10-10
---

# 设置窗字典死键与 learn 过时表述

## 问题

原生三灯批次（2026-10-10）的 Phase 5 review 发现两处上批遗留的死内容：

1. `src/renderer/src/components/settings/copy.ts` 的 `title` 与 `preview` 键（三个语言各两条）已无任何消费方——它们属于早期「设置」标题行与「静态预览」标记，该标题行与标记已在窗口头调整批次移除，字典键漏删。字典完整性测试只查同键与非空，不查消费，故未拦截。
2. `book/notes/learn/2026-10/2026-10-10-electron-settings-static-preview.md` 中「窗口桥只提供受 sender 守卫的 open/close」一行，在原生三灯批次移除 close/toggle 桥后已过时（现仅剩 open）。

## 复现路径

1. 在 `src/renderer/src` 全量搜索 `copy.title`、`copy.preview`（或 `copy['title']`），仅测试文件以字面量「静态预览」出现，无组件读取。
2. 对照 `src/preload/api/settings.ts`，settings 域只剩 `open`。

## 建议方向

三语同步删 `title`、`preview` 两键；learn 该行改为「窗口桥仅 open，关窗与全屏归系统原生三灯」。两处均为无行为影响的清理，可与下一批设置窗改动合并处理。

按 workflow Phase 5「只记录，不修复」，本 review 未动这两处。

## 2026-10-10 修复

用户指示随后修复：三语同步删除 `title`、`preview` 两键，字典同键校验与全量测试通过；learn 该行更正为「窗口桥现仅剩受 sender 守卫的 open，关窗与全屏归系统原生三灯」。typecheck / lint 通过。
