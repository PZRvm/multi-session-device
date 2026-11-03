---
description: 工具环境要显式注入、画布要区分流与布局就绪、scrcpy 回包要用与 writer 一致的解析器
tags: [jre, wizard, resize-observer, skin, scrcpy, clipboard]
---

# 五项修复的实现经验

画像枚举也是 SDK 工具调用。不能因 bootstrap 和创建已注入 JAVA_HOME，就认为查询会继承同一环境；缓存枚举、创建重核验、编辑能力都要显式传入 SDK 根。真实测试需同时清掉 JAVA_HOME 并移除 PATH 上的 Java，否则开发机 JDK 会掩盖问题。

隐藏窗口打开应返回“本轮就绪或失败”的 Promise。窗口身份、上下文、超时及清理绑定同一代次，旧事件只清理自己的资源；renderer 连点也需共用本轮结果，直到错误提示收口。

流 ready 和画布 ready 是两个条件。挂载初测与 ResizeObserver 必须采用同一内容区域口径；非零布局恢复前丢弃新输入。禁用已有输入时还要检查释放通路，不能只看禁用期间没有发送新事件。

文件字节限制不能约束位图解码资源。单图尺寸、像素和整套唯一素材预算一起检查，在导入、下载与展示读取三处复用；先拿真实官方素材验证预算。头部校验能提供尺寸预算，不能保证所有压缩内容能成功解码。

scrcpy 控制读侧先记录原始字节和消息元信息，再定位传输或解析。当前 ACK 是类型字节加 64 位序列号，clipboard 是类型字节加 32 位长度；优先使用与 writer 同一份协议库，避免手写偏移漂移。库 clipboard stream 有背压，必须持续消费才不会挡住后面的 ACK；本轮只丢弃同步内容。外层超时不会删除库内部 ACK resolver，需单独限制未确认数量。socket 写失败时库创建的 ACK Promise 也可能没有消费者，必须把失败清理作为独立验收条件。

实施与限制见 [计划](../../../plans/2026-10-09-remaining-issue-fixes.md)，review 新发现见 [留项](../../issue/2026-10/2026-10-09-remaining-fixes-review-findings.md)。
