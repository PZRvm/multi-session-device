// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ServerOptions } from 'vite'

const mocks = vi.hoisted(() => ({ read: vi.fn(() => '{"port":6175}') }))
vi.mock('node:fs', () => ({ existsSync: () => true, readFileSync: mocks.read }))
vi.mock('electron-vite', () => ({ defineConfig: (config: unknown) => config }))
vi.mock('@vitejs/plugin-react', () => ({ default: () => ({ name: 'react-fixture' }) }))

async function server(command: 'serve' | 'build' = 'serve'): Promise<ServerOptions | undefined> {
  const { default: config } = await import('../../../electron.vite.config')
  const resolved = typeof config === 'function' ? config({ command, mode: 'development' }) : config
  return resolved.renderer?.server
}

beforeEach(() => {
  vi.resetModules()
  mocks.read.mockReset().mockReturnValue('{"port":6175}')
  vi.stubEnv('MSD_DEV_PORT', '')
})
afterEach(() => vi.unstubAllEnvs())

describe('工作区开发端口配置', () => {
  it('有效环境变量优先，完全不读取元数据', async () => {
    vi.stubEnv('MSD_DEV_PORT', '6180')
    mocks.read.mockImplementation(() => {
      throw new Error('unreadable')
    })
    expect(await server()).toMatchObject({ port: 6180, strictPort: true })
    expect(mocks.read).not.toHaveBeenCalled()
  })

  it('没有覆盖时使用有效的工作区登记端口', async () => {
    expect(await server()).toMatchObject({ port: 6175, strictPort: true })
  })

  it.each([
    '{',
    'null',
    '[]',
    '{}',
    '{"port":"6175"}',
    '{"port":0}',
    '{"port":-1}',
    '{"port":65536}',
    '{"port":6175.5}'
  ])('忽略无效元数据 %s，回退到 6174', async (metadata) => {
    mocks.read.mockReturnValue(metadata)
    expect(await server()).toMatchObject({ port: 6174, strictPort: true })
  })

  it.each(['ENOENT', 'EACCES'])('元数据读取失败 %s 不阻断启动', async (code) => {
    mocks.read.mockImplementation(() => {
      throw Object.assign(new Error(code), { code })
    })
    expect(await server()).toMatchObject({ port: 6174, strictPort: true })
  })

  it.each(['bad', '-1', '65536', '6174.5'])('非法覆盖 %s 继续使用登记端口', async (override) => {
    vi.stubEnv('MSD_DEV_PORT', override)
    expect(await server()).toMatchObject({ port: 6175, strictPort: true })
  })

  it.each([1, 65535])('接受边界端口 %i', async (port) => {
    mocks.read.mockReturnValue(JSON.stringify({ port }))
    expect(await server()).toMatchObject({ port, strictPort: true })
  })

  it('构建不读取本地调试元数据或使用覆盖端口', async () => {
    vi.stubEnv('MSD_DEV_PORT', '6180')
    mocks.read.mockImplementation(() => {
      throw new Error('unreadable')
    })
    expect(await server('build')).toMatchObject({ port: 6174, strictPort: true })
    expect(mocks.read).not.toHaveBeenCalled()
  })
})
