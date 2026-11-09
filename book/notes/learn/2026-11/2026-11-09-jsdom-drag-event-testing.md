---
description: jsdom 下测试 HTML5 拖拽手势的三道坎——fireEvent 透传不了 clientY（原生事件 + defineProperty + act）、rect 桩要走原型级 spy、vi.mock fs 配 resetModules 别用 importOriginal
---

# jsdom 拖拽手势测试三道坎

适用：Electron renderer / React 组件里用原生 HTML5 DnD（dragstart/dragover/drop/dragend + getBoundingClientRect 中点锚定）的测试。来自 plan 2026-11-09-device-list-drag-reorder 实现轮。

## 1. fireEvent 的 drag 事件 init 到不了 clientY

jsdom 没有 DragEvent 构造器，`fireEvent.dragOver(el, { dataTransfer, clientY })` 里 `dataTransfer` 能挂上（TL 会补），**clientY 到不了 handler**（读到 undefined，比较恒 false，中点判定永远走同一分支——症状是 before/after 不可控）。原生事件直达：

```ts
const dragOverWith = (el: Element, clientY: number, dt: unknown): boolean => {
  const event = new Event('dragover', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clientY', { value: clientY })
  Object.defineProperty(event, 'dataTransfer', { value: dt })
  return el.dispatchEvent(event) // 返回 false = preventDefault 生效，顺带可断言
}
```

React 合成事件读原生属性，两个 defineProperty 都生效。**dispatch 后 state 未 flush**——不在 act 里发，setState 排队看不到 DOM 变化，要 `await act(async () => { dragOverWith(...) })`。

## 2. rect 桩走原型级 spy，别 per-element

`vi.spyOn(el, 'getBoundingClientRect')` 单元素 spy 在本仓库环境不生效（判定仍走 jsdom 零矩形）。项目先例是原型级（DeviceCanvas 系测试同款）：

```ts
vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
  return { top: this === target ? 15 : 0, height: 0 } as DOMRect
})
```

测试收尾 `vi.restoreAllMocks()`，防 mock 泄漏到同文件后续用例。

## 3. vi.mock fs/promises 配 resetModules 的组合：别用 importOriginal

`fresh()`（`vi.resetModules()` + 动态 import）模式下，`vi.mock('node:fs/promises', async (importOriginal) => ({ ...(await importOriginal()), ...mocks }))` 会在重导入时把**真模块**带进被测模块——测试里出现真实 `writeFile('/userdata/...')` ENOENT 告警，mock 断言全空。纯对象工厂 + `default` 别名兜底 CJS 消费者即可：

```ts
const fsMocks = vi.hoisted(() => ({ readFile: vi.fn(), writeFile: vi.fn(), rename: vi.fn() }))
vi.mock('node:fs/promises', () => ({ ...fsMocks, default: fsMocks }))
```

（import 图里有模块要 default 导出时缺 `default` 会直接炸 import——报错文案是 "No default export is defined on the mock"。）
