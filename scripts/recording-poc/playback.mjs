import { app, BrowserWindow, ipcMain } from 'electron'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { writeFile } from 'node:fs/promises'

const root = resolve(process.env.MSD_RECORDING_POC_ROOT ?? '.codex/recording-poc')
const window = new BrowserWindow({
  show: false,
  webPreferences: {
    preload: join(import.meta.dirname, 'preload.cjs'),
    sandbox: true,
    contextIsolation: true,
    backgroundThrottling: false
  }
})
ipcMain.handle('poc:report', async (event, value) => {
  if (event.sender !== window.webContents) throw new Error('unexpected sender')
  if (value.kind === 'init')
    return pathToFileURL(
      process.env.MSD_POC_PLAYBACK_FILE ?? join(root, 'emulator-5580-rotated.mp4')
    ).href
  await writeFile(join(root, 'playback.json'), JSON.stringify(value, null, 2))
  console.log(value)
  app.exit(value.error ? 1 : 0)
})
await window.loadFile(join(import.meta.dirname, 'playback.html'))
setTimeout(() => app.exit(1), 30000).unref()
