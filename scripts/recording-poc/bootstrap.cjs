/* eslint-disable @typescript-eslint/no-require-imports -- Electron 沙箱 preload / 启动引导要求 CommonJS */
const { app } = require('electron')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const profile = path.resolve(
  process.env.MSD_RECORDING_POC_ROOT ?? '.codex/recording-poc',
  'electron-profile'
)
require('node:fs').mkdirSync(profile, { recursive: true })
app.setPath('userData', profile)
process.stdout.write('Recording PoC: Electron bootstrap\n')
app
  .whenReady()
  .then(
    () =>
      import(
        pathToFileURL(
          path.join(
            __dirname,
            process.env.MSD_POC_PLAYBACK === '1'
              ? 'playback.mjs'
              : process.env.MSD_POC_PROCESS === '1'
                ? 'process.mjs'
                : 'electron.mjs'
          )
        )
      )
  )
  .catch((error) => {
    process.stderr.write(String(error.stack ?? error) + '\n')
    app.exit(1)
  })
