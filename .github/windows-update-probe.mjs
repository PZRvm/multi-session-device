import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { basename, join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const oldVersion = '90.0.1'
const newVersion = '90.0.2'
const exeName = 'multi-session-device-update-test.exe'
const testRoot = resolve('dist/windows-verify')
const installer = (version) => join(testRoot, version, `multi-session-device-${version}-windows-x64-setup.exe`)
const ps = (cmd) => execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd], { encoding: 'utf8', timeout: 12000 }).trim()
const q = (value) => "'" + value.replaceAll("'", "''") + "'"
const requests = []
const server = createServer((request, response) => {
  const file = basename(new URL(request.url, 'http://127.0.0.1').pathname)
  requests.push(file)
  if (!['latest.yml', basename(installer(newVersion)), basename(installer(newVersion)) + '.blockmap', basename(installer(oldVersion)) + '.blockmap'].includes(file))
    return response.writeHead(404).end()
  const folder = file.includes(oldVersion) ? oldVersion : newVersion
  const path = join(testRoot, folder, file)
  if (!existsSync(path)) return response.writeHead(404).end()
  response.writeHead(200, { 'Content-Length': statSync(path).size, 'Cache-Control': 'no-store' })
  createReadStream(path).pipe(response)
})
const wait = async (label, predicate, timeout = 45000) => {
  const end = Date.now() + timeout
  let last
  while (Date.now() < end) {
    try {
      const value = await predicate()
      if (value) return value
    } catch (error) { last = error }
    await delay(500)
  }
  throw new Error(`Timeout: ${label}. Last error: ${last}`)
}
async function connection(port, select) {
  const target = await wait(`debug port ${port}`, async () => {
    const reply = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1500) })
    return (await reply.json()).find(select)
  })
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((done, fail) => {
    ws.addEventListener('open', done, { once: true })
    ws.addEventListener('error', fail, { once: true })
  })
  const pending = new Map()
  let id = 0
  ws.addEventListener('message', ({ data }) => {
    const result = JSON.parse(data)
    pending.get(result.id)?.(result)
  })
  return {
    close: () => ws.close(),
    async evaluate(expression) {
      const seq = ++id
      const reply = await new Promise((done, fail) => {
        const timer = setTimeout(() => { pending.delete(seq); fail(new Error('CDP timeout')) }, 5000)
        pending.set(seq, (result) => { clearTimeout(timer); pending.delete(seq); done(result) })
        ws.send(JSON.stringify({ id: seq, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }))
      })
      if (reply.error || reply.result.exceptionDetails) throw new Error(JSON.stringify(reply.error ?? reply.result.exceptionDetails))
      return reply.result.result.value
    }
  }
}

const userData = join(process.env.APPDATA, 'multi-session-device-update-test')
const marker = join(userData, 'windows-update-proof.txt')
const markerText = 'keep-this-across-the-upgrade'
mkdirSync(userData, { recursive: true })
writeFileSync(marker, markerText)
await new Promise((done, fail) => server.once('error', fail).listen(16387, '127.0.0.1', done))

let installed
let child
try {
  execFileSync(installer(oldVersion), ['/S'], { timeout: 100000, stdio: 'inherit' })
  installed = await wait('installed executable', () => ps(`Get-ChildItem (Join-Path $env:LOCALAPPDATA 'Programs') -Recurse -Filter ${q(exeName)} | Select-Object -First 1 -ExpandProperty FullName`))
  const fileVersion = () => ps(`(Get-Item -LiteralPath ${q(installed)}).VersionInfo.ProductVersion`).replaceAll(',', '.')
  await wait('version on disk before upgrade', () => fileVersion().startsWith(oldVersion))
  child = spawn(installed, ['--remote-debugging-port=16388', '--remote-debugging-address=127.0.0.1', '--inspect=127.0.0.1:16389'], { stdio: 'inherit' })
  const main = await connection(16389, () => true)
  const page = await connection(16388, (target) => target.url.replaceAll('%20', ' ').endsWith('/index.html'))
  const read = () => page.evaluate('window.api.updates.getState()')
  await wait('new version available', async () => {
    const state = await read()
    return state.currentVersion === oldVersion && state.status === 'available' && state.candidateVersion === newVersion
  })
  assert(!requests.includes(basename(installer(newVersion))), 'check must not start the installer download')
  console.log('Installed 90.0.1 found 90.0.2 without downloading an EXE')
  await main.evaluate(`(() => {
    const electron = process.getBuiltinModule('module').createRequire(process.execPath)('electron')
    const original = electron.dialog.showMessageBox
    electron.dialog.showMessageBox = (owner, options) => {
      if (options?.type === 'question' && options.buttons?.at(-1) === '重启安装') {
        return new Promise(resolve => { globalThis.confirmUpgrade = resolve })
      }
      return original(owner, options)
    }
    return true
  })()`)
  await page.evaluate('void window.api.updates.download(); true')
  await wait('EXE download and installation prompt', async () => {
    const state = await read()
    return state.status === 'ready' && state.downloadedVersion === newVersion &&
      await main.evaluate('typeof globalThis.confirmUpgrade === "function"')
  }, 90000)
  assert(requests.includes(basename(installer(newVersion))), 'installer must be downloaded on request')
  assert(fileVersion().startsWith(oldVersion), 'the app must not be updated before confirmation')
  console.log('Downloaded 90.0.2. The installed version is still 90.0.1 before confirmation')
  await main.evaluate('setTimeout(() => globalThis.confirmUpgrade({response:1}), 500); true')
  const oldPid = child.pid
  main.close()
  page.close()
  await wait('real NSIS replaced installed EXE', () => fileVersion().startsWith(newVersion), 120000)
  await wait('new installed process relaunched', () => ps(`Get-CimInstance Win32_Process -Filter "Name = '${exeName}'" | Where-Object { $_.ExecutablePath -eq ${q(installed)} -and $_.ProcessId -ne ${oldPid} -and $_.CommandLine -notlike '*--type=*' } | Select-Object -First 1 -ExpandProperty ProcessId`), 60000)
  assert.equal(readFileSync(marker, 'utf8'), markerText)
  console.log('PASS: Windows NSIS installed 90.0.2, relaunched, and preserved isolated user data')
} finally {
  server.closeAllConnections()
  await new Promise((done) => server.close(done))
  if (child && child.exitCode === null) child.kill()
}
