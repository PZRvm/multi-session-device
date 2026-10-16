---
description: 双向剪贴板真实链路、解码与连续内存样本，用户人工验收通过；含 P2 修复前后微基准与最终验证结果
created: 2026-10-16
---

# 双向剪贴板验证记录

## 方法与结论边界

2026-10-16，在当前工作树使用真实 production main context、session、transport、writer 和 pinned scrcpy-server 3.3.3。Electron 来自本工作树 npm ci 锁文件安装（39.8.10）；没有修改依赖版本。建立三个独立会话：运行中的 Android 模拟器、荣耀手机 USB，以及同手机 Wi-Fi。测试仅回收本次 server/forward，未停止设备、重启共享 adb server，也未修改其他应用会话。

宿主使用真实 Electron clipboard；测试开始在内存备份支持的 text/html/rtf/image 格式，发现未知格式即拒绝覆盖，结束恢复标准格式。记录中不含用户正文、真机 serial/IP。设备端写入测试专用中英/表情/换行文本，使用独立 scrcpy 客户端的 setClipboard(paste=false, sequence=0)，主会话通过真实 Android clipboard change 通知收回。它验证真实双向协议和系统剪贴板，不等同用户长按复制或长按粘贴的 UI 验收。

第一轮模拟器双向各 10 次，USB/无线各 2 次；第二轮重复同样数量。两轮所有采样均小于 1 秒。电脑→设备时延包含 300ms 轮询与调度，设备→电脑包括服务端通知及系统读回。通过第二客户端收到的设备通知确认宿主→设备已更新，不以仅观察“发送成功”代替读回。

性能第一轮保留三个真实会话但不渲染，比较同一实现禁用/启用同步；第二轮用真实 useDeviceScreen/StreamDecoder 经 Electron preload + IPC 解码并绘制到 canvas，周期性下拉/收起模拟器通知栏制造交互。禁用/启用各约 60s；这是同一构建功能开关对照，不是两个发布版本对照。使用隐藏测试窗、关闭后台节流，不能替代完整主窗的人眼流畅度判断。

CPU 是 main 进程 user+system 时间 / 墙钟时间，百分比按一个逻辑核心计算，峰值是 1 秒桶；不代表整台机器百分比或 renderer/GPU 总 CPU。静态画面不持续编码，绘制总数不能直接当交互峰值 FPS。ready/error 是 screen 状态；useDeviceScreen 现有 onError 回调未提供独立解码错误计数，本测试不把 error=null 当成所有解码路径零错误的证明。

| 场景                            | 同步关闭                 | 同步开启                 |
| ------------------------------- | ------------------------ | ------------------------ |
| 不解码的 main 平均 CPU          | 3.076%                   | 2.409%                   |
| 有解码的 main 平均 CPU          | 2.244%                   | 2.164%                   |
| 有解码的 main 峰值 CPU（1s 桶） | 6.194%                   | 4.180%                   |
| 有解码段绘制帧总数              | 294（62.326s）           | 284（61.454s）           |
| 有解码段末状态                  | ready，error=null        | ready，error=null        |
| 有解码段 main RSS               | 147095552→123502592 字节 | 124633088→143212544 字节 |

这两轮没有观察到轮询带来的明显 main CPU 增幅，不能解释为同步提升性能。RSS 有波动，启用段增加约 17.7MiB，尚缺长期采样以判断是否收敛；不能据此声称无持续增长。完整 UI 和长期内存验收留项见 [issue](../../notes/issue/2026-10/2026-10-16-clipboard-sync-review-and-acceptance.md)。

## 原始数据

设备编号仅代表本轮：0=模拟器、1=USB、2=Wi-Fi。以下保留全部时延和性能数字；未记录正文。

### 第一轮

| 设备 | 电脑→设备 ms                                   | 设备→电脑 ms                            |
| ---- | ---------------------------------------------- | --------------------------------------- |
| 0    | 123, 342, 254, 39, 122, 79, 256, 180, 110, 183 | 26, 35, 44, 12, 11, 197, 58, 11, 30, 37 |
| 1    | 134, 173                                       | 11, 12                                  |
| 2    | 56, 197                                        | 22, 28                                  |

```json
{
  "syncDisabled60s": {
    "wallMs": 60057,
    "cpuMs": 1847.439,
    "cpuMeanPercent": 3.0761426644687546,
    "cpuPeak1sPercent": 5.9533,
    "rssBefore": 145047552,
    "rssAfter": 139640832
  },
  "syncEnabled60s": {
    "wallMs": 60101,
    "cpuMs": 1447.557,
    "cpuMeanPercent": 2.4085406232841384,
    "cpuPeak1sPercent": 6.3279,
    "rssBefore": 139935744,
    "rssAfter": 130023424
  }
}
```

### 第二轮

| 设备 | 电脑→设备 ms                                     | 设备→电脑 ms                                 |
| ---- | ------------------------------------------------ | -------------------------------------------- |
| 0    | 257, 151, 116, 131, 302, 243, 246, 561, 208, 134 | 158, 100, 179, 68, 31, 104, 187, 60, 106, 21 |
| 1    | 130, 47                                          | 21, 21                                       |
| 2    | 270, 184                                         | 35, 43                                       |

