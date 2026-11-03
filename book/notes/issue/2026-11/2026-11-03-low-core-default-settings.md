---
description: 少于四核的宿主会产生超出自身能力范围的默认模拟器 CPU 配置，首次发布 CI 暴露此问题
---

# 低核数宿主的默认 CPU 配置超出能力范围

- 观察：首次安装包 CI 的 macos-15 runner 只有 3 核；settings.test.ts 第 149、406 行归一化默认设置时得到 `cpuCores: CPU 核数需在 1–3 之间`。settings.ts 使用固定 DEFAULT_CPU_CORES=4，同时将 cpuCores.max 设为宿主 cpus().length。
- 复现：在 cpus().length 为 1–3 的环境调用 buildCapabilities，再将其 defaults 传给 normalizeAdvancedSettings；默认 cpuCores 超过当前能力上限。可使用独立测试桩复现，不需要实际启动模拟器。
- 影响：低核数宿主的默认高级设置可能无法直接通过验证；对产品创建流程的实际影响仍需单独确认。
- 建议方向：单独统一 CPU 默认值与宿主上限，并覆盖 1、2、3 核及正常多核边界。本次仅将既有设置测试的宿主条件显式固定为 8 核，未改变测试断言或产品行为。
