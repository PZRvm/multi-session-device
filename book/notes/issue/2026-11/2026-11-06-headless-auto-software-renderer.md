---
description: 当前 Mac 的 headless AVD 在 auto 模式实际选择 swangle_indirect，而 Studio 同镜像选 host，桌面动画持续卡顿
status: open
---

# Headless auto graphics selected software rendering on the current Mac

- **Observed**: 2026-11-06, the user reported sustained scrolling, animation and interaction lag after boot in this application, while Android Studio and USB/Wi-Fi physical-device mirroring felt smooth. This was a read-only investigation; no AVD settings/data, application code or running processes were changed.
- **Host**: Apple M4, 10 CPU cores, 32GB RAM, macOS 15.8; emulator 36.1.9. Both running AVDs use the same SDK and `system-images;android-36.1;google_apis_playstore;arm64-v8a`. They are different profiles/resolutions, not a controlled benchmark of the same AVD.

| Runtime fact | Application AVD | Android Studio AVD |
| --- | --- | --- |
| Profile | Nexus 5X | Medium Phone |
| Size | 1080×1920 | 1080×2400 |
| CPU / RAM | 4 cores / 2048MiB | 1 core / 2048MiB |
| Launch | headless, `-no-window`, no explicit `-gpu` | normal emulator, no explicit `-gpu` |
| Effective hardware-qemu.ini GPU | enabled=true, mode=swangle_indirect | enabled=true, mode=host |
| Live SurfaceFlinger GLES renderer | ANGLE Vulkan SwiftShader Device (LLVM 10.0.0) | Apple M4, OpenGL ES Translator, Metal |

## Cause and limits

`src/main/emulator/settings.ts` defaults graphics to auto. `src/shared/settings-contract.ts:294` omits `-gpu` for auto, while `src/main/emulator/runner.ts:306` always adds `-no-window`. The live launch matches that path. The automatic selection in this headless run chose software rendering; Studio chose hardware. This is the strongest observed explanation of the performance gap, not a measurement of how much each stage contributes.

Do not infer effective GPU use from config.ini alone: this AVD has `hw.gpu.enabled=no` and `hw.gpu.mode=auto` there, but effective hardware-qemu.ini says enabled=true/software and SurfaceFlinger confirms SwiftShader. Hypervisor.Framework is available (`emulator -accel-check` returned 0); CPU virtualization availability does not establish GPU acceleration.

Both AVDs have 2GB RAM. The app AVD had roughly 940MB logical swap backed by 297MB ZRAM at sampling; this can contribute to pressure but does not isolate a cause. Scrcpy adds capture/encoding relative to Studio's native display; no controlled encoding or frame-rate comparison was run. The physical device's smooth stream does not prove the emulator's rendering/encoding path is equally fast.

## Reproduction and next verification

Start an auto-graphics AVD through the app, inspect the process arguments and effective `hardware-qemu.ini`, then read `adb -s <serial> shell dumpsys SurfaceFlinger` for GLES renderer identity. Repeat on a Studio AVD to compare actual backends.

Use the existing device editor to select **硬件加速（host）**, fully stop and restart the AVD, verify its effective backend and GLES identity, then repeat the same gestures. No settings were changed and no restart was performed in this investigation, so the performance improvement is not yet verified.

For a later code task, evaluate mapping headless auto to the installed emulator's `auto-no-window` option versus an explicit hardware policy with visible fallback. Local `emulator -help-gpu` says auto-no-window uses the selection mechanism of a windowed auto launch. Preserve explicit software choices; do not silently assume every host supports hardware rendering. Official [graphics acceleration documentation](https://developer.android.com/studio/run/emulator-acceleration) identifies host as hardware rendering and swangle as SwiftShader software rendering. The installed binary's help governs available flags for this version.

Prior evidence: [2026-10-04 PoC](../../../docs/poc/2026-10-04-投屏链路PoC报告.md) measured 59fps with host versus 14fps with swiftshader_indirect on an earlier configuration; those numbers are historical and are not measurements of today's devices.
