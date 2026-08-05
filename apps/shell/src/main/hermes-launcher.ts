/**
 * Optional Hermes gateway launcher (fork layer, issue #7).
 *
 * On shell startup, if the local gateway does not answer /health and a
 * `hermes` CLI is present on the host, offer to start it — strictly with
 * consent: a native dialog with an "always start automatically" checkbox,
 * persisted in userData/hermes-launcher.json. Nothing is bundled and no
 * daemon is spawned without the user saying yes at least once.
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, dialog, type BrowserWindow } from 'electron'
import { hermesHealthUrl } from '@hermesoffice/ai-provider'

const SETTINGS_FILE = () => join(app.getPath('userData'), 'hermes-launcher.json')
const HEALTH_TIMEOUT_MS = 2000
const START_POLL_INTERVAL_MS = 1000
const START_POLL_ATTEMPTS = 20

interface LauncherSettings {
  /** 'always' starts without asking; 'never' disables the prompt; undefined asks each time */
  autoStart?: 'always' | 'never'
}

function readSettings(): LauncherSettings {
  try {
    if (existsSync(SETTINGS_FILE()))
      return JSON.parse(readFileSync(SETTINGS_FILE(), 'utf-8')) as LauncherSettings
  } catch {
    /* corrupted settings: treat as unset */
  }
  return {}
}

function writeSettings(s: LauncherSettings): void {
  try {
    writeFileSync(SETTINGS_FILE(), JSON.stringify(s, null, 2))
  } catch {
    /* persisting the preference is best-effort */
  }
}

async function gatewayHealthy(): Promise<boolean> {
  try {
    const response = await fetch(hermesHealthUrl(''), {
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    })
    return response.ok
  } catch {
    return false
  }
}

/** Locate the hermes CLI: HERMES_CLI env override, else PATH lookup */
export function findHermesCli(): string | null {
  const override = process.env.HERMES_CLI
  if (override && existsSync(override)) return override
  const probe = process.platform === 'win32' ? 'where' : 'which'
  const result = spawnSync(probe, ['hermes'], { encoding: 'utf-8' })
  const found = result.status === 0 ? result.stdout.split('\n')[0]?.trim() : ''
  return found ? found : null
}

function startGateway(cli: string): void {
  const child = spawn(cli, ['gateway', 'start'], { detached: true, stdio: 'ignore' })
  child.on('error', () => {
    /* surfaced by the health poll below */
  })
  child.unref()
}

async function pollUntilHealthy(): Promise<boolean> {
  for (let i = 0; i < START_POLL_ATTEMPTS; i++) {
    await new Promise((r) => setTimeout(r, START_POLL_INTERVAL_MS))
    if (await gatewayHealthy()) return true
  }
  return false
}

export interface LauncherStrings {
  title: string
  body: string
  start: string
  notNow: string
  always: string
  never: string
  failed: string
}

/**
 * Called once after the shell window exists. Never blocks startup — the
 * caller fires and forgets. Returns what happened, for tests/logging.
 */
export async function ensureHermesGateway(
  getWindow: () => BrowserWindow | null,
  strings: LauncherStrings,
): Promise<'healthy' | 'started' | 'declined' | 'no-cli' | 'failed' | 'disabled'> {
  if (await gatewayHealthy()) return 'healthy'
  const settings = readSettings()
  if (settings.autoStart === 'never') return 'disabled'
  const cli = findHermesCli()
  if (!cli) return 'no-cli'

  if (settings.autoStart !== 'always') {
    const win = getWindow()
    if (!win) return 'declined'
    const { response, checkboxChecked } = await dialog.showMessageBox(win, {
      type: 'question',
      title: strings.title,
      message: strings.title,
      detail: strings.body,
      buttons: [strings.start, strings.notNow, strings.never],
      defaultId: 0,
      cancelId: 1,
      checkboxLabel: strings.always,
      checkboxChecked: false,
    })
    if (response === 2) {
      writeSettings({ autoStart: 'never' })
      return 'disabled'
    }
    if (response !== 0) return 'declined'
    if (checkboxChecked) writeSettings({ autoStart: 'always' })
  }

  startGateway(cli)
  if (await pollUntilHealthy()) return 'started'
  const win = getWindow()
  if (win) {
    void dialog.showMessageBox(win, {
      type: 'warning',
      title: strings.title,
      message: strings.failed,
    })
  }
  return 'failed'
}
