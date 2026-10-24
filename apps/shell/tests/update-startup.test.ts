import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  existsSync: vi.fn(),
  app: { isPackaged: true },
  source: vi.fn(),
  server: vi.fn(),
  sourceCheck: vi.fn(),
  serverCheck: vi.fn(),
}))
vi.mock('electron', () => ({ app: mocks.app }))
vi.mock('node:fs', () => ({ existsSync: mocks.existsSync }))
vi.mock('../src/main/main-updater', () => ({
  initMainUpdater: mocks.source,
  checkMainUpdatesNow: mocks.sourceCheck,
}))
vi.mock('../src/main/updater', () => ({
  initAutoUpdater: mocks.server,
  checkForUpdatesNow: mocks.serverCheck,
}))
import { checkAppUpdatesNow, initAppUpdater } from '../src/main/update-startup'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.app.isPackaged = true
  process.resourcesPath = '/test/resources'
})

describe('application update startup', () => {
  it('preserves the unpackaged updater preview', () => {
    mocks.app.isPackaged = false
    initAppUpdater(() => null, 'stable')
    expect(mocks.server).toHaveBeenCalledOnce()
    expect(mocks.source).not.toHaveBeenCalled()
  })

  it('starts the source updater for a build without a server feed', () => {
    mocks.existsSync.mockReturnValue(false)
    const window = () => null
    initAppUpdater(window, 'stable')
    expect(mocks.existsSync).toHaveBeenCalledWith('/test/resources/app-update.yml')
    expect(mocks.source).toHaveBeenCalledWith(window)
    expect(mocks.server).not.toHaveBeenCalled()
  })

  it('uses only the server updater when a feed is packaged', () => {
    mocks.existsSync.mockReturnValue(true)
    const window = () => null
    initAppUpdater(window, 'beta')
    expect(mocks.server).toHaveBeenCalledWith(window, 'beta')
    expect(mocks.source).not.toHaveBeenCalled()
  })
})

describe('manual application update checks', () => {
  it('uses the source transport without a packaged feed', async () => {
    mocks.existsSync.mockReturnValue(false)
    const window = () => null
    await checkAppUpdatesNow(window)
    expect(mocks.sourceCheck).toHaveBeenCalledWith(window)
    expect(mocks.serverCheck).not.toHaveBeenCalled()
  })
  it('uses the server transport with a packaged feed', async () => {
    mocks.existsSync.mockReturnValue(true)
    await checkAppUpdatesNow(() => null)
    expect(mocks.serverCheck).toHaveBeenCalledOnce()
    expect(mocks.sourceCheck).not.toHaveBeenCalled()
  })
})
