# Multi Session Device {{VERSION}} Preview

面向 Android 测试的桌面工作台，支持独立模拟器、USB / 无线真机、投屏操控、截图标注、录屏和 Logcat。

## 下载与安装

| 平台                            | 安装包                                                   | 安装方式                          |
| ------------------------------- | -------------------------------------------------------- | --------------------------------- |
| macOS · Apple Silicon（M 系列） | `multi-session-device-{{VERSION}}-mac-arm64.dmg`         | 打开 DMG，将应用拖入 Applications |
| Windows · x64                   | `multi-session-device-{{VERSION}}-windows-x64-setup.exe` | 运行安装程序                      |

`SHA256SUMS` 提供两个安装包的 SHA-256 校验值。Android SDK 和系统镜像在应用内按需下载，安装包不包含这些大型资源。

## 当前状态

这是预览版。macOS 应用采用 ad-hoc 签名，尚未经过 Apple 公证；Windows 安装包未提供代码签名，系统可能显示来源或发布者提示。

macOS Apple Silicon 的基础模拟器与投屏流程已有验证；Windows 的部分集成验收、录屏长时间音画同步及部分真机音频仍待补齐。本次原生平台构建和包内校验通过，不代表所有硬件场景均已完成测试。

完整功能、平台边界和使用方法见 [README](https://github.com/PZRvm/multi-session-device#readme)。

项目采用 MIT 许可证；第三方组件与资源遵循各自的许可证。
