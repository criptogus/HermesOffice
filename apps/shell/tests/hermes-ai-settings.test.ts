import { mkdtempSync, readFileSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AI_PROVIDERS, defaultAiSettings, resolveAiSettings } from '@hermesoffice/ai-provider'
import {
  findHermesEnvFile,
  parseHermesApiKey,
  seedHermesAiSettings,
} from '../src/main/hermes-ai-settings'

/**
 * Startup seed of userData/ai-settings.json from ~/.hermes/.env: without it a
 * fresh install answers "Nenhuma chave de API configurada para hermes".
 */

const HERMES_ENV_FILE = 'API_SERVER_KEY=0123456789abcdef0123456789abcdef\n'
const HERMES_META = AI_PROVIDERS.find((meta) => meta.id === 'hermes')

let userData = ''
let envFile = ''
let env: NodeJS.ProcessEnv = {}

function writeEnv(text: string): void {
  writeFileSync(envFile, text)
}

function settingsPath(): string {
  return join(userData, 'ai-settings.json')
}

function readSettings(): Record<string, unknown> {
  return JSON.parse(readFileSync(settingsPath(), 'utf8')) as Record<string, unknown>
}

function seed() {
  return seedHermesAiSettings(userData, env)
}

beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'hermes-ai-settings-'))
  envFile = join(userData, 'hermes.env')
  writeEnv(HERMES_ENV_FILE)
  env = { HERMESOFFICE_HERMES_ENV: envFile }
})

afterEach(() => {
  delete env.HERMESOFFICE_HERMES_ENV
})

describe('parseHermesApiKey', () => {
  it('reads a plain assignment', () => {
    expect(parseHermesApiKey('OTHER=1\nAPI_SERVER_KEY=abc123\n')).toBe('abc123')
  })

  it('tolerates export, quotes, surrounding spaces and CRLF', () => {
    expect(parseHermesApiKey('export API_SERVER_KEY="abc123"\r\n')).toBe('abc123')
    expect(parseHermesApiKey("\texport\tAPI_SERVER_KEY = 'abc123'\r\n")).toBe('abc123')
    expect(parseHermesApiKey('  API_SERVER_KEY=  abc123  ')).toBe('abc123')
  })

  it('ignores a commented-out line and returns null without a key', () => {
    expect(parseHermesApiKey('# API_SERVER_KEY=abc123\n')).toBeNull()
    expect(parseHermesApiKey('API_SERVER_KEY=\n')).toBeNull()
    expect(parseHermesApiKey('SOMETHING_ELSE=1\n')).toBeNull()
  })
})

describe('findHermesEnvFile', () => {
  it('honours the explicit override', () => {
    expect(findHermesEnvFile({ HERMESOFFICE_HERMES_ENV: envFile })).toBe(envFile)
  })

  it('honours HERMES_HOME and returns null when the file is absent', () => {
    const home = mkdtempSync(join(tmpdir(), 'hermes-home-'))
    expect(findHermesEnvFile({ HERMES_HOME: home })).toBeNull()
    writeFileSync(join(home, '.env'), HERMES_ENV_FILE)
    expect(findHermesEnvFile({ HERMES_HOME: home })).toBe(join(home, '.env'))
  })

  it('returns null for an override that does not exist', () => {
    expect(findHermesEnvFile({ HERMESOFFICE_HERMES_ENV: join(userData, 'nope.env') })).toBeNull()
  })
})

