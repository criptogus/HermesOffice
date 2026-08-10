import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { app, Notification, shell } from 'electron'
import type { BrowserWindow } from 'electron'
import type { UpdateUiState } from '../shared/update-api'
import { closeUpdateWindow, pushUpdateState, showUpdateWindow } from './update-window'
import { initialState } from './updater'

/**
 * GitHub-main updater — the Hermes Office counterpart of the Hermes Desktop
 * updater (apps/desktop/electron/main.ts checkUpdates/applyUpdates).
 *
 * The Hermes Desktop checks how far the local checkout is behind origin/main
 * and applies by running `hermes update` (git pull) + rebuild + bundle swap.
 * HermesOffice does the same without a shipped feed: the app compares the
 * commit it was built from (build-info.json, baked at build time) against the
 * head of origin/main via `git ls-remote` (git protocol — no API token, no
 * rate limit), and applies by handing off to tools/hermesoffice-update.mjs,
 * which clones/fetches main, rebuilds (dist:mac), swaps /Applications and
 * relaunches. Full-package policy, same as the CDN updater.
 *
 * Safety gate: this source-build updater is opt-in only via
 * HERMESOFFICE_ENABLE_SOURCE_UPDATE=1. Normal packaged builds without a CDN
 * feed should not try to clone/build from GitHub on end-user machines. When a
 * CDN feed is baked in, the electron-updater path in updater.ts owns updates
 * and this module stays silent, so the two never race.
 */

const REPO_URL = 'https://github.com/criptogus/HermesOffice.git'
const FIRST_CHECK_DELAY_MS = 15_000
const RECHECK_INTERVAL_MS = 4 * 60 * 60 * 1000
// dirs where npm commonly lives outside the minimal LaunchServices PATH
const EXTRA_PATH_DIRS = [
  join(homedir(), '.hermes', 'node', 'bin'),
  join(homedir(), '.homebrew', 'bin'),
  '/opt/homebrew/bin',
  '/usr/local/bin',
]

let started = false
let dismissedCommit: string | null = null
let lastNotifiedCommit: string | null = null

function log(...args: unknown[]): void {
  console.log('[main-updater]', ...args)
}

/** source checkout the helper script lives in (override for dev builds) */
function sourceDir(): string {
  if (process.env.HERMESOFFICE_SOURCE_DIR) return process.env.HERMESOFFICE_SOURCE_DIR
  return join(homedir(), 'Library/Application Support/HermesOffice/update-src')
}

function helperScript(): string {
  return join(sourceDir(), 'tools', 'hermesoffice-update.mjs')
}

/** commit the installed app was built from, or null if unknown */
function builtCommit(): string | null {
  try {
    const p = join(process.resourcesPath, 'build-info.json')
    if (!existsSync(p)) return null
    const info = JSON.parse(readFileSync(p, 'utf8'))
    return typeof info.commit === 'string' && info.commit ? info.commit : null
  } catch {
    return null
  }
}

/** SemVer the installed app was built from (build-info.json version field) */
function builtVersion(): string | null {
  try {
    const p = join(process.resourcesPath, 'build-info.json')
    if (!existsSync(p)) return null
    const info = JSON.parse(readFileSync(p, 'utf8'))
    return typeof info.version === 'string' && info.version ? info.version : null
  } catch {
    return null
  }
}

/** "0.6.0-3-g714bc4f" → "0.6.0"; "0.6.0" → "0.6.0"; "714bc4f" → null */
function releaseBase(v: string): string | null {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v)
  return m ? `${m[1]}.${m[2]}.${m[3]}` : null
}

/** -1 | 0 | 1 — compare major.minor.patch strings */
function cmpRelease(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1
  }
  return 0
}

/** head of origin/main via the git protocol — no API token, no rate limit */
function fetchMainCommit(): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn('git', ['ls-remote', REPO_URL, 'refs/heads/main'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let out = ''
    child.stdout.on('data', (d: Buffer) => (out += d.toString()))
    child.on('error', (err) => {
      log('git ls-remote spawn error:', err.message)
      resolve(null)
    })
    child.on('close', (code) => {
      if (code !== 0) {
        log('git ls-remote failed with', code)
        resolve(null)
        return
      }
      const sha = out.trim().split(/\s+/)[0]
      resolve(sha || null)
    })
  })
}

