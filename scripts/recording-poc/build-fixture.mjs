/* eslint-disable @typescript-eslint/explicit-function-return-type -- 原生 JS 探针不含 TypeScript 返回类型语法 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

const sdk = process.env.MSD_POC_SDK ?? join(homedir(), 'Library/Android/sdk')
const java =
  process.env.MSD_POC_JAVA ?? '/Applications/Android Studio.app/Contents/jbr/Contents/Home'
const build = join(sdk, 'build-tools/36.1.0')
const output = resolve('.codex/recording-poc/fixture')
mkdirSync(join(output, 'classes'), { recursive: true })
const run = (exe, args) => {
  const result = spawnSync(exe, args, {
    stdio: 'inherit',
    env: { ...process.env, JAVA_HOME: java }
  })
  if (result.status !== 0) throw new Error(`${exe} failed (${result.status})`)
}
const jar = join(sdk, 'platforms/android-36/android.jar')
run(join(java, 'bin/javac'), [
  '-source',
  '8',
  '-target',
  '8',
  '-classpath',
  jar,
  '-d',
  join(output, 'classes'),
  join(import.meta.dirname, 'fixture/MainActivity.java')
])
run(join(build, 'd8'), [
  '--lib',
  jar,
  '--min-api',
  '26',
  '--output',
  output,
  ...['MainActivity.class', 'MainActivity$1.class'].map((name) =>
    join(output, 'classes/com/foreunit/recordingpoc', name)
  )
])
run(join(build, 'aapt'), [
  'package',
  '-f',
  '-M',
  join(import.meta.dirname, 'fixture/AndroidManifest.xml'),
  '-I',
  jar,
  '-F',
  join(output, 'fixture-unsigned.apk')
])
run(join(java, 'bin/jar'), [
  'uf',
  join(output, 'fixture-unsigned.apk'),
  '-C',
  output,
  'classes.dex'
])
const keystore = join(output, 'poc.keystore')
if (!existsSync(keystore))
  run(join(java, 'bin/keytool'), [
    '-genkeypair',
    '-keystore',
    keystore,
    '-storepass',
    'android',
    '-keypass',
    'android',
    '-alias',
    'poc',
    '-keyalg',
    'RSA',
    '-dname',
    'CN=Recording PoC',
    '-validity',
    '30'
  ])
run(join(build, 'apksigner'), [
  'sign',
  '--ks',
  keystore,
  '--ks-pass',
  'pass:android',
  '--out',
  join(output, 'fixture.apk'),
  join(output, 'fixture-unsigned.apk')
])
console.log(join(output, 'fixture.apk'))
