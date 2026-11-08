---
description: headless 模拟器的 auto 不保证主机 GPU；当前 M4 实测 auto 选 SwiftShader，必须以有效配置和 SurfaceFlinger 核验
tags: [emulator, headless, gpu, auto, swiftshader, lag, performance]
---

# Verify the effective GPU backend when headless auto feels slow

- **Scenario**: Android Studio is smooth but the app's emulator is persistently slow, while physical-device mirroring is smooth.
- **Why**: on the current M4 with emulator 36.1.9, headless auto selected `swangle_indirect` and live GLES identified SwiftShader; Studio's auto selected host/Apple M4. CPU virtualization and GPU acceleration are separate. The AVD's config.ini did not describe the effective GPU backend accurately enough to diagnose this alone.
- **How to apply**: inspect launch arguments, effective hardware-qemu.ini and live SurfaceFlinger GLES together. Use explicit host as a controlled next comparison, verify its actual backend after restarting, and only then measure the same interactions. Local `-help-gpu` documents auto-no-window for windowed-equivalent auto selection. Do not claim the change has improved performance before performing that comparison.
- **Evidence**: [read-only investigation](../../issue/2026-11/2026-11-06-headless-auto-software-renderer.md). No application code or user configuration changed.
