import { lstat, readFile, readdir, realpath } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import type {
  DeviceAvailability,
  DeviceAvailabilityState,
  DeviceHealthComponent,
  DeviceHealthIssue,
  DeviceMeta,
  ReconcileOrphanEntry
} from '@shared/types'
import { checkLocalImage, type LocalImageCheck, type LocalImageFault } from './catalog'
import { isSharedReadOnly } from './sdkSource'
import { msg } from '../locale'

/**
 * AVD 与引用镜像的只读核验（plan 2026-10-05-avd-reconciliation 设计 2）。
 * 全部检查无写副作用：不迁移、不清理、不修复；核验服务只接受 main 推导的
 * 受控根，拒绝受检路径的根外指向。检查结果归因为 availability——镜像缺失
 * 不会显示成 AVD 被删，权限/超时不降格为 missing。
 */

export const CHECK_TIMEOUT_MS = 3_000
/** ini/config 单文件读取上限（lstat 先量尺寸，超限不读内容） */
export const MAX_CONFIG_BYTES = 64 * 1024
const MAX_CONCURRENCY = 4

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** 关键键：冲突重复或不可解析为 broken（同值重复按 properties 末次值接受） */
const CRITICAL_CONFIG_KEYS = [
  'image.sysdir.1',
  'abi.type',
  'hw.lcd.width',
  'hw.lcd.height',
  'hw.lcd.density'
]

export interface ReconcileDirs {
  avdHome: string
  sdkRoot: string
  /** 应用皮肤库根（skin.path 越界判定：SDK skins 或 device-skins 之外为 unsafe） */
  skinsRoot: string
}

export interface ReconcileRequest {
  metas: DeviceMeta[]
  /** 坏/重复元数据中可识别的 id——单列「元数据异常关联文件」，不称可清理孤立组 */
  badMetaIds: Set<string>
  /** creating/deleting/回滚中的 id：暂缓判断孤立 */
  transientIds: Set<string>
  dirs: ReconcileDirs
  signal?: AbortSignal
}

export interface ReconcileOutcome {
  checkedAt: number
  availabilityById: Map<string, DeviceAvailability>
  orphans: ReconcileOrphanEntry[]
  unrecognizedCount: number
  scanError: string | null
}

/** FS/时钟接缝：测试注入；结构上是 node:fs/promises 对应方法的子集 */
export interface ReconcileFsDeps {
  lstat?: (path: string) => Promise<{
    isFile(): boolean
    isDirectory(): boolean
    isSymbolicLink(): boolean
    size: number
  }>
  readFile?: (path: string) => Promise<string>
  readdir?: (path: string) => Promise<string[]>
  realpath?: (path: string) => Promise<string>
  now?: () => number
}

const defaultDeps: Required<ReconcileFsDeps> = {
  lstat: (path) => lstat(path),
  readFile: (path) => readFile(path, 'utf8'),
  readdir: (path) => readdir(path),
  realpath: (path) => realpath(path),
  now: () => Date.now()
}

const errnoOf = (error: unknown): string | null =>
  typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : null

export interface ParsedProperties {
  /** 末次值优先（Java properties 语义）；同值重复合法 */
  values: Map<string, string>
  /** 同键不同值的冲突键集（关键键冲突 = broken） */
  conflicts: Set<string>
}

/** Java properties 形态解析：忽略注释/空行；非键值行按未知内容忽略不追随 */
export const parseProperties = (content: string): ParsedProperties => {
  const values = new Map<string, string>()
  const conflicts = new Set<string>()
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line.length === 0 || line.startsWith('#') || line.startsWith('!')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    if (!/^[A-Za-z0-9._-]+$/.test(key)) continue
    const value = line.slice(eq + 1).trim()
    const existing = values.get(key)
    if (existing !== undefined && existing !== value) conflicts.add(key)
    values.set(key, value)
  }
  return { values, conflicts }
}

/** 健康结果构造：error 级 issue 参与主状态归因；warning 只展示 */
class HealthBuilder {
  readonly issues: DeviceHealthIssue[] = []
  readonly blocking = new Set<Exclude<DeviceAvailabilityState, 'checking' | 'valid'>>()

