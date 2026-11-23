---
status: open
description: 同一物理手机 USB+无线双条目并存时，多 app 实例×多条目各建各的 scrcpy 会话，峰值 6 个并发编码器导致画面同步延迟（操作生效但画面滞后）
---

# 同屏多编码器并发（USB+无线双条目 × 多实例）造成画面同步延迟

- **观察**：2026-11-10 17:12 手机保持无线（192.168.31.162:5555）同时插入 USB（RF8XA011VNA），
  adb 同屏出现两条 device 条目；当时机器上还活着多个 app 实例（安装版 + 测试残留 dev 实例），
  每个实例对每条目自动 ensureSession——峰值手机上 **6 个并发 scrcpy server**（17:12:19-20 一秒内
  拉起 4 个），同一屏幕被编码 2-6 次。用户症状：操作全部正确生效（输入走控制通道，不经编码器），
  但画面明显滞后（设备侧多编码器争抢 MTK 硬编码器 → 出帧延迟）。
- **位置**：会话按设备条目（serial）建立（`src/main/scrcpy/session.ts` ensureSession），
  external track 对每条 device 态条目发 connected；同一物理设备的 USB/无线 serial 是两个条目。
  实例间无协调（单实例锁只挡同 app 二次启动，dev 回退隔离目录属设计）。
- **复现**：手机保持无线连接后插 USB，观察 `adb shell ps -A | grep app_process` 与
  `adb forward --list`——每个实例 × 每条目一对 server+forward。
- **建议方向**：a) 条目级去重——识别 USB/无线为同一物理设备（三星 serial ↔ wlan IP 可查证），
  提示用户二选一并互斥建流；b) 至少同一实例内双条目互斥；c) 会话数/编码器数上限与提示。
  另记环境因素：主机内存重压（swap 11.97/12GB）与 WindowServer 高占用放大画面侧延迟。
- **状态**：只记录，未改代码。