describe('seedHermesAiSettings', () => {
  it('creates the file on a fresh install and the app resolves provider hermes', () => {
    expect(seed()).toEqual({ status: 'created', path: settingsPath() })

    const stored = readSettings()
    expect(stored.provider).toBe('hermes')
    expect(stored.providers).toEqual({
      hermes: {
        apiKey: '0123456789abcdef0123456789abcdef',
        model: HERMES_META?.defaultModel,
        baseUrl: HERMES_META?.defaultBaseUrl,
      },
    })

    // the same merge the main process runs: the panel gets a usable provider
    const settings = resolveAiSettings(stored, defaultAiSettings())
    expect(settings.provider).toBe('hermes')
    expect(settings.providers.hermes?.apiKey).toBe('0123456789abcdef0123456789abcdef')
  })

  it('writes the key owner-only (0600)', () => {
    seed()
    expect(statSync(settingsPath()).mode & 0o777).toBe(0o600)
  })

  it('is idempotent: a second launch leaves the file untouched', () => {
    seed()
    const past = new Date('2020-01-01T00:00:00Z')
    utimesSync(settingsPath(), past, past)

    expect(seed()).toEqual({ status: 'unchanged', path: settingsPath() })
    expect(statSync(settingsPath()).mtimeMs).toBe(past.getTime())
  })

  it('never overwrites a key the user already configured', () => {
    writeFileSync(
      settingsPath(),
      JSON.stringify({
        provider: 'hermes',
        providers: {
          hermes: {
            apiKey: 'user-key',
            model: 'hermes-agent',
            baseUrl: 'http://127.0.0.1:9999/v1',
          },
        },
      }),
    )

    expect(seed().status).toBe('unchanged')
    const stored = readSettings() as { providers: { hermes: { apiKey: string; baseUrl: string } } }
    expect(stored.providers.hermes.apiKey).toBe('user-key')
    expect(stored.providers.hermes.baseUrl).toBe('http://127.0.0.1:9999/v1')
  })

  it('fills an empty hermes slot without touching another provider or the stored choice', () => {
    writeFileSync(
      settingsPath(),
      JSON.stringify({
        provider: 'openai',
        gskToolsEnabled: false,
        providers: {
          hermes: { apiKey: '', model: 'hermes-agent', baseUrl: 'http://127.0.0.1:8642/v1' },
          openai: { apiKey: 'openai-key', model: 'gpt-5.6' },
        },
      }),
    )

    expect(seed().status).toBe('updated')
    const stored = readSettings() as {
      provider: string
      gskToolsEnabled: boolean
      providers: Record<string, { apiKey: string; model?: string }>
    }
    expect(stored.provider).toBe('openai')
    expect(stored.gskToolsEnabled).toBe(false)
    expect(stored.providers.openai).toEqual({ apiKey: 'openai-key', model: 'gpt-5.6' })
    expect(stored.providers.hermes.apiKey).toBe('0123456789abcdef0123456789abcdef')
  })

  it('keeps a custom model and base URL on the hermes slot', () => {
    writeFileSync(
      settingsPath(),
      JSON.stringify({
        providers: {
          hermes: { apiKey: ' ', model: 'my-model', baseUrl: 'http://127.0.0.1:9999/v1' },
        },
      }),
    )

    seed()
    const stored = readSettings() as { providers: { hermes: { model: string; baseUrl: string } } }
    expect(stored.providers.hermes.model).toBe('my-model')
    expect(stored.providers.hermes.baseUrl).toBe('http://127.0.0.1:9999/v1')
  })

  it('recovers from a corrupt settings file', () => {
    writeFileSync(settingsPath(), '{not json')

    expect(seed().status).toBe('updated')
    expect(readSettings().provider).toBe('hermes')
  })

  it('does nothing when the gateway .env has no key', () => {
    writeEnv('SOMETHING_ELSE=1\n')
    expect(seed().status).toBe('no-key')
    expect(() => statSync(settingsPath())).toThrow()
  })

  it('does nothing when there is no gateway .env at all', () => {
    env = { HERMESOFFICE_HERMES_ENV: join(userData, 'absent.env') }
    expect(seed().status).toBe('no-env-file')
    expect(() => statSync(settingsPath())).toThrow()
  })

  it('reports failure instead of throwing when the file cannot be written', () => {
    const notADirectory = join(userData, 'blocked')
    writeFileSync(notADirectory, 'x')
    expect(seedHermesAiSettings(notADirectory, env).status).toBe('failed')
  })
})