  error(
    state: Exclude<DeviceAvailabilityState, 'checking' | 'valid'>,
    component: DeviceHealthComponent,
    code: string,
    message: string
  ): void {
    this.issues.push({ component, code, message, severity: 'error' })
    this.blocking.add(state)
  }

  warning(component: DeviceHealthComponent, code: string, message: string): void {
    this.issues.push({ component, code, message, severity: 'warning' })
  }

  result(checkedAt: number): DeviceAvailability {
    const state: DeviceAvailabilityState = this.blocking.has('unsafe')
      ? 'unsafe'
      : this.blocking.has('inaccessible')
        ? 'inaccessible'
        : this.blocking.has('broken')
          ? 'broken'
          : this.blocking.has('missing')
            ? 'missing'
            : 'valid'
    return { state, issues: this.issues, checkedAt }
  }
}

type PathOutcome =
  | { kind: 'ok'; size: number }
  | { kind: 'missing' }
  | { kind: 'symlink' }
  | { kind: 'not-file' }
  | { kind: 'inaccessible'; errno: string | null }

type DirOutcome =
  | { kind: 'ok' }
  | { kind: 'missing' }
  | { kind: 'symlink' }
  | { kind: 'not-directory' }
  | { kind: 'inaccessible'; errno: string | null }

const checkFile = async (path: string, d: Required<ReconcileFsDeps>): Promise<PathOutcome> => {
  try {
    const info = await d.lstat(path)
    if (info.isSymbolicLink()) return { kind: 'symlink' }
    if (!info.isFile()) return { kind: 'not-file' }
    return { kind: 'ok', size: info.size }
  } catch (error) {
    const errno = errnoOf(error)
    if (errno === 'ENOENT') return { kind: 'missing' }
    return { kind: 'inaccessible', errno }
  }
}

const checkDir = async (path: string, d: Required<ReconcileFsDeps>): Promise<DirOutcome> => {
  try {
    const info = await d.lstat(path)
    if (info.isSymbolicLink()) return { kind: 'symlink' }
    if (!info.isDirectory()) return { kind: 'not-directory' }
    return { kind: 'ok' }
  } catch (error) {
    const errno = errnoOf(error)
    if (errno === 'ENOENT') return { kind: 'missing' }
    return { kind: 'inaccessible', errno }
  }
}

const isWithin = (parent: string, child: string): boolean =>
  child === parent || child.startsWith(`${parent}${sep}`)

/** 逃逸段检测：只看 `.`/`..`/NUL——绝对路径 split 的首空段是正常的 */
const hasEscapeSegments = (segments: string[]): boolean =>
  segments.some((segment) => segment === '.' || segment === '..' || segment.includes('\0'))

interface RootContext {
  dirs: ReconcileDirs
  avdHomeReal: string | null
  sdkRootReal: string | null
  skinsRootReal: string | null
  /** 共享镜像核验缓存（每轮扫描按 canonical 路径去重，只读一次） */
  imageChecks: Map<string, Promise<LocalImageCheck>>
}

const realpathOrNull = async (
  path: string,
  d: Required<ReconcileFsDeps>
): Promise<string | null> => {
  try {
    return await d.realpath(path)
  } catch {
    return null
  }
}

const imageFaultState: Record<
  LocalImageFault,
  { state: 'missing' | 'broken' | 'inaccessible' | 'unsafe'; code: string }
> = {
  'missing-dir': { state: 'missing', code: 'image-dir-missing' },
  'unreadable-dir': { state: 'inaccessible', code: 'image-dir-inaccessible' },
  'missing-package-xml': { state: 'missing', code: 'image-package-xml-missing' },
  'unreadable-package-xml': { state: 'inaccessible', code: 'image-package-xml-unreadable' },
  'invalid-package-xml': { state: 'broken', code: 'image-package-xml-invalid' },
  'symlinked-file': { state: 'unsafe', code: 'image-file-symlink' },
  'identity-mismatch': { state: 'broken', code: 'image-identity-mismatch' },
  'missing-source-properties': { state: 'missing', code: 'image-source-properties-missing' },
  'missing-system-img': { state: 'missing', code: 'image-system-img-missing' }
}

