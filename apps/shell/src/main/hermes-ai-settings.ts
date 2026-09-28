/**
 * Seed userData/ai-settings.json with the local Hermes gateway key (fork layer).
 *
 * A fresh install ships no ai-settings.json, so `ai:get-settings` returns the
 * `hermes` provider with an empty key and every AI panel answers
 * "Nenhuma chave de API configurada para hermes" until the user pastes the
 * gateway's API_SERVER_KEY by hand. That key already exists on the host
 * (~/.hermes/.env), so the shell fills the file itself on startup.
 *
 * Rules:
 * - only the `hermes` provider slot is written; another provider's key and the
 *   stored provider choice survive untouched;
 * - a non-empty hermes key is never overwritten (it may point at another
 *   gateway, or be a key the user set on purpose);
 * - best effort: a missing/corrupt file or an unwritable path returns a status
 *   instead of throwing, so startup is never blocked and the app behaves
 *   exactly as it did before when there is nothing to seed.
 */
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { AI_PROVIDERS } from '@hermesoffice/ai-provider'

/** Settings file read (live) by every editor's AI panel. */
export const AI_SETTINGS_FILE = 'ai-settings.json'

// Provider defaults come from the provider catalog so they cannot drift from it.
const HERMES_META = AI_PROVIDERS.find((meta) => meta.id === 'hermes')
const DEFAULT_MODEL = HERMES_META?.defaultModel ?? 'hermes-agent'
const DEFAULT_BASE_URL = HERMES_META?.defaultBaseUrl ?? 'http://127.0.0.1:8642/v1'

export type SeedStatus = 'created' | 'updated' | 'unchanged' | 'no-env-file' | 'no-key' | 'failed'

export interface SeedResult {
  status: SeedStatus
  /** absolute path of the settings file the app reads */
  path: string
}

interface ProviderConfig {
  apiKey?: string
  model?: string
  baseUrl?: string
}

interface StoredSettings {
  provider?: string
  providers?: Record<string, ProviderConfig | undefined>
  [key: string]: unknown
}

/** `API_SERVER_KEY` from a Hermes `.env`, tolerating `export`, quotes and CRLF */
export function parseHermesApiKey(envText: string): string | null {
  const match = envText.match(/^[ \t]*(?:export[ \t]+)?API_SERVER_KEY[ \t]*=[ \t]*(.*)$/m)
  if (!match) return null
  const value = match[1]
    .trim()
    .replace(/^(["'])(.*)\1$/, '$2')
    .trim()
  return value ? value : null
}

/**
 * `~/.hermes/.env` (HERMES_HOME aware). HERMESOFFICE_HERMES_ENV points the
 * lookup at a different file — used by labs/tests that run against a scratch
 * gateway. Returns null when the file is not there.
 */
export function findHermesEnvFile(env: NodeJS.ProcessEnv = process.env): string | null {
  const override = env.HERMESOFFICE_HERMES_ENV?.trim()
  if (override) return existsSync(override) ? override : null
  const hermesHome = env.HERMES_HOME?.trim() || join(homedir(), '.hermes')
  const file = join(hermesHome, '.env')
  return existsSync(file) ? file : null
}

function readSettings(path: string): StoredSettings {
  try {
    const raw: unknown = JSON.parse(readFileSync(path, 'utf8'))
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as StoredSettings
  } catch {
    // missing or corrupt file: treat as empty settings
  }
  return {}
}

/** Atomic replacement beside the destination; 0600 keeps the key owner-only. */
function writeSettings(path: string, settings: StoredSettings): void {
  const tempPath = `${path}.${process.pid}.${randomUUID()}.tmp`
  try {
    writeFileSync(tempPath, JSON.stringify(settings, null, 2), {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
      flush: true,
    })
    renameSync(tempPath, path)
  } catch (error) {
    try {
      unlinkSync(tempPath)
    } catch {
      // The write may have failed before the temporary file was created.
    }
    throw error
  }
}

/**
 * Fill the hermes provider in `<userDataDir>/ai-settings.json` from the local
 * gateway `.env`. Called once per launch, before the first window exists.
 */
export function seedHermesAiSettings(
  userDataDir: string,
  env: NodeJS.ProcessEnv = process.env,
): SeedResult {
  const path = join(userDataDir, AI_SETTINGS_FILE)
  try {
    const envFile = findHermesEnvFile(env)
    if (!envFile) return { status: 'no-env-file', path }

    const apiKey = parseHermesApiKey(readFileSync(envFile, 'utf8'))
    if (!apiKey) return { status: 'no-key', path }

    const stored = readSettings(path)
    const existing = stored.providers?.hermes
    if (existing?.apiKey?.trim()) return { status: 'unchanged', path }

    const created = !existsSync(path)
    writeSettings(path, {
      ...stored,
      // never re-point an explicit provider choice, only fill the hermes slot
      provider: stored.provider ?? 'hermes',
      providers: {
        ...stored.providers,
        hermes: {
          apiKey,
          model: existing?.model?.trim() || DEFAULT_MODEL,
          baseUrl: existing?.baseUrl?.trim() || DEFAULT_BASE_URL,
        },
      },
    })
    return { status: created ? 'created' : 'updated', path }
  } catch {
    // Seeding is best effort: the panel keeps reporting the missing key.
    return { status: 'failed', path }
  }
}
