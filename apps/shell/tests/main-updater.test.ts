import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const appState = { isPackaged: true }
const appOn = vi.fn()

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return appState.isPackaged
    },
    on: (...args: unknown[]) => appOn(...args),
    dock: undefined,
  },
  Notification: {
    isSupported: () => false,
  },
}))

const existsSync = vi.fn(() => false)
const readFileSync = vi.fn()

vi.mock('node:fs', () => ({
  existsSync: (...args: unknown[]) => existsSync(...args),
  readFileSync: (...args: unknown[]) => readFileSync(...args),
}))

const spawn = vi.fn()

vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => spawn(...args),
}))

const showUpdateWindow = vi.fn()
const pushUpdateState = vi.fn()
const closeUpdateWindow = vi.fn()

vi.mock('../src/main/update-window', () => ({
  showUpdateWindow: (...args: unknown[]) => showUpdateWindow(...args),
  pushUpdateState: (...args: unknown[]) => pushUpdateState(...args),
  closeUpdateWindow: (...args: unknown[]) => closeUpdateWindow(...args),
}))

const initialState = vi.fn((version: string) => ({
  phase: 'available',
  version,
  currentVersion: '0.0.0',
  percent: 0,
  strings: {},
}))

vi.mock('../src/main/updater', () => ({
  initialState: (...args: unknown[]) => initialState(...args),
}))

async function loadMainUpdater() {
  return import('../src/main/main-updater')
}

const BUILT_SHA = 'a'.repeat(40)
const MAIN_SHA = 'b'.repeat(40)
const TAG_SHA = 'c'.repeat(40)

/** fake child_process.ChildProcess with manual emit control. The caller
 * schedules a process.nextTick that calls emitData()/emit('close') AFTER the
 * real module attached its listeners (vi.useFakeTimers() also fakes
 * queueMicrotask, so nextTick is the reliable async primitive here) */
function fakeChild() {
  const listeners: Record<string, Array<(...args: unknown[]) => void>> = {}
  return {
    stdout: {
      on: (ev: string, cb: (d: Buffer) => void) => {
        listeners[`stdout:${ev}`] = [...(listeners[`stdout:${ev}`] ?? []), cb]
      },
    },
    stderr: { on: () => {} },
    on: (ev: string, cb: (...args: unknown[]) => void) => {
      listeners[ev] = [...(listeners[ev] ?? []), cb]
    },
    emit(ev: string, ...args: unknown[]) {
      for (const cb of listeners[ev] ?? []) cb(...args)
    },
    emitData(data: string) {
      for (const cb of listeners['stdout:data'] ?? []) cb(Buffer.from(data))
    },
  }
}

/** wire the fake spawn: ls-remote main → MAIN_SHA, ls-remote --tags →
 * tagScript (test-controlled), everything else → close(0) */
function mockLsRemote(tagScript: () => string): void {
  spawn.mockImplementation((cmd: string, args: string[]) => {
    const child = fakeChild()
    process.nextTick(() => {
      if (args.includes('refs/heads/main')) {
        child.emitData(`${MAIN_SHA}\trefs/heads/main\n`)
      } else if (args.includes('--tags')) {
        child.emitData(tagScript())
      }
      child.emit('close', 0)
    })
    return child
  })
}

const realPlatform = process.platform
const realArch = process.arch

beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers()
  appState.isPackaged = true
  // the main-updater only arms on macOS/Windows; pin darwin so the check flow
  // runs identically on Linux CI runners
  Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
  // Electron-only in packaged builds; the fs mock keys off the path suffix,
  // so an arbitrary value is fine — but it must be a string
  process.resourcesPath = '/fake/resources'
  appOn.mockClear()
  existsSync.mockReset()
  existsSync.mockReturnValue(false)
  readFileSync.mockReset()
  spawn.mockReset()
  showUpdateWindow.mockClear()
  pushUpdateState.mockClear()
  closeUpdateWindow.mockClear()
  initialState.mockClear()
  delete process.env.HERMESOFFICE_ENABLE_SOURCE_UPDATE
})

afterEach(() => {
  vi.useRealTimers()
  Object.defineProperty(process, 'platform', { value: realPlatform, configurable: true })
  Object.defineProperty(process, 'arch', { value: realArch, configurable: true })
  delete process.env.HERMESOFFICE_ENABLE_SOURCE_UPDATE
})

