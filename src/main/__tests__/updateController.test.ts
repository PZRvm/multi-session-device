import { describe, expect, it, vi } from 'vitest'
import {
  createUpdateController,
  type UpdateControllerDeps,
  type UpdateEngine
} from '../updateController'

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- 保留 Vitest mock 的推断类型
const fixture = () => {
  const deps = {
    version: '90.0.1',
    policy: { showHeaderEntry: true, showSettingsEntry: true },
    enabled: true,
    engine: {
      check: vi.fn(async () => {}),
      download: vi.fn<UpdateEngine['download']>(async () => {}),
      install: vi.fn()
    },
    publish: vi.fn(),
    confirm: vi.fn(async () => true),
    busy: vi.fn(() => false),
    prepare: vi.fn(async () => {}),
    resume: vi.fn(),
    beforeInstall: vi.fn()
  } satisfies UpdateControllerDeps
  return { deps, controller: createUpdateController(deps) }
}

describe('app update install authorization', () => {
  it('checks without downloading and ignores stale download completion', async () => {
    const { deps, controller } = fixture()
    deps.engine.check.mockImplementationOnce(async () => controller.available('90.0.2', 'notes'))
    expect((await controller.check()).status).toBe('available')
    expect(deps.engine.download).not.toHaveBeenCalled()
    deps.engine.download.mockImplementationOnce(async () => {
      controller.downloaded('90.0.3')
      expect(controller.getState().downloadedVersion).toBeNull()
      controller.downloaded('90.0.2')
    })
    expect((await controller.download()).downloadedVersion).toBe('90.0.2')
  })

  it('returns to available with new notes when a retry discovers a different candidate', async () => {
    const { deps, controller } = fixture()
    deps.engine.check.mockImplementationOnce(async () => controller.available('90.0.2', '旧说明'))
    await controller.check()
    deps.engine.download.mockRejectedValueOnce(new Error('download interrupted'))
    expect((await controller.download()).error).toBe('download')
    deps.engine.download.mockResolvedValueOnce({
      candidate: { version: '90.0.3', releaseNotes: '新说明', releaseDate: null }
    })
    expect(await controller.download()).toMatchObject({
      status: 'available',
      candidateVersion: '90.0.3',
      releaseNotes: '新说明',
      downloadedVersion: null,
      progress: null,
      error: null
    })
    expect(deps.engine.download).toHaveBeenNthCalledWith(2, '90.0.2')
    expect(deps.confirm).not.toHaveBeenCalled()
    deps.engine.download.mockImplementationOnce(async () => controller.downloaded('90.0.3'))
    expect((await controller.download()).downloadedVersion).toBe('90.0.3')
    expect(deps.engine.download).toHaveBeenNthCalledWith(3, '90.0.3')
  })

  it('settles a withdrawn candidate or an unmatched completion instead of hanging', async () => {
    const { deps, controller } = fixture()
    deps.engine.check.mockImplementationOnce(async () => controller.available('90.0.2'))
    await controller.check()
    deps.engine.download.mockImplementationOnce(async () => controller.downloaded('90.0.3'))
    expect(await controller.download()).toMatchObject({ status: 'error', error: 'download' })
    deps.engine.download.mockResolvedValueOnce({ candidate: null })
    expect(await controller.download()).toMatchObject({
      status: 'up-to-date',
      candidateVersion: null,
      downloadedVersion: null
    })
  })

  it('requires user permission and refuses install when preparation fails', async () => {
    const { deps, controller } = fixture()
    deps.engine.check.mockImplementationOnce(async () => controller.available('90.0.2'))
    deps.engine.download.mockImplementationOnce(async () => controller.downloaded('90.0.2'))
    await controller.check()
    await controller.download()
    deps.confirm.mockResolvedValueOnce(false)
    expect((await controller.install()).status).toBe('ready')
    expect(deps.prepare).not.toHaveBeenCalled()
    deps.prepare.mockRejectedValueOnce(new Error('device write failed'))
    expect((await controller.install()).error).toBe('save')
    expect(deps.resume).toHaveBeenCalledOnce()
    expect(deps.engine.install).not.toHaveBeenCalled()
    expect((await controller.install()).status).toBe('installing')
    expect(deps.beforeInstall).toHaveBeenCalledBefore(deps.engine.install)
    expect(deps.engine.install).toHaveBeenCalledOnce()
  })
})
