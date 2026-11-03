/* eslint-disable @typescript-eslint/explicit-function-return-type -- 独立 JS 集成探针 */
import { app, BrowserWindow, ipcMain } from 'electron'
import { join, resolve } from 'node:path'
import { mkdirSync } from 'node:fs'
import { mkdir, writeFile, cp } from 'node:fs/promises'
import { createScrcpyManager } from '../../src/main/scrcpy/index.ts'
import { generateMp4 } from '../../src/main/recording/output.ts'
import { registerRecording } from '../../src/main/recording/index.ts'
import { IPC_CHANNELS as C } from '../../src/shared/ipc-channels.ts'
const run = async () => {
  const project = process.env.MSD_PRODUCT_PROJECT
  const root = resolve(process.env.MSD_PRODUCT_ROOT ?? '.codex/recording-poc/product')
  const duration = Number(process.env.MSD_PRODUCT_DURATION ?? 70_000)
  mkdirSync(join(root, 'profile'), { recursive: true })
  mkdirSync(join(root, 'downloads'), { recursive: true })
  app.setPath('userData', join(root, 'profile'))
  app.setPath('downloads', join(root, 'downloads'))
  let main
  let recording
  let scrcpy
  let lastState
  const pause = (ms) => new Promise((accept) => setTimeout(accept, ms))
  const wait = async (fn, deadlineMs = 30_000) => {
    const end = Date.now() + deadlineMs
    while (!fn()) {
      if (Date.now() > end) throw new Error('test wait deadline')
      await pause(100)
    }
  }
  const devices = ['5580', '5582'].map((port, i) => ({
    id: `poc-${i}`,
    name: `录屏验证 ${i + 1}`,
    status: 'running',
    serial: `emulator-${port}`,
    runId: `poc-run-${i}`,
    profileId: 'poc',
    profileLabel: 'API36',
    imagePackageName: 'system-images;android-36;google_apis;arm64-v8a',
    apiDisplay: '36',
    formFactor: 'phone',
    screenSummary: null,
    advancedSettings: null,
    snapshotReadyAt: null,
    createdAt: Date.now(),
    availability: { state: 'valid', issues: [] }
  }))
  const createWindow = async () => {
    main = new BrowserWindow({
      show: false,
      width: 1100,
      height: 800,
      webPreferences: {
        preload: join(project, 'out/preload/index.js'),
        sandbox: true,
        contextIsolation: true,
        backgroundThrottling: false
      }
    })
    main.webContents.on('console-message', (_event, ...args) => {
      if (args[0] >= 2) console.log('UI', ...args.slice(0, 3))
    })
    await main.loadFile(join(project, 'out/renderer/index.html'))
    return main
  }
  await mkdir(join(root, 'profile'), { recursive: true })
  await mkdir(join(root, 'downloads'), { recursive: true })
  if (process.env.MSD_PRODUCT_REGENERATE)
    await cp(resolve(process.env.MSD_PRODUCT_REGENERATE), join(root, 'profile/recordings'), {
      recursive: true
    })
  await app.whenReady()
  app.on('window-all-closed', () => {})
  ipcMain.on(C.themeGetSync, (event) => {
    event.returnValue = { mode: 'light', systemId: 'amber', effectiveMode: 'light' }
  })
  ipcMain.on(C.localeGetSync, (event) => {
    event.returnValue = { locale: 'zh-CN' }
  })
  ipcMain.handle(C.devicesList, () => ({
    revision: 1,
    devices,
    storeHealth: { state: 'ok', issues: [] },
    reconciliation: {
      signature: null,
      unavailableCount: 0,
      orphanCount: 0,
      storeState: 'ok',
      pendingNotification: false
    },
    sourceBucket: 'app-owned'
  }))
  ipcMain.handle(C.devicesExternalList, () => [])
  ipcMain.handle(C.networkGet, () => ({}))
  ipcMain.handle(C.logcatDockState, () => undefined)
  ipcMain.handle(C.dialogShow, (_event, value) => {
    console.log('dialog', value)
    return { response: 0 }
  })
  scrcpy = createScrcpyManager({
    adbPath: () => '/opt/homebrew/bin/adb',
    toolEnv: () => ({ ...process.env }),
    getMainWindow: () => (main && !main.isDestroyed() ? main : null),
    isMainSender: (sender) => main?.webContents === sender
  })
  scrcpy.registerIpc()
  recording = registerRecording({
    adbPath: () => '/opt/homebrew/bin/adb',
    toolEnv: () => ({ ...process.env }),
    scrcpy,
    device: async (id) => devices.find((device) => device.id === id) ?? null,
    isMainSender: (sender) => main?.webContents === sender,
    pushTarget: () => (main && !main.isDestroyed() ? main.webContents : null)
  })
  recording.deps.generate = async (options) => {
    await cp(options.directory, join(root, 'raw', options.manifest.task.taskId), {
      recursive: true
    })
    await generateMp4(options)
  }
  await recording.ready()
  if (process.env.MSD_PRODUCT_REGENERATE) {
    await createWindow()
    try {
      for (const task of recording.snapshot().tasks) await recording.command(task.taskId, 'retry')
      await wait(
        () => recording.snapshot().tasks.every((task) => ['saved', 'error'].includes(task.state)),
        Number(process.env.MSD_PRODUCT_GENERATE_TIMEOUT ?? 1_800_000)
      )
      const state = recording.snapshot()
      if (state.tasks.some((task) => task.state !== 'saved')) throw new Error(JSON.stringify(state))
      await pause(500)
      await writeFile(join(root, 'ui-saved.png'), (await main.webContents.capturePage()).toPNG())
      main.setSize(700, 650)
      await pause(500)
      await writeFile(
        join(root, 'ui-saved-narrow.png'),
        (await main.webContents.capturePage()).toPNG()
      )
      await writeFile(join(root, 'result.json'), JSON.stringify({ state, errors: [] }, null, 2))
    } finally {
      recording.dispose()
      await scrcpy.destroyAll()
      app.exit(0)
    }
    return
  }
  for (const device of devices)
    await scrcpy.ensureSession({ id: device.id, serial: device.serial, runId: device.runId })
  await wait(() => devices.every((device) => scrcpy.getRecordingSource(device.id)))
  await createWindow()
  const invoke = (code) => main.webContents.executeJavaScript(code)
  const latency = async () => {
    const values = []
    for (let i = 0; i < 6; i++) {
      values.push(
        await invoke(`(async () => {
        const canvas = document.querySelector('canvas'); const box = canvas.getBoundingClientRect();
        const start = performance.now();
        canvas.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1, clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 }));
        canvas.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, pointerType: 'mouse', button: 0, buttons: 0, clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 }));
        while (performance.now() - start < 2000) {
          const p = canvas.getContext('2d').getImageData(Math.floor(canvas.width / 4), Math.floor(canvas.height / 2), 1, 1).data;
          if (p[1] > 200 && p[0] < 80 && p[2] < 80) return Math.round(performance.now() - start);
          await new Promise(r => setTimeout(r, 5));
        }
        throw new Error('Touch response timeout');
      })()`)
      )
      await pause(350)
    }
    return values
  }
  const errors = []
  const measurements = {}
  try {
    await pause(1000)
    if (process.env.MSD_PRODUCT_TOUCH === '1') measurements.beforeRecordingMs = await latency()
    const first = await invoke(`window.api.recording.start('poc-0')`)
    const a = first.tasks.at(-1).taskId
    await wait(
      () => recording.snapshot().tasks.find((task) => task.taskId === a)?.state === 'recording'
    )
    console.log('A recording')
    await invoke(`document.querySelectorAll('[role="button"]')[1]?.click()`)
    const second = await invoke(`window.api.recording.start('poc-1')`)
    const b = second.tasks.at(-1).taskId
    await wait(
      () => recording.snapshot().tasks.find((task) => task.taskId === b)?.state === 'recording'
    )
    console.log('B recording')
    if (process.env.MSD_PRODUCT_TOUCH === '1') measurements.duringRecordingMs = await latency()
    const started = Date.now()
    await pause(10_000)
    await recording.command(a, 'pause')
    console.log('A paused', recording.snapshot())
    await pause(3000)
    await recording.command(a, 'resume')
    await wait(() => recording.snapshot().tasks[0].state === 'recording')
    // 原主窗销毁后采集仍在 main，隐藏处理页稍后才创建；重建主窗拉同一快照。
    main.destroy()
    await pause(3000)
    await createWindow()
    await pause(1500)
    const image = await main.webContents.capturePage()
    await writeFile(join(root, 'ui-recording.png'), image.toPNG())
    await main.setSize(700, 650)
    await pause(400)
    await writeFile(join(root, 'ui-narrow.png'), (await main.webContents.capturePage()).toPNG())
    await main.setSize(1100, 800)
    const remaining = duration - (Date.now() - started)
    if (remaining > 0) await pause(remaining)
    await recording.command(a, 'stop')
    await recording.command(b, 'stop')
    await wait(
      () => recording.snapshot().tasks.every((task) => ['saved', 'error'].includes(task.state)),
      Number(process.env.MSD_PRODUCT_GENERATE_TIMEOUT ?? 1_800_000)
    )
    lastState = recording.snapshot()
    if (lastState.tasks.some((task) => task.state !== 'saved'))
      throw new Error(JSON.stringify(lastState))
    await pause(500)
    await writeFile(join(root, 'ui-saved.png'), (await main.webContents.capturePage()).toPNG())
    console.log('SAVED', lastState)
  } catch (error) {
    errors.push(String(error.stack ?? error))
    console.error(error)
  } finally {
    await writeFile(
      join(root, 'result.json'),
      JSON.stringify({ state: recording.snapshot(), errors, measurements }, null, 2)
    )
    if (!errors.length) await recording.discardForQuit()
    else await Promise.all(devices.map((device) => recording.stopDevice(device.id)))
    recording.dispose()
    await scrcpy.destroyAll()
    app.exit(errors.length ? 1 : 0)
  }
}
void run().catch((error) => {
  console.error(error)
  app.exit(1)
})