/** newest ho-v* release tag on origin (name + SemVer label + its commit), or null */
function fetchLatestForkTag(): Promise<{ name: string; label: string; commit: string } | null> {
  return new Promise((resolve) => {
    const child = spawn('git', ['ls-remote', '--tags', REPO_URL], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let out = ''
    child.stdout.on('data', (d: Buffer) => (out += d.toString()))
    child.on('error', () => resolve(null))
    child.on('close', (code) => {
      if (code !== 0) {
        log('git ls-remote --tags failed with', code)
        resolve(null)
        return
      }
      let best: { v: number[]; label: string; commit: string } | null = null
      for (const line of out.split('\n')) {
        const m = /^([0-9a-f]{40})\trefs\/tags\/ho-v(\d+)\.(\d+)\.(\d+)$/.exec(line.trim())
        if (!m) continue
        const v = [Number(m[2]), Number(m[3]), Number(m[4])]
        const newer =
          !best ||
          v[0] > best.v[0] ||
          (v[0] === best.v[0] && (v[1] > best.v[1] || (v[1] === best.v[1] && v[2] > best.v[2])))
        if (newer) best = { v, label: `${m[2]}.${m[3]}.${m[4]}`, commit: m[1] }
      }
      resolve(best ? { name: `ho-v${best.label}`, label: best.label, commit: best.commit } : null)
    })
  })
}

function spawnHelper(
  args: string[],
  onProgress: (pct: number, stage: string | null) => void,
  envOverrides: Record<string, string> = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [helperScript(), ...args], {
      env: {
        ...process.env,
        // packaged Electron: execPath is the HermesOffice binary — this flag
        // makes it run the helper as a plain Node process (no GUI, no lock)
        ELECTRON_RUN_AS_NODE: '1',
        HERMESOFFICE_SOURCE_DIR: sourceDir(),
        HERMESOFFICE_REPO: REPO_URL,
        // LaunchServices gives apps a minimal PATH (/usr/bin:/bin:...); npm
        // commonly lives in ~/.hermes/node/bin, homebrew or nvm dirs. Without
        // them the helper's `npm ci` dies with "command not found" and the UI
        // reports a bogus "check your network" error.
        PATH: [process.env.PATH, ...EXTRA_PATH_DIRS].filter(Boolean).join(':'),
        ...envOverrides,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let buf = ''
    const onLine = (line: string): void => {
      const progress = /^PROGRESS (\d+)$/.exec(line)
      if (progress) {
        onProgress(Number(progress[1]), null)
        return
      }
      const stage = /^STAGE (.+)$/.exec(line)
      if (stage) onProgress(Number((buf.match(/PROGRESS (\d+)/) ?? [0, 0])[1]), stage[1])
    }
    const read = (d: Buffer): void => {
      buf += d.toString()
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const line of lines) {
        const t = line.trim()
        if (t) onLine(t)
      }
    }
    child.stdout.on('data', read)
    child.stderr.on('data', (d: Buffer) => log('helper stderr:', d.toString().trim()))
    child.on('error', reject)
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`helper ${args[0]} failed (${code})`)),
    )
  })
}

async function ensureSource(): Promise<void> {
  if (existsSync(join(sourceDir(), '.git'))) return
  await new Promise<void>((resolve, reject) => {
    // Full working tree — NEVER --no-checkout. The helper script
    // (tools/hermesoffice-update.mjs) lives inside the checkout and is spawned
    // right after this clone; with an empty checkout the spawn fails with
    // ENOENT and the UI reports a bogus "download failed, check your network".
    const child = spawn('git', ['clone', '--filter=blob:none', REPO_URL, sourceDir()], {
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    child.stderr.on('data', (d: Buffer) => log('clone:', d.toString().trim()))
    child.on('error', reject)
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`git clone failed (${code})`)),
    )
  })
}

