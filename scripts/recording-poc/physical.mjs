/* eslint-disable @typescript-eslint/explicit-function-return-type -- 原生 JS 探针不含 TypeScript 返回类型语法 */
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { connect } from 'node:net'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { writeFile } from 'node:fs/promises'

const root = resolve('.codex/recording-poc')
const { establishTransport } = await import(pathToFileURL(join(root, 'transport.mjs')))
const serials = (process.env.MSD_POC_PHYSICAL_SERIALS ?? '').split(',').filter(Boolean)
if (!serials.length) throw new Error('set MSD_POC_PHYSICAL_SERIALS explicitly')
const exec = promisify(execFile)
const run = async (path, args, timeout = 15000) => {
  try {
    return { code: 0, ...(await exec(path, args, { timeout })) }
  } catch (error) {
    return { code: -1, stdout: error.stdout ?? '', stderr: error.stderr ?? error.message }
  }
}
const connectTcp = (port) =>
  new Promise((accept, reject) => {
    const socket = connect(port, '127.0.0.1')
    socket.once('connect', () => accept(socket))
    socket.once('error', reject)
  })
const results = []
for (const serial of serials) {
  const abort = new AbortController()
  const record = { transport: serial.includes(':') ? 'wireless' : 'usb' }
  let transport
  let reader
  let timer
  try {
    record.sdk = Number(
      (await run('adb', ['-s', serial, 'shell', 'getprop', 'ro.build.version.sdk'])).stdout.trim()
    )
    record.physicalIdentity = (
      await run('adb', ['-s', serial, 'shell', 'getprop', 'ro.serialno'])
    ).stdout.trim()
    record.preserveLocalAudio = record.sdk >= 33 ? 'requires-capture-probe' : 'unavailable'
    transport = await establishTransport({
      serial,
      adbPath: 'adb',
      serverPath: resolve('resources/scrcpy-server-v3.3.3'),
      run,
      spawn: (path, args, env) => spawn(path, args, { env }),
      connect: connectTcp,
      toolEnv: () => ({ ...process.env }),
      signal: abort.signal
    })
    record.width = transport.videoSize.width
    record.height = transport.videoSize.height
    reader = transport.mediaStream.getReader()
    const deadline = new Promise((accept) => {
      timer = setTimeout(() => accept({ done: true }), 5000)
    })
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), deadline])
      if (done) break
      if (value.type === 'configuration') record.hasConfiguration = true
      else if (value.keyframe) {
        record.hasKeyframe = true
        break
      }
    }
  } catch (error) {
    record.error = String(error.message)
  } finally {
    clearTimeout(timer)
    abort.abort()
    await reader?.cancel().catch(() => undefined)
    await transport?.teardown()
  }
  results.push(record)
}
await writeFile(join(root, 'physical.json'), JSON.stringify(results, null, 2))
console.log(
  results.map((entry) => {
    const record = { ...entry }
    delete record.physicalIdentity
    return record
  })
)
