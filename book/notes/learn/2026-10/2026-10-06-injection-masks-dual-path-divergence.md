---
description: 测试注入让两侧共用同一份对象会抹平"双路径分叉"——单测全绿的双口径，集成后一边必拒；回归锚要断言"两侧消费同源产物"
tags: [testing, dependency-injection, capabilities, integration-gap, wizard]
---

# 注入抹平双路径分叉：单测全绿的集成级缺口

- **Scenario**: 向导能力查询（sdk:wizard-capabilities）在 handler 里给 buildCapabilities 的产物补齐 skinIds/webcamDeviceIds；创建事务（createDevice）用裸 buildCapabilities。真机上皮肤/摄像头选项在 UI 放行、创建必拒（P1）。但 devices/settings 的全部单测都绿——测试注入时两边用的是同一份 mock 能力对象，枚举齐不齐根本没有两个口径。
- **Why**: 依赖注入的价值是隔离副作用，但把"同一构造逻辑的两条消费路径"也一并隔离掉了——分叉发生在生产代码的两个组装点，注入把这个差异抹平，测试只能证明"给定相同输入两侧行为一致"，证明不了"生产上两侧输入真的相同"。这类缺口在单测层不可见，只有集成才暴露。
- **How to apply**: ① 把双路径收敛为单一入口（本例 buildEnrichedCapabilities，handler 与 createDevice 共用）——分叉的根因是两处组装，不是校验逻辑；② 回归锚断言"接线"而非"行为"：mock 唯一入口后断言 `normalizeAdvancedSettings 收到的正是 buildEnrichedCapabilities 的解析值`（同一对象引用），加上一条"富化能力过 / 裸能力拒"的双口径对照测试挂在纯函数层；③ review 时看到"同一名词在两处各自组装"就该查注入测试是否抹平了差异。