/**
 * 出身指路（plan 2026-10-12-device-list-source-aware）：镜像在当前生效根缺失
 * 且设备出身与当前来源桶不符时，消息附「切换到 X 可用」——行内 hint 与启动
 * 失败弹窗同源共享。出身≠来源只是提示线索不是故障原因，故仅在 missing 类
 * 故障追加（损坏/权限/symlink 与来源无关）；两根并存同名镜像时核验直接通过，
 * 本提示根本不会产生，无误导。
 */
const withOriginHint = (
  meta: DeviceMeta,
  state: DeviceAvailabilityState,
  message: string
): string => {
  if (state !== 'missing') return message
  const origin = meta.imageSourceOrigin ?? 'app-owned'
  const current = isSharedReadOnly() ? 'shared-studio' : 'app-owned'
  if (origin === current) return message
  return message + msg(origin === 'shared-studio' ? 'rcOriginHintShared' : 'rcOriginHintOwned')
}

/**
 * 单目标核验（启动前即时检查与全量扫描共用）。检查三主体 + ini/config 关键项 +
 * 引用镜像 + skin.path 边界；最多读 ini/config/三个受检镜像文件，不递归数据盘。
 */
export const checkDeviceHealth = async (
  meta: DeviceMeta,
  dirs: ReconcileDirs,
  deps: ReconcileFsDeps = {}
): Promise<DeviceAvailability> => {
  const d = { ...defaultDeps, ...deps }
  const now = d.now()
  const health = new HealthBuilder()
  const avdHomeReal = await realpathOrNull(dirs.avdHome, d)
  const sdkRootReal = await realpathOrNull(dirs.sdkRoot, d)
  const skinsRootReal = await realpathOrNull(dirs.skinsRoot, d)
  const ctx: RootContext = {
    dirs,
    avdHomeReal,
    sdkRootReal,
    skinsRootReal,
    imageChecks: new Map()
  }
  return checkDeviceWith(health, meta, ctx, d, now)
}

