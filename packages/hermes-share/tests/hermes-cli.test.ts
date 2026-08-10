import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:fs', () => ({ existsSync: vi.fn() }))
vi.mock('node:os', () => ({ homedir: vi.fn(() => '/home/tester') }))

import { existsSync } from 'node:fs'
import { hermesBinCandidates, resolveHermesBin } from '../src/hermes-cli'

const mockedExists = vi.mocked(existsSync)

const EXE = process.platform === 'win32' ? 'hermes.exe' : 'hermes'

describe('hermesBinCandidates', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
    mockedExists.mockReset()
  })

  it('prefers HERMES_BIN when set', () => {
    vi.stubEnv('HERMES_BIN', '/custom/hermes')
    vi.stubEnv('PATH', '/usr/bin')
    const [first, ...rest] = hermesBinCandidates()
    expect(first).toBe('/custom/hermes')
    expect(rest).toContain('/home/tester/.hermes/hermes-agent/venv/bin/hermes')
  })

  it('includes the standard venv install before the PATH lookup', () => {
    vi.stubEnv('PATH', '/usr/bin:/opt/bin')
    const candidates = hermesBinCandidates()
    expect(candidates).toContain('/home/tester/.hermes/hermes-agent/venv/bin/hermes')
    expect(candidates).toContain(`/usr/bin/${EXE}`)
    expect(candidates).toContain(`/opt/bin/${EXE}`)
    // standard installs come first
    expect(candidates.indexOf('/home/tester/.hermes/hermes-agent/venv/bin/hermes')).toBeLessThan(
      candidates.indexOf(`/usr/bin/${EXE}`),
    )
  })
})

describe('resolveHermesBin', () => {
  beforeEach(() => {
    mockedExists.mockReset()
  })

  it('returns the first candidate that exists', () => {
    vi.stubEnv('HERMES_BIN', '/custom/hermes')
    vi.stubEnv('PATH', '/usr/bin')
    mockedExists.mockImplementation((p) => p === '/usr/bin/hermes')
    expect(resolveHermesBin()).toBe('/usr/bin/hermes')
  })

  it('returns null when nothing exists', () => {
    vi.stubEnv('PATH', '/usr/bin')
    mockedExists.mockReturnValue(false)
    expect(resolveHermesBin()).toBeNull()
  })

  it('skips unreadable candidates instead of aborting discovery', () => {
    vi.stubEnv('PATH', '/usr/bin')
    mockedExists.mockImplementation((p) => {
      if (p === '/home/tester/.hermes/hermes-agent/venv/bin/hermes') throw new Error('EACCES')
      return p === '/usr/bin/hermes'
    })
    expect(resolveHermesBin()).toBe('/usr/bin/hermes')
  })
})
