/**
 * Locate the Hermes CLI that the share bridge shells out to.
 *
 * `hermes send` is a thin, LLM-free wrapper around the gateway's messaging
 * adapters — it reads the same credentials as the Hermes gateway and works
 * standalone for bot-token platforms (Telegram, Discord, Slack, Signal, …).
 *
 * Discovery ladder (first hit wins):
 *   1. HERMES_BIN env override
 *   2. the standard pip/venv install locations under the Hermes home
 *   3. PATH lookup for `hermes`
 */

import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const EXE = process.platform === 'win32' ? 'hermes.exe' : 'hermes'

function standardInstallCandidates(home: string): string[] {
  const candidates: string[] = []
  if (process.env.HERMES_BIN) candidates.push(process.env.HERMES_BIN)
  // standard pip/venv install (macOS/Linux)
  candidates.push(join(home, '.hermes', 'hermes-agent', 'venv', 'bin', EXE))
  // Windows pip venv layout
  candidates.push(join(home, '.hermes', 'hermes-agent', 'venv', 'Scripts', EXE))
  return candidates
}

function pathLookup(): string[] {
  const pathEnv = process.env.PATH
  if (!pathEnv) return []
  const dirs = pathEnv.split(process.platform === 'win32' ? ';' : ':')
  return dirs.filter(Boolean).map((dir) => join(dir, EXE))
}

/** every candidate path in discovery order (exposed for tests) */
export function hermesBinCandidates(): string[] {
  return [...standardInstallCandidates(homedir()), ...pathLookup()]
}

/** first candidate that exists on disk, or null when Hermes is not installed */
export function resolveHermesBin(): string | null {
  for (const candidate of hermesBinCandidates()) {
    try {
      if (candidate && existsSync(candidate)) return candidate
    } catch {
      // unreadable path entries must not abort discovery
    }
  }
  return null
}
