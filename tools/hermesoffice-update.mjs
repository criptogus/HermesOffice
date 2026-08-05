#!/usr/bin/env node
/**
 * HermesOffice GitHub-main updater — the "hermes update" equivalent for the
 * desktop app, modeled on the Hermes Desktop updater (apps/desktop/electron):
 * the app is a pure consumer that never mutates itself; this detached helper
 * owns the git pull, the rebuild, the bundle swap and the relaunch.
 *
 *   check     — compare the installed app's built commit against origin/main
 *               (git ls-remote: no API rate limits). Prints JSON to stdout.
 *   prepare   — clone/fetch origin/main into HERMESOFFICE_SOURCE_DIR + npm ci
 *   build     — npm run dist:mac from the source dir, stage the fresh .app
 *               into HERMESOFFICE_STAGE_DIR. Emits "PROGRESS <n>" lines.
 *   install   — wait for the running app to exit, swap /Applications bundle,
 *               ad-hoc codesign, relaunch via `open -n`.
 *
 * Defaults mirror the Hermes Desktop layout; every path can be overridden via
 * env (the shell main process passes them explicitly):
 *   HERMESOFFICE_SOURCE_DIR  default ~/Library/Application Support/HermesOffice/update-src
 *   HERMESOFFICE_STAGE_DIR   default ~/Library/Application Support/HermesOffice/update-stage
 *   HERMESOFFICE_APP_PATH    default /Applications/HermesOffice.app
 *   HERMESOFFICE_REPO        default https://github.com/criptogus/HermesOffice.git
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
const REPO = process.env.HERMESOFFICE_REPO || 'https://github.com/criptogus/HermesOffice.git'
const APP_PATH = process.env.HERMESOFFICE_APP_PATH || '/Applications/HermesOffice.app'
const SOURCE_DIR =
  process.env.HERMESOFFICE_SOURCE_DIR ||
  join(homedir(), 'Library/Application Support/HermesOffice/update-src')
const STAGE_DIR =
  process.env.HERMESOFFICE_STAGE_DIR ||
  join(homedir(), 'Library/Application Support/HermesOffice/update-stage')

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts })
  if (r.status !== 0) {
    const msg = (r.stderr || r.stdout || '').trim().split('\n').slice(-6).join('\n')
    throw new Error(`\`${cmd} ${args.join(' ')}\` failed (${r.status ?? r.signal}):\n${msg}`)
  }
  return r.stdout.trim()
}

function progress(pct, label) {
  console.log(`PROGRESS ${pct}`)
  if (label) console.log(`STAGE ${label}`)
}

/** copy a .app bundle preserving symlinks (cpSync/fs.cp break Electron
 * Framework hardlinks → codesign fails with "unsealed contents in root of
 * embedded framework"; ditto is the macOS-correct tool for bundles) */
function copyApp(src, dest) {
  rmSync(dest, { recursive: true, force: true })
  run('ditto', [src, dest], { timeout: 300_000 })
}

/** commit the installed app was built from (build-info.json baked at build time) */
function builtCommit(appPath = APP_PATH) {
  try {
    const p = join(appPath, 'Contents', 'Resources', 'build-info.json')
    if (!existsSync(p)) return null
    return JSON.parse(readFileSync(p, 'utf8')).commit || null
  } catch {
    return null
  }
}

/** head of origin/main via the git protocol — no API token, no rate limit */
function mainCommit() {
  const out = run('git', ['ls-remote', REPO, 'refs/heads/main'], { timeout: 30_000 })
  return out.split(/\s+/)[0] || null
}

function cmdCheck() {
  const current = builtCommit()
  const main = mainCommit()
  const behind = !!(main && current && main !== current)
  console.log(
    JSON.stringify({
      ok: true,
      current,
      currentShort: current ? current.slice(0, 7) : null,
      main,
      mainShort: main ? main.slice(0, 7) : null,
      behind,
      updated: !!current && !!main && current === main,
    }),
  )
}

function cmdPrepare() {
  progress(5, 'fetching main')
  if (!existsSync(join(SOURCE_DIR, '.git'))) {
    mkdirSync(dirname(SOURCE_DIR), { recursive: true })
    progress(10, 'cloning')
    run('git', ['clone', '--filter=blob:none', '--no-checkout', REPO, SOURCE_DIR], {
      timeout: 120_000,
    })
  }
  run('git', ['-C', SOURCE_DIR, 'fetch', '--quiet', 'origin', 'main'], { timeout: 60_000 })
  run('git', ['-C', SOURCE_DIR, 'reset', '--hard', 'FETCH_HEAD'], { timeout: 60_000 })
  progress(25, 'npm ci')
  run('npm', ['ci', '--no-audit', '--no-fund'], { cwd: SOURCE_DIR, timeout: 600_000 })
  progress(35, 'deps ready')
}

