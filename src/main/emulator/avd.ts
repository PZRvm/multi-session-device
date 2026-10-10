import { mkdir, readFile, rm } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { spawn } from 'node:child_process'
import { msg } from '../locale'

export interface AvdDirs {
  /** 应用自有 AVD 根（ANDROID_AVD_HOME 语义） */
  avdHome: string
  /** 应用自有 SDK 根（ANDROID_SDK_ROOT/ANDROID_HOME 语义） */
  sdkRoot: string
}

export const avdPaths = (avdName: string, dirs: AvdDirs): { ini: string; dir: string } => ({
  ini: join(dirs.avdHome, `${avdName}.ini`),
  dir: join(dirs.avdHome, `${avdName}.avd`)
})

export const avdExists = async (avdName: string, dirs: AvdDirs): Promise<boolean> => {
  try {
    await readFile(avdPaths(avdName, dirs).ini, 'utf8')
    return true
  } catch {
    return false
  }
}

export interface CreateAvdInput {
  /** AVD 名 = 设备 id（uuid，文件名安全；重命名只改元数据不改 AVD 名） */
  avdName: string
  /** avdmanager 画像 id（`list device` 的 or "..." 部分） */
  profileId: string
  /** 镜像包名（-k） */
  packageName: string
}

export interface CreateAvdDeps {
  /** 执行器接缝：默认 spawn avdmanager；单测注入固定结果或错误 */
  runner?: (args: string[], env: NodeJS.ProcessEnv) => Promise<void>
}

/**
 * 创建 AVD：`avdmanager create avd -n <名> -k <镜像> -d <画像>`。
 * 硬件参数（分辨率/密度/RAM）由 -d 的画像定义自动带入——2026-10-05 avdmanager 修复后
 * 从手写 config 切回官方路径；stdin 喂 `no` 兜底自定义硬件画像问句。
 */
export async function createAvd(
  input: CreateAvdInput,
  dirs: AvdDirs,
  deps: CreateAvdDeps = {}
): Promise<void> {
  const { avdName, profileId, packageName } = input
  if (!/^[A-Za-z0-9._-]+$/.test(avdName)) {
    throw new Error(msg('avdInvalidNameChars', { name: avdName }))
  }
  if (await avdExists(avdName, dirs)) {
    throw new Error(msg('avdExists', { ini: avdPaths(avdName, dirs).ini }))
  }

  const avdmanagerBin = join(dirs.sdkRoot, 'cmdline-tools', 'latest', 'bin', 'avdmanager')
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    JAVA_HOME: join(dirs.sdkRoot, 'jre', 'Contents', 'Home'),
    ANDROID_SDK_ROOT: dirs.sdkRoot,
    ANDROID_HOME: dirs.sdkRoot,
    ANDROID_AVD_HOME: dirs.avdHome,
    ANDROID_USER_HOME: join(dirs.sdkRoot, 'android-user'),
    ANDROID_EMULATOR_HOME: join(dirs.sdkRoot, 'android-user')
  }
  const args = ['create', 'avd', '-n', avdName, '-k', packageName, '-d', profileId]

  const runner =
    deps.runner ??
    ((runArgs: string[], runEnv: NodeJS.ProcessEnv): Promise<void> =>
      new Promise((resolve, reject) => {
        const child = spawn(avdmanagerBin, runArgs, {
          env: runEnv,
          stdio: ['pipe', 'pipe', 'pipe']
        })
        const out: Buffer[] = []
        const err: Buffer[] = []
        child.stdout?.on('data', (chunk: Buffer) => out.push(chunk))
        child.stderr?.on('data', (chunk: Buffer) => err.push(chunk))
        child.stdin?.end('no\n')
        child.on('error', reject)
        child.on('close', (code) => {
          if (code === 0) return resolve()
          const tail =
            Buffer.concat(err).toString('utf8').trim() || Buffer.concat(out).toString('utf8').trim()
          reject(new Error(msg('avdCreateFailed', { code: String(code), tail: tail.slice(-500) })))
        })
      }))

  await mkdir(dirs.avdHome, { recursive: true })
  await runner(args, env)
  // 落盘确认：avdmanager 静默成功但没写 ini 的情况视同失败（零部分成功的 AVD 侧）
  if (!(await avdExists(avdName, dirs))) {
    throw new Error(msg('avdCreateNoDir', { ini: avdPaths(avdName, dirs).ini }))
  }
}

/** 删除 AVD 目录与 ini；文件不存在按已删成功（force 语义，容忍手动删过一半）。
 * containment 守卫（plan 2026-10-05-avd-reconciliation 设计 4）：只删 avdHome 内
 * 由 id 推导的两条路径，绝不跟随 ini 内容的外部 path。 */
export async function deleteAvd(avdName: string, dirs: AvdDirs): Promise<void> {
  if (!/^[A-Za-z0-9._-]+$/.test(avdName)) {
    throw new Error(msg('avdInvalidName', { name: avdName }))
  }
  const paths = avdPaths(avdName, dirs)
  const root = resolve(dirs.avdHome)
  for (const target of [paths.dir, paths.ini]) {
    const resolved = resolve(target)
    if (resolved !== root && !resolved.startsWith(`${root}${sep}`)) {
      throw new Error(msg('avdDeleteEscape', { target }))
    }
  }
  await rm(paths.dir, { recursive: true, force: true })
  await rm(paths.ini, { force: true })
}

export interface PatchAvdDeps {
  readFile?: (path: string) => Promise<string>
  writeFile?: (path: string, data: string) => Promise<void>
}

/**
 * 创建后 config patch：只覆盖白名单键、保留未知键与注释行，tmp+rename 原子替换。
 * config.ini 是 Java properties 形态（key=value）；同键多行时**全部重写**——
 * properties 末次读取优先，只改首处会被后面的旧行盖掉（review P3：原实现只改
 * 首处，与注释宣称的「以最后一处为准」相反）。
 */
export async function patchAvdConfig(
  avdName: string,
  dirs: AvdDirs,
  patch: Record<string, string>,
  deps: PatchAvdDeps = {}
): Promise<void> {
  const read = deps.readFile ?? ((path: string) => readFile(path, 'utf8'))
  const write =
    deps.writeFile ??
    (async (path: string, data: string): Promise<void> => {
      const { writeFile: writeFn } = await import('node:fs/promises')
      await writeFn(path, data, 'utf8')
    })
  const configPath = join(avdPaths(avdName, dirs).dir, 'config.ini')
  const original = await read(configPath)

  const seen = new Set<string>()
  const lines = original.split('\n').map((line) => {
    const match = line.match(/^([A-Za-z0-9._-]+)=/)
    if (match === null) return line
    const key = match[1]
    if (!(key in patch)) return line
    seen.add(key)
    return `${key}=${patch[key]}`
  })
  // config 里不存在的白名单键追加到末尾
  const appended = Object.entries(patch)
    .filter(([key]) => !seen.has(key))
    .map(([key, value]) => `${key}=${value}`)
  const next = [...lines, ...appended].join('\n')

  const tmpPath = `${configPath}.tmp`
  await write(tmpPath, next)
  const { rename } = await import('node:fs/promises')
  await rename(tmpPath, configPath)
}