const checkDeviceWith = async (
  health: HealthBuilder,
  meta: DeviceMeta,
  ctx: RootContext,
  d: Required<ReconcileFsDeps>,
  now: number
): Promise<DeviceAvailability> => {
  const { dirs } = ctx
  const id = meta.id
  if (!UUID_RE.test(id)) {
    // 元数据 id 已在 store 侧按 UUID 校验；此处兜底，不拼出根外路径
    health.error('unsafe', 'avd', 'invalid-id', msg('rcIdNotUuid', { id }))
    return health.result(now)
  }

  // ---- 1. <id>.ini：普通文件、非 symlink、有界读取 ----
  const iniPath = join(dirs.avdHome, `${id}.ini`)
  const avdDirPath = join(dirs.avdHome, `${id}.avd`)
  const iniOutcome = await checkFile(iniPath, d)
  let iniValues: ParsedProperties | null = null
  if (iniOutcome.kind === 'ok') {
    if (iniOutcome.size > MAX_CONFIG_BYTES) {
      health.error(
        'broken',
        'avd',
        'ini-too-large',
        msg('rcIniTooLarge', { id, max: MAX_CONFIG_BYTES / 1024 })
      )
    } else {
      try {
        iniValues = parseProperties(await d.readFile(iniPath))
      } catch (error) {
        // 读失败一律 inaccessible（EACCES/EIO 同为 IO 故障，review P3），不冒充损坏
        const errno = errnoOf(error)
        health.error(
          'inaccessible',
          'avd',
          'ini-unreadable',
          msg('rcIniReadFailed', { id, errno: errno ?? msg('unknownError') })
        )
      }
    }
  } else if (iniOutcome.kind === 'missing') {
    health.error('missing', 'avd', 'ini-missing', msg('rcMissingIni', { id }))
  } else if (iniOutcome.kind === 'symlink') {
    health.error('unsafe', 'avd', 'ini-symlink', msg('rcIniIsSymlink', { id }))
  } else if (iniOutcome.kind === 'not-file') {
    health.error('broken', 'avd', 'ini-not-file', msg('rcIniNotRegular', { id }))
  } else {
    health.error(
      'inaccessible',
      'avd',
      'ini-inaccessible',
      msg('rcIniUnaccessible', { id, errno: iniOutcome.errno ?? msg('unknownError') })
    )
  }

  // ---- 2. <id>.avd：目录、非 symlink、canonical 仍在自有根内 ----
  const dirOutcome = await checkDir(avdDirPath, d)
  let avdDirReal: string | null = null
  if (dirOutcome.kind === 'ok') {
    avdDirReal = await realpathOrNull(avdDirPath, d)
    if (avdDirReal === null) {
      health.error(
        'inaccessible',
        'avd',
        'avd-dir-unresolvable',
        msg('rcAvdPathUnparsable', { id })
      )
    } else if (ctx.avdHomeReal !== null && !isWithin(ctx.avdHomeReal, avdDirReal)) {
      health.error('unsafe', 'avd', 'avd-dir-escape', msg('rcAvdEscapeRoot', { id }))
    }
  } else if (dirOutcome.kind === 'missing') {
    health.error('missing', 'avd', 'avd-dir-missing', msg('rcMissingAvdDir', { id }))
  } else if (dirOutcome.kind === 'symlink') {
    health.error('unsafe', 'avd', 'avd-dir-symlink', msg('rcAvdIsSymlink', { id }))
  } else if (dirOutcome.kind === 'not-directory') {
    health.error('broken', 'avd', 'avd-dir-not-directory', msg('rcAvdNotDir', { id }))
  } else {
    health.error(
      'inaccessible',
      'avd',
      'avd-dir-inaccessible',
      msg('rcAvdUnaccessible', { id, errno: dirOutcome.errno ?? msg('unknownError') })
    )
  }

  // ---- 3. ini.path 指向预期 AVD；path.rel 不追随 ----
  if (iniValues !== null && avdDirReal !== null) {
    const declared = iniValues.values.get('path')
    if (declared === undefined) {
      health.error('broken', 'avd', 'ini-path-missing', msg('rcIniPathMissingKey', { id }))
    } else {
      const resolved = declared.startsWith('/') ? declared : resolve(dirs.avdHome, declared)
      // 原始声明先查逃逸段（resolve 会把 `..` 规范化掉，相对分支曾因此不可达——review P3）
      if (hasEscapeSegments(declared.split('/')) || hasEscapeSegments(resolved.split(sep))) {
        health.error('unsafe', 'avd', 'ini-path-escape', msg('rcIniPathEscape', { id }))
      } else {
        const declaredReal = await realpathOrNull(resolved, d)
        if (declaredReal === null) {
          health.error('broken', 'avd', 'ini-path-invalid', msg('rcIniPathNotFound', { id }))
        } else if (declaredReal !== avdDirReal) {
          health.error('broken', 'avd', 'ini-path-mismatch', msg('rcIniPathMismatch', { id }))
        }
      }
    }
  }

  // ---- 4. config.ini：普通文件、非 symlink、关键项与冲突 ----
  const configPath = join(avdDirPath, 'config.ini')
  let configValues: ParsedProperties | null = null
  if (dirOutcome.kind === 'ok') {
    const configOutcome = await checkFile(configPath, d)
    if (configOutcome.kind === 'ok') {
      if (configOutcome.size > MAX_CONFIG_BYTES) {
        health.error(
          'broken',
          'avd',
          'config-too-large',
          msg('rcConfigTooLarge', { max: MAX_CONFIG_BYTES / 1024 })
        )
      } else {
        try {
          configValues = parseProperties(await d.readFile(configPath))
        } catch (error) {
          // 读失败一律 inaccessible（EACCES/EIO 同为 IO 故障，review P3），不冒充损坏
          const errno = errnoOf(error)
          health.error(
            'inaccessible',
            'avd',
            'config-unreadable',
            msg('rcConfigReadFailed', { errno: errno ?? msg('unknownError') })
          )
        }
      }
    } else if (configOutcome.kind === 'missing') {
      health.error('missing', 'avd', 'config-missing', msg('rcMissingConfigIni'))
    } else if (configOutcome.kind === 'symlink') {
      health.error('unsafe', 'avd', 'config-symlink', msg('rcConfigIsSymlink'))
    } else if (configOutcome.kind === 'not-file') {
      health.error('broken', 'avd', 'config-not-file', msg('rcConfigNotRegular'))
    } else {
      health.error(
        'inaccessible',
        'avd',
        'config-inaccessible',
        msg('rcConfigUnaccessible', { errno: configOutcome.errno ?? msg('unknownError') })
      )
    }
  }

  let configAbi: string | null = null
  if (configValues !== null) {
    for (const key of configValues.conflicts) {
      if (CRITICAL_CONFIG_KEYS.includes(key)) {
        health.error('broken', 'avd', 'config-conflict', msg('rcKeyDuplicate', { key }))
      }
    }
    const sysdir = configValues.values.get('image.sysdir.1')
    const abiRaw = configValues.values.get('abi.type')
    configAbi = typeof abiRaw === 'string' && abiRaw.length > 0 ? abiRaw : null
    if (sysdir === undefined || sysdir.length === 0) {
      health.error('broken', 'avd', 'config-missing-sysdir', msg('rcNoSysdir'))
    } else if (configAbi === null) {
      health.error('broken', 'avd', 'config-missing-abi', msg('rcNoAbiType'))
    }
    // 分辨率关键项：可解析性（缺失降为 warning，不误伤省略项的旧配置）
    const lcdKeys = ['hw.lcd.width', 'hw.lcd.height', 'hw.lcd.density']
    const missingLcd = lcdKeys.filter((key) => configValues!.values.get(key) === undefined)
    for (const key of lcdKeys) {
      const value = configValues!.values.get(key)
      if (value !== undefined && !/^\d+$/.test(value)) {
        health.error('broken', 'avd', 'config-invalid-lcd', msg('rcKeyNotNumeric', { key, value }))
      }
    }
    if (missingLcd.length === lcdKeys.length) {
      health.warning('avd', 'config-lcd-missing', msg('rcLcdKeysMissing'))
    }

    // ---- 5. skin.path 边界：SDK skins 或应用 device-skins 之外为 unsafe ----
    const skinPath = configValues.values.get('skin.path')
    if (skinPath !== undefined && skinPath.length > 0) {
      if (skinPath.startsWith('/')) {
        // canonical 存在时只认 canonical 包含（review P2-1：symlink 指向根外时词法
        // 在根内不得放行）；目标缺失（皮肤已被删）才按词法兜底，交由展示回退处理
        const skinReal = await realpathOrNull(skinPath, d)
        if (skinReal !== null) {
          const inside =
            (ctx.sdkRootReal !== null && isWithin(ctx.sdkRootReal, skinReal)) ||
            (ctx.skinsRootReal !== null && isWithin(ctx.skinsRootReal, skinReal))
          if (!inside) {
            health.error('unsafe', 'avd', 'skin-path-escape', msg('rcSkinPathOutside'))
          }
        } else {
          const skinResolved = resolve(skinPath)
          const insideLexical =
            isWithin(resolve(dirs.sdkRoot), skinResolved) ||
            isWithin(resolve(dirs.skinsRoot), skinResolved)
          if (!insideLexical) {
            health.error('unsafe', 'avd', 'skin-path-escape', msg('rcSkinPathOutside'))
          }
        }
      } else if (hasEscapeSegments(skinPath.split('/'))) {
        health.error('unsafe', 'avd', 'skin-path-escape', msg('rcSkinPathEscapeSegment'))
      }
    }
  }

  // ---- 6. 引用镜像：从实际 sysdir 解析 + 单包带诊断核验 ----
  if (configValues !== null && ctx.sdkRootReal === null) {
    health.error('missing', 'image', 'sdk-root-missing', msg('rcSdkRootUnavailable'))
  } else if (configValues !== null) {
    const sysdir = configValues.values.get('image.sysdir.1')
    if (typeof sysdir === 'string' && sysdir.length > 0) {
      const isAbsolute = sysdir.startsWith('/')
      const segments = sysdir.replace(/\/+$/, '').split('/')
      if (hasEscapeSegments(isAbsolute ? segments.slice(1) : segments)) {
        health.error('unsafe', 'image', 'image-sysdir-escape', msg('rcSysdirEscapeSegment'))
      } else {
        const imageDir = isAbsolute ? sysdir : join(dirs.sdkRoot, ...segments)
        let dirIdentity: { platformSegment: string; tagSegment: string; abi: string } | null = null
        if (!isAbsolute && segments.length >= 3) {
          const [abi, tagSegment, platformSegment] = [
            segments.at(-1)!,
            segments.at(-2)!,
            segments.at(-3)!
          ]
          dirIdentity = { platformSegment, tagSegment, abi }
        }
        // canonical 校验对相对/绝对统一（review P2-5）：目录组件被换成外指 symlink 时 unsafe
        const imageReal = await realpathOrNull(imageDir, d)
        if (
          imageReal !== null &&
          ctx.sdkRootReal !== null &&
          !isWithin(ctx.sdkRootReal, imageReal)
        ) {
          health.error('unsafe', 'image', 'image-sysdir-escape', msg('rcSysdirEscape'))
        } else {
          await applyImageCheck(health, meta, imageDir, imageReal, dirIdentity, configAbi, ctx, d)
        }
      }
    }
  }

  return health.result(now)
}

