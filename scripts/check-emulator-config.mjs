import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const args = process.argv.slice(2)
const options = {}
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--create-only') {
    options['--create-only'] = true
    continue
  }
  if (!['--sdk-root', '--image'].includes(args[i]) || !args[i + 1]) {
    throw new Error(
      '用法：npm run test:emulator-config -- --sdk-root <SDK目录> [--image <包名>] [--create-only]'
    )
  }
  options[args[i]] = args[i + 1]
  i += 1
}
if (!options['--sdk-root']) throw new Error('需要 --sdk-root；测试只创建和清理自己的临时 AVD')
const root = fileURLToPath(new URL('../', import.meta.url))
const child = spawn(
  process.execPath,
  [
    resolve(root, 'node_modules/vitest/vitest.mjs'),
    'run',
    'src/main/emulator/__tests__/smoke.real.config.test.ts'
  ],
  {
    cwd: root,
    stdio: 'inherit',
    env: {
      ...process.env,
      MSD_REAL_CONFIG: '1',
      MSD_CONFIG_SDK_ROOT: resolve(options['--sdk-root']),
      MSD_CONFIG_CREATE_ONLY: options['--create-only'] ? '1' : '0',
      MSD_CONFIG_IMAGE: options['--image'] ?? 'system-images;android-32;default;arm64-v8a'
    }
  }
)
child.on('error', (error) => {
  throw error
})
child.on('exit', (code) => {
  process.exitCode = code ?? 1
})
