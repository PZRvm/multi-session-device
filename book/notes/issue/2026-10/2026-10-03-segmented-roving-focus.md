---
description: SegmentedControl 方向键切换后 DOM 焦点未随 roving tabindex 移到新选中瓣——键盘用户连按方向键无效
---

# SegmentedControl roving tabindex 缺焦点搬运

- **Observed**: 2026-10-03 stage 02 Phase 5 review 发现：`src/renderer/src/components/SegmentedControl.tsx` 方向键只改 store 值（`onChange`），`tabIndex` 虽随 `value` 移动（新选中瓣 tabIndex 0），但 DOM 焦点仍停在旧瓣上——旧瓣此刻 tabIndex 已变 -1，Tab 键再按会跳出控件，键盘用户连按方向键只有第一次生效后的焦点错位。
- **Reproduction**: Tab 聚焦分段控件 → 按右方向键 → 界面选中瓣移动，但焦点框（:focus-visible）仍框在旧瓣。
- **Suggested direction**: `move()` 里拿到 next value 后，经 ref 或 `document` 查询对应瓣并 `focus()`（radiogroup 惯例：方向键 = 选值 + 搬焦点一体）。影响面小（本阶段唯一使用方是 App 的亮暗切换），仅记录，不顺手修。

## 跟进（2026-10-03）——已修

按建议方向落地：`SegmentedControl.tsx` 增 ref Map（`useRef(new Map<T, HTMLButtonElement>())`），`move()` 在 `onChange(next.value)` 后对新选中瓣显式 `.focus()`。验证：新增 `SegmentedControl.test.tsx` 5 用例（vitest 首批真实测试）——方向键后 `document.activeElement` = 新选中瓣、wrap 循环焦点同步、连按跟随，全部转绿，`npm test` 7/7。标题勘误：原"连按方向键无效"表述过重——连按选值一直有效，失效的是焦点语义（详见正文分析）。