const applyImageCheck = async (
  health: HealthBuilder,
  meta: DeviceMeta,
  imageDir: string,
  imageReal: string | null,
  dirIdentity: { platformSegment: string; tagSegment: string; abi: string } | null,
  configAbi: string | null,
  ctx: RootContext,
  d: Required<ReconcileFsDeps>
): Promise<void> => {
  // 共享镜像每轮只读一次（设计 2/设计 4；review P3）：按 canonical 路径去重缓存
  const cacheKey = imageReal ?? imageDir
  let cached = ctx.imageChecks.get(cacheKey)
  if (cached === undefined) {
    cached = checkLocalImage(imageDir, dirIdentity, {
      readdir: d.readdir,
      readFile: d.readFile,
      exists: async (path) => {
        try {
          await d.lstat(path)
          return true
        } catch {
          return false
        }
      },
      lstat: d.lstat
    })
    ctx.imageChecks.set(cacheKey, cached)
    cached.catch(() => undefined) // 迟到失败不产生 unhandled rejection
  }
  const check = await cached
  if (check.fault !== null) {
    const mapped = imageFaultState[check.fault]
    health.error(
      mapped.state,
      'image',
      mapped.code,
      withOriginHint(meta, mapped.state, check.faultMessage ?? msg('rcImageVerifyFailed'))
    )
    return
  }
  // 实际镜像 ABI 与 config 的 abi.type 矛盾 = broken（emulator 按后者启动会失败）
  if (check.abi !== null && configAbi !== null && check.abi !== configAbi) {
    health.error(
      'broken',
      'image',
      'abi-mismatch',
      msg('rcAbiMismatch', { configAbi, abi: check.abi })
    )
  }
  // 元数据身份与实际不同 = warning（保留两份身份，不改元数据、不自动下载）
  if (check.packageName !== null && check.packageName !== meta.imagePackageName) {
    health.warning(
      'image',
      'image-identity-differs',
      msg('rcImageIdentityDiffers', { actual: check.packageName, saved: meta.imagePackageName })
    )
  }
}

