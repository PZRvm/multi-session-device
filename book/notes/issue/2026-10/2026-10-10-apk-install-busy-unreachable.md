---
description: P2：安装中再拖 APK 时 onDragEnter 无 phase 守卫，把 installing 打回 dragging——busyNote 分支真实会话不可达，忙被呈现为红色失败卡
status: open
priority: P2
tags: [apk, install, react, drag-drop, state-machine, review]
created: 2026-10-10
---

# APK 安装 busy 反馈路径不可达（dragenter clobber installing）

## 问题

`src/renderer/src/hooks/useApkInstall.ts` 的 `onDragEnter`（约 :89-98）不检查当前 phase：

```ts
const onDragEnter = useCallback((event: React.DragEvent): void => {
    if (!event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    window.clearTimeout(clearTimerRef.current)
    setPhaseBoth({ phase: 'dragging' })   // 无条件打回 dragging
  }, [setPhaseBoth])
```

真实拖放序列必然是 dragenter → dragover* → drop。安装中（`installing`）用户拖第二个 APK 进画布：

1. dragenter 把 `installing` 打成 `dragging`——进度 spinner 卡被 DropHint 高亮替换，进度指示消失；
2. drop 时 `phaseRef` 已是 `dragging`，走不到 `onDrop` 的 busy 分支（`phase === 'installing'` 才 setBusyNote），直接 `startInstall` 第二次 invoke；
3. main 每设备互斥拒绝（errors 域 `apkInstallBusy`），渲染成**红色 X 失败卡**「该设备正在安装另一个 APK」；
4. 第一次安装真正完成时，迟到的 `installed` 又把 `failed` 覆盖掉——用户看到失败闪一下变成功。

plan 需求表「安装中再拖 → 浮层提示『正在安装，请稍候』」（mainWindow 域 `apkInstallBusy` + 4 秒 busyNote）整条路径不可达。同一 clobber 还会清掉 `installed`/`failed` 结果卡（dragenter 一次即丢）。

## 复现

1. 设备 running，拖 APK A 进画布（进入 installing，spinner 转）；
2. 安装完成前再拖 APK B 进画布（真实会话必先 dragenter）；
3. 观察：spinner 消失 → 高亮 → 松开后红色失败卡「正在安装另一个 APK」→ 随后变绿色成功卡。

## 为何测试没拦住

`useApkInstall.test.tsx` 的「安装中再拖入」用例直接连续 drop 两次、中间没有 dragenter——`installing` 态直接收 drop 在真实浏览器会话中不可能出现。同文件 `onDragOver`（约 :105）有 `if (phaseRef.current.phase === 'idle')` 防 clobber，`onDragEnter` 漏了同款守卫。

独立 review（2026-10-10，plan 2026-10-10-drag-apk-install Phase 5）定级 P2：用户可见的错误行为，且串行反馈是 plan 需求项。

## 建议方向

- `onDragEnter` 补 phase 守卫：当前为 `installing` 时不改写 phase（保持 spinner），可直接顺手置 busyNote；当前已是 `dragging` 时为 no-op（顺带修掉结果卡被清的次生问题）。
- 补一条真实序列测试：drop#1（挂起 install promise）→ dragenter → drop#2，断言全程 `installing` 保持、busyNote 出现且 4 秒消失、无失败卡、drop#1 完成后转 `installed`。
