---
description: 已有模拟器编辑只归一化差异，恢复必须同时比较配置与元数据；官方工具与真实安卓状态需要独立验收
tags: [emulator, config-edit, transaction, legacy, cutout, package-xml, race]
---

# 编辑旧模拟器时，保留原值比补齐默认值更重要

- **场景**：旧 AVD 的设置不一定符合今天的创建范围；元数据、config、启动参数和安卓内部状态是不同来源。
- **编辑**：共享创建校验可复用规则，不能复用“整套归一化后覆盖”的提交语义。只合并实际差异；RAM/heap 才联动。旧 GPU 的真实基线要包含 runner 的 host 覆盖；未知 legacy 无法无损构造整套设置时限制编辑，不填默认 RAM/存储/相机身份。
- **读取**：hardware-properties.ini 的字段用 name = key 定义。测试 fixture 必须来自实际格式；根、直接 AVD 父目录和 config 均检查类型/真实路径，文件句柄有界读取，独占临时文件和写前内容复验减少外部竞争。
- **恢复**：journal 的 old/new 元数据和 old/new config 要同时比较。任一出现第三种内容或缺失就保留证据并冻结目标。两文件已提交后的清理失败属于维护失败，保存仍应成功广播；下次事务不能覆盖未清理记录。
- **并发**：摄像头检查与登记预留之间不能有 await；创建和编辑共用预留，覆盖提交与回滚并最终释放。
- **官方工具**：自己的 XML 解析器能读，不代表 avdmanager 接受。sys-img2/05 的 xsi:type、abis、每个 tag 的 display 都要齐；真实 API 37.2 多 tag 创建回归能补上单测盲区。
- **安卓状态**：删 skinRef 不等于清除安卓 cutout overlay。来源不能推断时提供明确恢复入口；只操作目标当前用户的内置模拟包。API 32 需要新 boot_id，旧 sys.boot_completed=1 不能表示重启已完成；overlay enable 的状态可见有异步延迟，真实测试要有界等待预期状态。
- **版本证据**：RAM 自动抬高只适用于已验证的精确版本、build、画像和镜像 revision。能力的 min 变动时默认值也必须满足 min。
- **偏差同步**：字段是否会写入，要同时比较表单、元数据和 config。用户要求同步时，即使表单没改，也要把有偏差的字段纳入校验；无偏差旧字段仍保留。采用文件值时，用实际 config 作 patch 基线，避免把 228M 等等价写法重写成 228。容量先按 MiB 语义比较，不把字符串写法不同当成容量变化；未知值保持未知，不能拿默认值冒充文件值。见[采用与同步计划](../../../plans/2026-10-09-config-mismatch-reconcile.md)。

回归工具：npm run test:emulator-config -- --sdk-root "/path/to/AndroidSDK"。测试只创建临时 AVD；SDK 升级后重跑尺寸/密度、皮肤选择移除及挖孔恢复，不修改用户现有数据盘。详细结果见[修复计划](../../../plans/2026-10-09-emulator-config-safety-fixes.md)。