/** 并发池：每设备最多 4 路并发 */
const runPool = async <T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>
): Promise<void> => {
  let cursor = 0
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor
      cursor += 1
      if (index >= items.length) return
      await worker(items[index]!)
    }
  })
  await Promise.all(lanes)
}

const withTimeout = (
  promise: Promise<DeviceAvailability>,
  now: () => number
): Promise<DeviceAvailability> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timed = new Promise<DeviceAvailability>((resolveTimer) => {
    timer = setTimeout(() => {
      resolveTimer({
        state: 'inaccessible',
        issues: [
          {
            component: 'avd',
            code: 'check-timeout',
            message: msg('rcCheckTimeout', { seconds: CHECK_TIMEOUT_MS / 1000 }),
            severity: 'error'
          }
        ],
        checkedAt: now()
      })
    }, CHECK_TIMEOUT_MS)
  })
  promise.catch(() => undefined) // 迟到失败不产生 unhandled rejection
  return Promise.race([promise, timed]).finally(() => clearTimeout(timer))
}

const rootAvailability = (
  now: number,
  code: string,
  message: string,
  state: 'missing' | 'inaccessible' | 'unsafe'
): DeviceAvailability => ({
  state,
  issues: [{ component: 'avd', code, message, severity: 'error' }],
  checkedAt: now
})