function cmdBuild() {
  progress(40, 'building app (dist:mac)')
  run('npm', ['run', 'dist:mac'], { cwd: SOURCE_DIR, timeout: 900_000 })
  progress(85, 'staging bundle')

  const releaseDir = join(SOURCE_DIR, 'apps', 'shell', 'release')
  const candidates = [
    join(releaseDir, 'mac-arm64', 'HermesOffice.app'),
    join(releaseDir, 'mac', 'HermesOffice.app'),
  ]
  const fresh = candidates.find((c) => existsSync(c))
  if (!fresh)
    throw new Error('dist:mac finished but no HermesOffice.app found in apps/shell/release')

  rmSync(STAGE_DIR, { recursive: true, force: true })
  mkdirSync(STAGE_DIR, { recursive: true })
  copyApp(fresh, join(STAGE_DIR, 'HermesOffice.app'))
  progress(95, 'staged')
  console.log(
    `RESULT ${JSON.stringify({ stage: join(STAGE_DIR, 'HermesOffice.app'), commit: mainCommit() })}`,
  )
}

/** refuse to install a bundle that is visibly incomplete — a partial swap is
 * exactly what leaves the UI loading mismatched assets (raw CSS on screen) */
function verifyBundle(appPath) {
  const required = [
    join(appPath, 'Contents', 'Info.plist'),
    join(appPath, 'Contents', 'MacOS', 'HermesOffice'),
    join(appPath, 'Contents', 'Resources', 'app.asar'),
    join(appPath, 'Contents', 'Resources', 'build-info.json'),
  ]
  for (const p of required) {
    if (!existsSync(p)) throw new Error(`bundle verification failed: missing ${p}`)
  }
  if (!builtCommit(appPath))
    throw new Error('bundle verification failed: unreadable build-info.json')
}

function cmdInstall() {
  // Wait for the running app to release the bundle (the shell quits first, but
  // be defensive: poll up to 30s).
  progress(97, 'waiting for app to quit')
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const p = spawnSync('pgrep', ['-x', 'HermesOffice'], { encoding: 'utf8' })
    if (p.status !== 0) break
    spawnSync('sleep', ['1'])
  }
  const staged = join(STAGE_DIR, 'HermesOffice.app')
  if (!existsSync(staged)) throw new Error(`no staged app at ${staged} — run build first`)
  verifyBundle(staged)

  // Atomic swap with rollback: never delete the installed app before its
  // replacement is fully copied, verified and signed next to it. The old
  // copyApp-over-APP_PATH approach removed the live bundle first, so a ditto
  // failure (or an early relaunch) left a partial/mixed bundle — the UI then
  // loads mismatched renderer assets (raw CSS rendered as text).
  const fresh = `${APP_PATH}.update-new`
  const backup = `${APP_PATH}.update-old`
  progress(98, 'swapping bundle')
  copyApp(staged, fresh)
  verifyBundle(fresh)
  run('codesign', ['--force', '--deep', '--sign', '-', fresh], { timeout: 120_000 })

  rmSync(backup, { recursive: true, force: true })
  renameSync(APP_PATH, backup)
  try {
    renameSync(fresh, APP_PATH)
  } catch (err) {
    // restore the previous bundle rather than leaving no app at all
    renameSync(backup, APP_PATH)
    throw err
  }
  rmSync(backup, { recursive: true, force: true })

  progress(100, 'relaunching')
  // This helper itself runs through the packaged Electron binary with
  // ELECTRON_RUN_AS_NODE=1. Never leak that flag into LaunchServices: the
  // relaunched GUI would start in Node mode instead of normal Electron mode.
  const relaunchEnv = { ...process.env }
  delete relaunchEnv.ELECTRON_RUN_AS_NODE
  spawnSync('open', ['-n', APP_PATH], { stdio: 'ignore', env: relaunchEnv })
  console.log(`RESULT ${JSON.stringify({ installed: APP_PATH, commit: builtCommit(APP_PATH) })}`)
}

const [cmd] = process.argv.slice(2)
try {
  if (cmd === 'check') cmdCheck()
  else if (cmd === 'prepare') cmdPrepare()
  else if (cmd === 'build') cmdBuild()
  else if (cmd === 'install') cmdInstall()
  else throw new Error(`usage: hermesoffice-update.mjs check|prepare|build|install`)
} catch (err) {
  console.error(`ERROR ${err.message}`)
  process.exit(1)
}
