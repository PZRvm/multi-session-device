// @vitest-environment node
import { spawn } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import { resolveCommand, spawnCommand, tarBinFor } from '../platformExec'

describe('resolveCommand（.bat 包装规则）', () => {
  it('非 win32 平台原样透传', () => {
    expect(resolveCommand('darwin', '/sdk/bin/sdkmanager', ['--version'])).toEqual({
      command: '/sdk/bin/sdkmanager',
      args: ['--version']
    })
  })

  it('win32 的 .bat/.cmd 经 cmd.exe /c 包装（扩展名大小写不敏感）', () => {
    expect(resolveCommand('win32', 'C:\\sdk\\bin\\sdkmanager.bat', ['--list'])).toEqual({
      command: 'cmd.exe',
      args: ['/c', 'C:\\sdk\\bin\\sdkmanager.bat', '--list']
    })
    expect(resolveCommand('win32', 'C:\\sdk\\bin\\avdmanager.BAT', [])).toEqual({
      command: 'cmd.exe',
      args: ['/c', 'C:\\sdk\\bin\\avdmanager.BAT']
    })
  })

  it('win32 的非脚本二进制（.exe/无后缀）直接 spawn', () => {
    expect(resolveCommand('win32', 'C:\\sdk\\emulator\\emulator.exe', ['-avd', 'x'])).toEqual({
      command: 'C:\\sdk\\emulator\\emulator.exe',
      args: ['-avd', 'x']
    })
    expect(resolveCommand('win32', 'C:\\tools\\java.exe', [])).toEqual({
      command: 'C:\\tools\\java.exe',
      args: []
    })
  })
})

describe('spawnCommand', () => {
  it('按平台解析命令并统一注入 windowsHide', () => {
    const spawnFn = vi.fn(() => ({ pid: 1 }))
    spawnCommand(
      { platform: 'win32', spawnFn: spawnFn as unknown as typeof spawn },
      'C:\\tools\\a.bat',
      ['x'],
      { cwd: '/w' }
    )
    expect(spawnFn).toHaveBeenCalledWith('cmd.exe', ['/c', 'C:\\tools\\a.bat', 'x'], {
      cwd: '/w',
      windowsHide: true
    })
  })

  it('darwin 透传命令但同样带 windowsHide（posix 无副作用）', () => {
    const spawnFn = vi.fn(() => ({ pid: 1 }))
    spawnCommand(
      { platform: 'darwin', spawnFn: spawnFn as unknown as typeof spawn },
      '/tools/tar',
      ['-xf', 'a']
    )
    expect(spawnFn).toHaveBeenCalledWith('/tools/tar', ['-xf', 'a'], { windowsHide: true })
  })
})

describe('tarBinFor', () => {
  it('win32 用系统自带 tar.exe（bsdtar），其余平台用 tar', () => {
    expect(tarBinFor('win32')).toBe('tar.exe')
    expect(tarBinFor('darwin')).toBe('tar')
    expect(tarBinFor('linux')).toBe('tar')
  })
})