describe('initMainUpdater gating', () => {
  it('schedules checks for packaged builds without a CDN feed (binary path needs no opt-in)', async () => {
    const { initMainUpdater } = await loadMainUpdater()
    initMainUpdater(() => null)

    expect(vi.getTimerCount()).toBeGreaterThan(0)
    expect(appOn).toHaveBeenCalled()
    expect(spawn).not.toHaveBeenCalled()
  })

  it('stays idle when a CDN app-update.yml feed is present even if source updates are enabled', async () => {
    process.env.HERMESOFFICE_ENABLE_SOURCE_UPDATE = '1'
    existsSync.mockImplementation((path) => String(path).endsWith('app-update.yml'))

    const { initMainUpdater } = await loadMainUpdater()
    initMainUpdater(() => null)

    expect(vi.getTimerCount()).toBe(0)
    expect(appOn).not.toHaveBeenCalled()
    expect(spawn).not.toHaveBeenCalled()
  })
})

describe('update check version labels', () => {
  function bootWithUpdate(): void {
    process.env.HERMESOFFICE_ENABLE_SOURCE_UPDATE = '1'
    // build-info.json present, app-update.yml absent, no pre-existing source dir
    existsSync.mockImplementation((path) => String(path).endsWith('build-info.json'))
    readFileSync.mockReturnValue(JSON.stringify({ commit: BUILT_SHA, version: '0.4.0' }))
    mockLsRemote(() => tagScript)
  }

  // set by each test before initMainUpdater runs
  let tagScript = ''

  it('labels the target as "build <sha>" when no ho-v tag exists (no bare SHA)', async () => {
    tagScript = ''
    bootWithUpdate()

    const { initMainUpdater } = await loadMainUpdater()
    initMainUpdater(() => null)
    await vi.advanceTimersByTimeAsync(15_000)

    expect(showUpdateWindow).toHaveBeenCalledTimes(1)
    const state = showUpdateWindow.mock.calls[0][1]
    expect(state.version).toBe(`build ${MAIN_SHA.slice(0, 7)}`)
  })

  it('shows the ho-v tag SemVer when main sits on a release tag', async () => {
    tagScript = `${TAG_SHA}\trefs/tags/ho-v0.5.0\n`
    bootWithUpdate()
    // main IS the tag commit → plain SemVer, no build metadata
    spawn.mockImplementation((cmd: string, args: string[]) => {
      const child = fakeChild()
      process.nextTick(() => {
        if (args.includes('refs/heads/main')) {
          child.emitData(`${TAG_SHA}\trefs/heads/main\n`)
        } else if (args.includes('--tags')) {
          child.emitData(tagScript)
        }
        child.emit('close', 0)
      })
      return child
    })

    const { initMainUpdater } = await loadMainUpdater()
    initMainUpdater(() => null)
    await vi.advanceTimersByTimeAsync(15_000)

    expect(showUpdateWindow).toHaveBeenCalledTimes(1)
    const state = showUpdateWindow.mock.calls[0][1]
    expect(state.version).toBe('0.5.0')
  })

  it('stays up to date when the installed release base equals the newest tag', async () => {
    tagScript = `${TAG_SHA}\trefs/tags/ho-v0.4.0\n`
    bootWithUpdate()

    const { initMainUpdater } = await loadMainUpdater()
    initMainUpdater(() => null)
    await vi.advanceTimersByTimeAsync(15_000)

    expect(showUpdateWindow).not.toHaveBeenCalled()
  })

  it('offers the newer tag SemVer even when main has moved past it (release-train)', async () => {
    tagScript = `${TAG_SHA}\trefs/tags/ho-v0.5.0\n`
    bootWithUpdate()

    const { initMainUpdater } = await loadMainUpdater()
    initMainUpdater(() => null)
    await vi.advanceTimersByTimeAsync(15_000)

    expect(showUpdateWindow).toHaveBeenCalledTimes(1)
    const state = showUpdateWindow.mock.calls[0][1]
    expect(state.version).toBe('0.5.0')
  })
})