/** 孤立组扫描：avdHome 顶层按同名 .ini/.avd 组合；非 UUID 名只计数不拼路径 */
const scanOrphans = async (
  request: ReconcileRequest,
  d: Required<ReconcileFsDeps>
): Promise<{
  orphans: ReconcileOrphanEntry[]
  unrecognizedCount: number
  rootMissing: boolean
}> => {
  let names: string[]
  try {
    names = await d.readdir(request.dirs.avdHome)
  } catch (error) {
    if (errnoOf(error) === 'ENOENT') return { orphans: [], unrecognizedCount: 0, rootMissing: true }
    throw error
  }
  const iniStems = new Set<string>()
  const avdStems = new Set<string>()
  for (const name of names) {
    if (name.endsWith('.ini')) iniStems.add(name.slice(0, -'.ini'.length))
    else if (name.endsWith('.avd')) avdStems.add(name.slice(0, -'.avd'.length))
  }
  const metaIds = new Set(request.metas.map((meta) => meta.id))
  const orphans: ReconcileOrphanEntry[] = []
  let unrecognizedCount = 0
  for (const stem of new Set([...iniStems, ...avdStems])) {
    if (!UUID_RE.test(stem)) {
      unrecognizedCount += 1
      continue
    }
    if (request.transientIds.has(stem)) continue
    if (metaIds.has(stem)) continue // 设备行自身的缺失已在单目标核验归因
    const linked = request.badMetaIds.has(stem)
    const hasIni = iniStems.has(stem)
    const hasAvd = avdStems.has(stem)
    const detail =
      hasIni && hasAvd ? msg('rcFullGroup') : hasIni ? msg('rcIniOnlyGroup') : msg('rcAvdOnlyGroup')
    orphans.push({
      id: stem,
      kind: linked ? 'metadata-linked' : 'orphan',
      detail: linked ? msg('rcMetaAnomalySuffix', { detail }) : msg('rcNoMetaSuffix', { detail }),
      // 完整组选 .avd 目录（处置语义：Finder 定位到目录，ini 同名可循）；缺 avd 用 ini
      path: join(request.dirs.avdHome, `${stem}.${hasAvd ? 'avd' : 'ini'}`)
    })
  }
  orphans.sort((a, b) => a.id.localeCompare(b.id))
  return { orphans, unrecognizedCount, rootMissing: false }
}

/**
 * 全量对账：根核验 → 每设备单目标核验（4 路并发、3s 期限、可取消）→ 孤立组。
 * 根缺失且无设备 = 首次使用；根缺失但有设备 = 逐行 missing；根不可读 = scanError
 * + 全部 inaccessible（不构造「全部已删」）。迟到/取消结果由调用方丢弃。
 */
