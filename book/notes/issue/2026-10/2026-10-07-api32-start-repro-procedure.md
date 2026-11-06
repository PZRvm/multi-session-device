---
status: resolved
description: 启动挂起报告的可执行复现附录：临时 ADB 分段应答注入、完整应答对照与生产探测函数验证
tags: [emulator, startup, adb, reproduction, diagnostics]
---

# 启动挂起的复现命令

对应 [问题报告](2026-10-07-api32-start-smoke-blocked.md)。这些脚本是诊断注入，不是修复；只在仓库根执行，保留现有 SDK、AVD、设备元数据和共享 adb server。

同日已完成修复：下面的异常预期是旧实现的调查记录。当前代码的 split-close 应正常启动，partial-close 应明确失败并恢复停止；修复后实测见主报告，不再期待挂起或丢回复。

## 实际窗口复现与对照

先停止本次验证设备并退出已有 dev。若应用进程退出不完整，检查 PID、父子关系和 cwd 后，仅结束本次诊断的 Electron/dev 进程，避免两个相同标题的窗口混淆。不要停止外部模拟器或共享 adb server。

创建临时预加载脚本：

```sh
task_repro_dir=$(mktemp -d /tmp/msd-start-repro.XXXXXX)
cat > "$task_repro_dir/adb-reply-shim.cjs" <<'JS'
if (process.versions.electron && process.type === 'browser') {
  const net = require('node:net')
  const v8 = require('node:v8')
  const vm = require('node:vm')
  const mode = process.env.MSD_REPRO_ADB_MODE || 'split-close'
  const originalConnect = net.connect
  const log = (event) => console.log('[adb-repro]', new Date().toISOString(), event)
  v8.setFlagsFromString('--expose-gc')
  const forceGc = vm.runInNewContext('gc')
  const server = net.createServer((socket) => {
    socket.once('data', (request) => {
      log('request=' + request.toString())
      if (mode === 'whole-close') socket.end('OKAY00040029')
      else {
        socket.write('OKAY')
        setTimeout(() => socket.end('00040029'), 30)
      }
    })
  })
  server.listen(0, '127.0.0.1', () => log('ready mode=' + mode))
  net.connect = function (...args) {
    const options = args[0]
    if (options && typeof options === 'object' && options.host === '127.0.0.1' && options.port === 5037) {
      const socket = originalConnect.call(net, { ...options, port: server.address().port }, ...args.slice(1))
      socket.on('data', (chunk) => log('data=' + chunk.toString()))
      socket.on('timeout', () => log('timeout'))
      socket.on('close', () => {
        log('probe socket closed')
        setTimeout(() => { log('force gc'); forceGc() }, 1000)
      })
      return socket
    }
    return originalConnect.apply(net, args)
  }
}
JS
```

分段组启动命令：

```sh
NODE_OPTIONS="--require=$task_repro_dir/adb-reply-shim.cjs" MSD_REPRO_ADB_MODE=split-close npm run dev
```

确认 ready 日志，左侧点击启动，记录状态、进程与错误。挂起后点击取消，记录连带失败。GC 用于缩短 IPC ReplyChannel 被回收后的报错等待；不改变探测函数，亦不模拟真实环境的发生率。

退出分段组诊断进程，保留同一个 shell 的 task_repro_dir，使用对照命令：

```sh
NODE_OPTIONS="--require=$task_repro_dir/adb-reply-shim.cjs" MSD_REPRO_ADB_MODE=whole-close npm run dev
```

对照应正常启动。两组运行期间可以用应用自有 adb devices 和 ps 记录诊断设备的 serial/qemu；这个预加载只改 Electron 主进程的 JS connect，不拦 SDK adb 子进程，不绑定或更改真实 5037 server。

结束后停止本次启动的设备，退出诊断 dev；在未设置上述变量的普通命令中重新 `npm run dev`，确认停止占位和启动入口。仅删除本次创建的临时脚本/目录。不要 export NODE_OPTIONS；两个启动命令里的设置仅对该命令生效。

## 生产探测函数的组件复现

以下命令读取真实 adb.ts，TypeScript 仅在内存中转译；将其已有 connect 接缝定向到一次性本地 server，四种应答逐一比对。未修改源文件，不用 Electron 或 GC，也不连接真实 5037。

```sh
node --input-type=module - <<'JS'
import { readFile } from 'node:fs/promises'
import { createServer, connect } from 'node:net'
import ts from 'typescript'
const source = await readFile('src/main/emulator/adb.ts', 'utf8')
const js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
}).outputText
const { probeServer } = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'))
for (const mode of ['whole-close', 'split-close', 'partial-close', 'split-open']) {
  let socket
  const server = createServer((client) => {
    socket = client
    client.once('data', () => {
      if (mode === 'whole-close') client.end('OKAY00040029')
      else {
        client.write('OKAY')
        setTimeout(() => {
          if (mode === 'partial-close') client.end()
          else if (mode === 'split-close') client.end('00040029')
          else client.write('00040029')
        }, 30)
      }
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  const observed = []
  const started = Date.now()
  const result = probeServer({ connect: (options) => {
    const client = connect({ ...options, port })
    client.on('data', (chunk) => observed.push({ event: 'data', value: chunk.toString(), ms: Date.now() - started }))
    client.on('close', () => observed.push({ event: 'close', ms: Date.now() - started }))
    client.on('timeout', () => observed.push({ event: 'timeout', ms: Date.now() - started }))
    return client
  } })
  let deadline
  const outcome = await Promise.race([
    result.then((value) => ({ status: 'resolved', value })),
    new Promise((resolve) => { deadline = setTimeout(() => resolve({ status: 'pending-after-4200ms' }), 4200) })
  ])
  clearTimeout(deadline)
  console.log(JSON.stringify({ mode, outcome, observed, elapsedMs: Date.now() - started }))
  socket?.destroy()
  await new Promise((resolve) => server.close(resolve))
}
JS
```

修复前，两个 closed 的分段/半帧场景 4200ms 后仍 pending；完整一帧返回协议 41；分段保持连接触发 socket timeout 并误判未运行。修复后四组均结束，合法完整帧均为协议 41，半帧关闭为 running=false。本轮原始数值见主报告，不把一次测量推广为固定耗时。