```json
{
  "renderSyncDisabled60s": {
    "wallMs": 62326,
    "cpuMs": 1398.781,
    "cpuMeanPercent": 2.244297724866027,
    "cpuPeak1sPercent": 6.1935,
    "rssBefore": 147095552,
    "rssAfter": 123502592,
    "startPaints": {
      "status": "ready",
      "paints": 0,
      "error": null
    },
    "endPaints": {
      "status": "ready",
      "paints": 294,
      "error": null
    },
    "paints": 294
  },
  "renderSyncEnabled60s": {
    "wallMs": 61454,
    "cpuMs": 1329.983,
    "cpuMeanPercent": 2.1641927295212677,
    "cpuPeak1sPercent": 4.1796,
    "rssBefore": 124633088,
    "rssAfter": 143212544,
    "startPaints": {
      "status": "ready",
      "paints": 294,
      "error": null
    },
    "endPaints": {
      "status": "ready",
      "paints": 578,
      "error": null
    },
    "paints": 284
  }
}
```

## 连续启用补充采样

为核对第二轮启用段 RSS 上升，使用最终源码重新打包同一真实解码测试夹具，连续启用 3 段各约 60 秒；每 5 秒记录一次 main RSS，保持相同通知栏交互。三段 main 平均 CPU 分别 2.475%、1.987%、1.898%，绘制帧数 392、333、322。RSS 第二段上升后第三段回落至 137936896 字节，未呈持续单向增长；这排除了仅凭上一轮两个端点认定“持续增长”的推断，但不是长时间泄漏证明。

```json
{
  "enabledPhase060s": {
    "wallMs": 60112,
    "cpuMs": 1487.598,
    "cpuMeanPercent": 2.474710540324727,
    "cpuPeak1sPercent": 4.6814,
    "rssBefore": 143851520,
    "rssAfter": 137822208,
    "rssSamples": [
      147947520, 143851520, 143310848, 133398528, 128827392, 136527872, 136052736, 135512064,
      135397376, 132431872, 134348800, 136151040
    ],
    "startPaints": {
      "status": "ready",
      "paints": 14,
      "error": null
    },
    "endPaints": {
      "status": "ready",
      "paints": 406,
      "error": null
    },
    "paints": 392
  },
  "enabledPhase160s": {
    "wallMs": 60106,
    "cpuMs": 1194.245,
    "cpuMeanPercent": 1.9868981466076598,
    "cpuPeak1sPercent": 2.9787,
    "rssBefore": 137887744,
    "rssAfter": 152682496,
    "rssSamples": [
      138330112, 139476992, 137953280, 140902400, 135806976, 140066816, 142950400, 145555456,
      146620416, 148602880, 149225472, 150978560
    ],
    "startPaints": {
      "status": "ready",
      "paints": 406,
      "error": null
    },
    "endPaints": {
      "status": "ready",
      "paints": 739,
      "error": null
    },
    "paints": 333
  },
  "enabledPhase260s": {
    "wallMs": 60091,
    "cpuMs": 1140.338,
    "cpuMeanPercent": 1.8976851774808208,
    "cpuPeak1sPercent": 3.6628,
    "rssBefore": 152682496,
    "rssAfter": 137936896,
    "rssSamples": [
      153272320, 152666112, 151863296, 151552000, 151076864, 146391040, 147472384, 149372928,
      148242432, 146735104, 143294464, 133414912
    ],
    "startPaints": {
      "status": "ready",
      "paints": 739,
      "error": null
    },
    "endPaints": {
      "status": "ready",
      "paints": 1061,
      "error": null
    },
    "paints": 322
  }
}
```

## P2 修复前后微基准（2026-10-16）

复用二轮 review 的探针：真实协调器、固定内存快照、30 次定时器回调；不读写真实系统剪贴板。

| 输入       | 修复前平均 ms/tick | 修复后平均 ms/tick | 读取次数（含首绑） | 发送次数 |
| ---------- | ------------------ | ------------------ | ------------------ | -------- |
| 1KiB       | 约 0.01            | 约 0.01            | 31                 | 0        |
| 8MiB 超限  | 17.55              | <0.01              | 31                 | 0        |
| 32MiB 超限 | 66.45              | <0.01              | 31                 | 0        |

修复后 8MiB/32MiB 输出为 0.00ms（探针四舍五入到两位小数），只能说明低于显示精度，不能解读为绝对零耗时。大小检查前置，超限正文不参与基线序列化或全文字节扫描；小于等于字符串长度预算的多字节文本仍核验 UTF-8 字节数。新增三项回归覆盖两类超限输入、恢复正常文本及临界值，最终全量 1272 项通过、6 项原有跳过；lint/typecheck/build 通过。

用户已确认完整主窗人工验收通过，P2/P3 修复后复审无新增发现，原 issue 已关闭。上文较早的待验文字保留为历史记录，当前状态以 plan 和 issue 的最终处置为准。