export const runReconciliation = async (
  request: ReconcileRequest,
  deps: ReconcileFsDeps = {}
): Promise<ReconcileOutcome> => {
  const d = { ...defaultDeps, ...deps }
  const checkedAt = d.now()
  const availabilityById = new Map<string, DeviceAvailability>()
  request.signal?.throwIfAborted()

  // ---- 根核验 ----
  let rootFault: 'missing' | 'inaccessible' | 'not-directory' | 'symlink' | null = null
  let avdHomeReal: string | null = null
  try {
    const info = await d.lstat(request.dirs.avdHome)
    if (info.isSymbolicLink()) rootFault = 'symlink'
    else if (!info.isDirectory()) rootFault = 'not-directory'
    else {
      avdHomeReal = await d.realpath(request.dirs.avdHome)
      // 可读性探测（打开目录）：EACCES 即根不可读，不进入逐设备检查
      await d.readdir(request.dirs.avdHome)
    }
  } catch (error) {
    rootFault = errnoOf(error) === 'ENOENT' ? 'missing' : 'inaccessible'
  }
  if (rootFault === 'missing' && request.metas.length === 0) {
    // 首次使用：空根 + 无设备，不算异常（孤立组扫描对缺失根也返回空）
    return { checkedAt, availabilityById, orphans: [], unrecognizedCount: 0, scanError: null }
  }

  const sdkRootReal = await realpathOrNull(request.dirs.sdkRoot, d)
  const skinsRootReal = await realpathOrNull(request.dirs.skinsRoot, d)
  const ctx: RootContext = {
    dirs: request.dirs,
    avdHomeReal,
    sdkRootReal,
    skinsRootReal,
    imageChecks: new Map()
  }

  let scanError: string | null = null
  if (rootFault === 'missing') {
    for (const meta of request.metas) {
      availabilityById.set(
        meta.id,
        rootAvailability(checkedAt, 'avd-home-missing', msg('rcAvdRootMissing'), 'missing')
      )
    }
  } else if (rootFault === 'symlink') {
    // 设计 2.1「根自身逃逸为 unsafe」：根 symlink 一律 unsafe，不当「读不了」降格
    const message = msg('rcAvdRootIsSymlink', { dir: request.dirs.avdHome })
    scanError = message
    for (const meta of request.metas) {
      availabilityById.set(
        meta.id,
        rootAvailability(checkedAt, 'avd-home-symlink', message, 'unsafe')
      )
    }
  } else if (rootFault !== null) {
    const message =
      rootFault === 'inaccessible'
        ? msg('rcAvdRootUnreadable', { dir: request.dirs.avdHome })
        : msg('rcAvdRootNotDir', { dir: request.dirs.avdHome })
    scanError = message
    for (const meta of request.metas) {
      availabilityById.set(
        meta.id,
        rootAvailability(checkedAt, 'avd-home-inaccessible', message, 'inaccessible')
      )
    }
  } else {
    // ---- 单目标核验（并发池 + 期限）----
    await runPool(request.metas, MAX_CONCURRENCY, async (meta) => {
      request.signal?.throwIfAborted()
      const promise = checkDeviceHealthWithContext(meta, ctx, d, checkedAt)
      availabilityById.set(meta.id, await withTimeout(promise, d.now))
    })
  }

  // ---- 孤立组 ----
  let orphans: ReconcileOrphanEntry[] = []
  let unrecognizedCount = 0
  if (rootFault === null || rootFault === 'missing') {
    try {
      const outcome = await scanOrphans(request, d)
      orphans = outcome.orphans
      unrecognizedCount = outcome.unrecognizedCount
    } catch (error) {
      scanError =
        scanError ??
        msg('rcOrphanScanFailed', {
          message: error instanceof Error ? error.message : String(error)
        })
    }
  }

  return { checkedAt, availabilityById, orphans, unrecognizedCount, scanError }
}

/** 与 checkDeviceHealth 同逻辑但复用扫描级 realpath 上下文（共享根解析，每轮只读一次） */
const checkDeviceHealthWithContext = async (
  meta: DeviceMeta,
  ctx: RootContext,
  d: Required<ReconcileFsDeps>,
  now: number
): Promise<DeviceAvailability> => {
  const health = new HealthBuilder()
  try {
    return await checkDeviceWith(health, meta, ctx, d, now)
  } catch (error) {
    // 单目标意外失败不影响整轮：归因为 inaccessible，不冒充 missing
    health.error(
      'inaccessible',
      'avd',
      'check-error',
      msg('rcCheckFailed', { message: error instanceof Error ? error.message : String(error) })
    )
    return health.result(now)
  }
}