describe('binary release updates (no source opt-in)', () => {
  function bootTagUpdate(): void {
    // build-info present, no app-update.yml, no source opt-in env
    existsSync.mockImplementation((path) => String(path).endsWith('build-info.json'))
    readFileSync.mockReturnValue(JSON.stringify({ commit: BUILT_SHA, version: '0.4.0' }))
    spawn.mockImplementation((cmd: string, args: string[]) => {
      const child = fakeChild()
      process.nextTick(() => {
        if (args.includes('refs/heads/main')) {
          child.emitData(`${MAIN_SHA}\trefs/heads/main\n`)
        } else if (args.includes('--tags')) {
          child.emitData(`${TAG_SHA}\trefs/tags/ho-v0.5.0\n`)
        }
        child.emit('close', 0)
      })
      return child
    })
  }

  it('offers a newer ho-v tag without HERMESOFFICE_ENABLE_SOURCE_UPDATE', async () => {
    bootTagUpdate()

    const { initMainUpdater } = await loadMainUpdater()
    initMainUpdater(() => null)
    await vi.advanceTimersByTimeAsync(15_000)

    expect(showUpdateWindow).toHaveBeenCalledTimes(1)
    expect(showUpdateWindow.mock.calls[0][1].version).toBe('0.5.0')
  })

  it('downloads via stage-binary — no git clone, no npm build', async () => {
    bootTagUpdate()
    Object.defineProperty(process, 'arch', { value: 'arm64', configurable: true })

    const spawnArgs: string[][] = []
    spawn.mockImplementation((cmd: string, args: string[]) => {
      spawnArgs.push([cmd, ...args])
      const child = fakeChild()
      process.nextTick(() => {
        if (args.includes('refs/heads/main')) {
          child.emitData(`${MAIN_SHA}\trefs/heads/main\n`)
        } else if (args.includes('--tags')) {
          child.emitData(`${TAG_SHA}\trefs/tags/ho-v0.5.0\n`)
        }
        child.emit('close', 0)
      })
      return child
    })

    const { initMainUpdater } = await loadMainUpdater()
    initMainUpdater(() => null)
    await vi.advanceTimersByTimeAsync(15_000)

    const actions = showUpdateWindow.mock.calls[0][2] as { onDownload: () => void }
    actions.onDownload()
    await vi.advanceTimersByTimeAsync(100)

    const stageCall = spawnArgs.find((c) => c.includes('stage-binary'))
    expect(stageCall).toBeDefined()
    expect(stageCall).toContain('ho-v0.5.0')
    expect(stageCall).toContain('0.5.0')
    expect(spawnArgs.find((c) => c[0] === 'git' && c[1] === 'clone')).toBeUndefined()
    expect(pushUpdateState).toHaveBeenCalledWith({ phase: 'downloaded', percent: 100 })
  })

  it('does not offer a tagless main move without the source opt-in', async () => {
    existsSync.mockImplementation((path) => String(path).endsWith('build-info.json'))
    readFileSync.mockReturnValue(JSON.stringify({ commit: BUILT_SHA, version: '0.4.0' }))
    spawn.mockImplementation((cmd: string, args: string[]) => {
      const child = fakeChild()
      process.nextTick(() => {
        if (args.includes('refs/heads/main')) {
          child.emitData(`${MAIN_SHA}\trefs/heads/main\n`)
        } else if (args.includes('--tags')) {
          child.emitData('')
        }
        child.emit('close', 0)
      })
      return child
    })

    const { initMainUpdater } = await loadMainUpdater()
    initMainUpdater(() => null)
    await vi.advanceTimersByTimeAsync(15_000)

    expect(showUpdateWindow).not.toHaveBeenCalled()
  })
})

describe('first download (ensureSource)', () => {
  it('clones a full working tree — no --no-checkout — before spawning the helper', async () => {
    process.env.HERMESOFFICE_ENABLE_SOURCE_UPDATE = '1'
    // non-arm64 → the binary release path is unavailable, so the opt-in
    // source rebuild (clone + build) is what onDownload must exercise
    Object.defineProperty(process, 'arch', { value: 'x64', configurable: true })
    existsSync.mockImplementation((path) => String(path).endsWith('build-info.json'))
    readFileSync.mockReturnValue(JSON.stringify({ commit: BUILT_SHA, version: '0.4.0' }))

    const spawnArgs: string[][] = []
    spawn.mockImplementation((cmd: string, args: string[]) => {
      spawnArgs.push([cmd, ...args])
      const child = fakeChild()
      process.nextTick(() => {
        if (args.includes('refs/heads/main')) child.emitData(`${MAIN_SHA}\trefs/heads/main\n`)
        else if (args.includes('--tags')) child.emitData(`${TAG_SHA}\trefs/tags/ho-v0.5.0\n`)
        child.emit('close', 0)
      })
      return child
    })

    const { initMainUpdater } = await loadMainUpdater()
    initMainUpdater(() => null)
    await vi.advanceTimersByTimeAsync(15_000)

    // trigger the download flow the UI wires to the "update" button
    const actions = showUpdateWindow.mock.calls[0][2] as { onDownload: () => void }
    actions.onDownload()
    await vi.advanceTimersByTimeAsync(100)

    const cloneCall = spawnArgs.find((c) => c[0] === 'git' && c[1] === 'clone')
    expect(cloneCall).toBeDefined()
    expect(cloneCall).not.toContain('--no-checkout')
    expect(cloneCall).toContain('--filter=blob:none')
  })
})