async function checkForUpdate(getWindow: () => BrowserWindow | null): Promise<void> {
  const built = builtCommit()
  if (!built) {
    log('no build-info.json in bundle — update check skipped')
    return
  }
  const builtVer = builtVersion() ?? `build ${built.slice(0, 7)}`
  const main = await fetchMainCommit()
  if (!main) {
    log('could not reach origin/main — network offline?')
    return
  }
  // Release-train: a source update is offered only when a NEWER ho-v* tag
  // exists than the installed build's release base, and it installs that
  // tag's commit — deterministic, never rolling main. Without ho-v* tags yet,
  // fall back to the legacy "main moved" check.
  const tag = await fetchLatestForkTag()
  let newVersion: string
  let targetRef: string
  let updateKey: string
  if (tag) {
    const base = releaseBase(builtVer)
    const newer = base === null || cmpRelease(tag.label, base) > 0
    if (!newer) {
      log('up to date (', builtVer, ')')
      return
    }
    newVersion = tag.label
    targetRef = tag.name
    updateKey = tag.commit
  } else {
    if (main === built) {
      log('up to date (', builtVer, ')')
      return
    }
    newVersion = `build ${main.slice(0, 7)}`
    targetRef = 'main'
    updateKey = main
  }
  if (updateKey === dismissedCommit) return
  log('update available:', builtVer, '→', newVersion, `(target ${targetRef})`)

  // Attention in background: dock badge + bounce + system notification,
  // once per update SHA (the modal window alone goes unnoticed when the
  // shell is not frontmost).
  if (updateKey !== lastNotifiedCommit) {
    lastNotifiedCommit = updateKey
    app.dock?.setBadge('1')
    app.dock?.bounce('informational')
    if (Notification.isSupported()) {
      new Notification({
        title: 'HermesOffice update available',
        body: `${builtVer} → ${newVersion}`,
      }).show()
    }
  }

  const actions = {
    onDownload: () => {
      app.dock?.setBadge('')
      void (async () => {
        pushUpdateState({ phase: 'downloading', percent: 0 })
        try {
          await ensureSource()
          await spawnHelper(
            ['prepare'],
            (pct) => pushUpdateState({ phase: 'downloading', percent: pct }),
            { HERMESOFFICE_TARGET_REF: targetRef },
          )
          await spawnHelper(['build'], (pct) =>
            pushUpdateState({ phase: 'downloading', percent: pct }),
          )
          pushUpdateState({ phase: 'downloaded', percent: 100 })
        } catch (err) {
          log('download/build failed:', (err as Error).message)
          pushUpdateState({ phase: 'error' })
        }
      })()
    },
    onInstall: () => {
      app.dock?.setBadge('')
      closeUpdateWindow()
      // detach: the helper waits for this process to exit, swaps the bundle
      // and relaunches via `open -n`
      const child = spawn(process.execPath, [helperScript(), 'install'], {
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: '1',
          HERMESOFFICE_SOURCE_DIR: sourceDir(),
          HERMESOFFICE_REPO: REPO_URL,
          PATH: [process.env.PATH, ...EXTRA_PATH_DIRS].filter(Boolean).join(':'),
        },
        detached: true,
        stdio: 'ignore',
      })
      child.unref()
      setImmediate(() => app.quit())
    },
    onLater: () => {
      app.dock?.setBadge('')
      dismissedCommit = main
      closeUpdateWindow()
    },
    onOpenDownload: () => {
      app.dock?.setBadge('')
      void shell.openExternal(REPO_URL.replace(/\.git$/, '') + '/releases').catch(() => {
        // no browser handler available; nothing actionable for the user here
      })
    },
  }

  showUpdateWindow(getWindow(), initialState(newVersion), actions)
}

export function initMainUpdater(getWindow: () => BrowserWindow | null): void {
  if (started) return
  started = true
  if (!app.isPackaged) return
  if (process.platform !== 'win32' && process.platform !== 'darwin') return
  if (process.env.HERMESOFFICE_ENABLE_SOURCE_UPDATE !== '1') {
    log('source updater disabled — set HERMESOFFICE_ENABLE_SOURCE_UPDATE=1 to enable')
    return
  }
  // CDN feed baked in? electron-updater (updater.ts) owns updates.
  if (existsSync(join(process.resourcesPath, 'app-update.yml'))) {
    log('app-update.yml present — CDN updater active, main-updater idle')
    return
  }

  const check = (): void => {
    void checkForUpdate(getWindow)
  }
  setTimeout(check, FIRST_CHECK_DELAY_MS)
  setInterval(check, RECHECK_INTERVAL_MS)

  // Re-surface a pending update when the user comes back to the app — the
  // first check can fire while the shell is in the background, where a modal
  // window goes completely unnoticed. Rate-limited: the check is a git
  // ls-remote round-trip, no need for one per focus.
  let lastFocusCheck = 0
  app.on('browser-window-focus', () => {
    if (Date.now() - lastFocusCheck < 60_000) return
    lastFocusCheck = Date.now()
    check()
  })
}

/** for UpdateUiState typing parity with updater.ts */
export type { UpdateUiState }
