import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** Consent-gated gateway launcher (src/main/hermes-launcher.ts, issue #7). */

let userData = ''
const showMessageBox = vi.fn<() => Promise<{ response: number; checkboxChecked: boolean }>>()

vi.mock('electron', () => ({
  app: { getPath: () => userData },
  dialog: {
    showMessageBox: (_win: unknown, opts: unknown) => showMessageBox(opts as never),
  },
}))

const spawned: Array<{ cmd: string; args: string[] }> = []
const childProcess = {
  whichResult: { status: 0, stdout: '/usr/local/bin/hermes\n' } as {
    status: number
    stdout: string
  },
}
vi.mock('node:child_process', () => ({
  spawnSync: () => childProcess.whichResult,
  spawn: (cmd: string, args: string[]) => {
    spawned.push({ cmd, args })
    return { on: () => {}, unref: () => {} }
  },
}))

// health probe: scripted responses per fetch call
let healthResponses: boolean[] = []
const fetchMock = vi.fn(async () => {
  const healthy = healthResponses.shift() ?? false
  if (!healthy) throw new Error('ECONNREFUSED')
  return new Response('{}', { status: 200 })
})
vi.stubGlobal('fetch', fetchMock)

const STRINGS = {
  title: 'Hermes gateway',
  body: 'Start it now?',
  start: 'Start',
  notNow: 'Not now',
  never: "Don't ask again",
  always: 'Always start automatically',
  failed: 'failed',
}

const win = {} as never

async function run() {
  const { ensureHermesGateway } = await import('../src/main/hermes-launcher')
  return ensureHermesGateway(() => win, STRINGS)
}

beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers()
  userData = mkdtempSync(join(tmpdir(), 'hermes-launcher-'))
  spawned.length = 0
  healthResponses = []
  showMessageBox.mockReset()
  fetchMock.mockClear()
  childProcess.whichResult = { status: 0, stdout: '/usr/local/bin/hermes\n' }
})

afterEach(() => {
  vi.useRealTimers()
})

describe('ensureHermesGateway', () => {
  it('does nothing when the gateway is already healthy', async () => {
    healthResponses = [true]
    await expect(run()).resolves.toBe('healthy')
    expect(showMessageBox).not.toHaveBeenCalled()
    expect(spawned).toHaveLength(0)
  })

  it('gives up quietly when no hermes CLI is on the host', async () => {
    childProcess.whichResult = { status: 1, stdout: '' }
    await expect(run()).resolves.toBe('no-cli')
    expect(showMessageBox).not.toHaveBeenCalled()
  })

  it('asks for consent and starts the gateway on accept, polling until healthy', async () => {
    showMessageBox.mockResolvedValue({ response: 0, checkboxChecked: false })
    healthResponses = [false, true] // initial probe fails, first poll succeeds
    const result = run()
    await vi.advanceTimersByTimeAsync(2_000)
    await expect(result).resolves.toBe('started')
    expect(spawned).toEqual([{ cmd: '/usr/local/bin/hermes', args: ['gateway', 'start'] }])
  })

  it('does not start anything when the user declines', async () => {
    showMessageBox.mockResolvedValue({ response: 1, checkboxChecked: false })
    await expect(run()).resolves.toBe('declined')
    expect(spawned).toHaveLength(0)
  })

  it('persists "never" and skips the prompt on the next launch', async () => {
    showMessageBox.mockResolvedValue({ response: 2, checkboxChecked: false })
    await expect(run()).resolves.toBe('disabled')
    expect(JSON.parse(readFileSync(join(userData, 'hermes-launcher.json'), 'utf-8'))).toEqual({
      autoStart: 'never',
    })
    vi.resetModules()
    await expect(run()).resolves.toBe('disabled')
    expect(showMessageBox).toHaveBeenCalledTimes(1)
  })

  it('persists "always" from the checkbox and starts without asking next time', async () => {
    showMessageBox.mockResolvedValue({ response: 0, checkboxChecked: true })
    healthResponses = [false, true]
    const first = run()
    await vi.advanceTimersByTimeAsync(2_000)
    await expect(first).resolves.toBe('started')
    expect(JSON.parse(readFileSync(join(userData, 'hermes-launcher.json'), 'utf-8'))).toEqual({
      autoStart: 'always',
    })

    vi.resetModules()
    healthResponses = [false, true]
    const second = run()
    await vi.advanceTimersByTimeAsync(2_000)
    await expect(second).resolves.toBe('started')
    expect(showMessageBox).toHaveBeenCalledTimes(1)
    expect(spawned).toHaveLength(2)
  })

  it('reports failure when the gateway never becomes healthy', async () => {
    showMessageBox.mockResolvedValue({ response: 0, checkboxChecked: false })
    healthResponses = [] // every probe fails
    const result = run()
    await vi.advanceTimersByTimeAsync(30_000)
    await expect(result).resolves.toBe('failed')
    // the failure dialog reuses showMessageBox
    expect(showMessageBox).toHaveBeenCalledTimes(2)
  })

  it('treats a corrupted settings file as unset', async () => {
    writeFileSync(join(userData, 'hermes-launcher.json'), '{not json')
    showMessageBox.mockResolvedValue({ response: 1, checkboxChecked: false })
    await expect(run()).resolves.toBe('declined')
  })
})
