---
description: 这里怎么写 ADR——章节、命名、编号，以及什么决定需要一份记录
---

# 决策（ADR）

一份架构决策记录，回答将来的读者——人和 agent——都会问的问题：为什么是这样。

## 什么时候写

- 一个逆转代价很高的选择
- 一个理性的人可能做出不同选择的选择
- `guidelines/architecture.md` 里的边界规则被新增或修改

## 格式

| 章节         | 内容                                           |
| ------------ | ---------------------------------------------- |
| Status       | Proposed / Accepted / Superseded by ADR-NNN    |
| Context      | 做这个决定时的各种力量——约束、考虑过的替代方案 |
| Decision     | 选了什么，一两句话                             |
| Consequences | 什么变好了、什么变难了、我们接受了什么         |

## 命名

`ADR-NNN-<short-slug>.md`，编号单调递增，永不复用。逆转早先 ADR 的决定拿一个新编号，并把旧的翻成 "Superseded by ADR-NNN"。

实例见 [ADR-001](ADR-001-adopt-bocode.md)。
