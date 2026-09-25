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

/** npm may live outside the minimal LaunchServices PATH (~/.hermes/node/bin,
 * homebrew, nvm...). Resolve it once — or fail with an actionable message.
 * A bare "npm: command not found" (spawn status 127) surfaces in the app UI
 * as a bogus "download failed, check your network". */
let _npmPath = null
function npmBin() {
  if (_npmPath) return _npmPath
  if (process.env.HERMESOFFICE_NPM) {
    _npmPath = process.env.HERMESOFFICE_NPM
    return _npmPath
  }
  for (const shell of ['sh -lc', 'zsh -lc']) {
    const [cmd, ...args] = shell.split(' ')
    const found = spawnSync(cmd, [...args, 'command -v npm'], { encoding: 'utf8' })
    if (found.status === 0 && found.stdout.trim()) {
      _npmPath = found.stdout.trim()
      return _npmPath
    }
  }
  const candidates = [
    join(homedir(), '.hermes', 'node', 'bin', 'npm'),
    join(homedir(), '.homebrew', 'bin', 'npm'),
    '/opt/homebrew/bin/npm',
    '/usr/local/bin/npm',
  ]
  for (const p of candidates) {
    if (existsSync(p)) {
      _npmPath = p
      return p
    }
  }
  throw new Error(
    'npm not found — add npm to PATH or install Node.js (brew install node), then retry the update',
  )
}

/**
 * Dirs that hold the build toolchain when the helper runs with the minimal PATH
 * LaunchServices hands to apps (`/usr/bin:/bin`). npm needs node, and
 * `npm run dist:mac` compiles the sheets sidecar with cargo — the rustup
 * toolchain lives in `~/.cargo/bin`, so without it the build dies with
 * "cargo: command not found" and the UI reports a bogus network error.
 */
const TOOLCHAIN_DIRS = [
  join(homedir(), '.cargo', 'bin'),
  join(homedir(), '.hermes', 'node', 'bin'),
  join(homedir(), '.homebrew', 'bin'),
  '/opt/homebrew/bin',
  '/usr/local/bin',
]

/** Always present, whatever PATH the caller had (the build shells out to cp/ditto/git). */
const SYSTEM_PATH_DIRS = ['/usr/bin', '/bin', '/usr/sbin', '/sbin']

/**
 * PATH for the build tools: the caller's PATH first (the app and the tests rely
 * on their own npm winning), then the toolchain dirs LaunchServices does not
 * provide — `~/.cargo/bin` is where rustup puts cargo, and `npm run dist:mac`
 * compiles the sheets sidecar with it (without it the build dies with
 * "cargo: command not found" and the UI reports a bogus network error).
 */
function toolchainPath(base) {
  const seen = new Set()
  const out = []
  const caller = (base ?? process.env.PATH ?? '').split(':')
  for (const dir of [...caller, ...TOOLCHAIN_DIRS, ...SYSTEM_PATH_DIRS]) {
    if (dir && !seen.has(dir)) {
      seen.add(dir)
      out.push(dir)
    }
  }
  return out.join(':')
}

/** Delete that must never abort the caller — used for the bundle backups around
 * the swap, where the new bundle is already in place and a leftover is
 * harmless. A residue from a previous update is exactly what wedges the swap. */
function removeQuietly(dir) {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch (err) {
    console.error(`cleanup of ${dir} failed (ignored): ${err.message}`)
  }
}

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

/** SemVer the installed app was built from (build-info.json version field) */
function builtVersion(appPath = APP_PATH) {
  try {
    const p = join(appPath, 'Contents', 'Resources', 'build-info.json')
    if (!existsSync(p)) return null
    return JSON.parse(readFileSync(p, 'utf8')).version || null
  } catch {
    return null
  }
}

/** newest ho-v* release tag on origin (SemVer), or null */
function latestForkTag() {
  const out = run('git', ['ls-remote', '--tags', REPO], { timeout: 30_000 })
  let best = null
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
  return best
}

/** head of origin/main via the git protocol — no API token, no rate limit */
function mainCommit() {
  const out = run('git', ['ls-remote', REPO, 'refs/heads/main'], { timeout: 30_000 })
  return out.split(/\s+/)[0] || null
}

function cmdCheck() {
  const current = builtCommit()
  const main = mainCommit()
  const tag = latestForkTag()
  const behind = !!(main && current && main !== current)
  console.log(
    JSON.stringify({
      ok: true,
      current,
      currentShort: current ? current.slice(0, 7) : null,
      currentVersion: builtVersion(),
      main,
      mainShort: main ? main.slice(0, 7) : null,
      latestVersion: tag ? tag.label : null,
      latestCommit: tag ? tag.commit : null,
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
    // Full working tree — NEVER --no-checkout. The subsequent fetch/reset/npm
    // steps need a real checkout, and the app spawns this very script from
    // inside it; an empty checkout breaks both (ENOENT → "download failed,
    // check your network" in the UI).
    run('git', ['clone', '--filter=blob:none', REPO, SOURCE_DIR], {
      timeout: 120_000,
    })
  }
  // Main first, then tags with --force. A stale local ho-v* tag (e.g. one the
  // remote force-moved) makes a plain `git fetch --tags` fail with "would
  // clobber existing tag" — exit 1 — which the app surfaces as a bogus
  // "download failed, check your network". --force adopts the remote tag, the
  // same way the Hermes Desktop updater never lets a local tag wedge an
  // update. Reset against origin/main (not FETCH_HEAD) so the checkout always
  // lands on main regardless of fetch order.
  run('git', ['-C', SOURCE_DIR, 'fetch', '--quiet', 'origin', 'main'], { timeout: 60_000 })
  run('git', ['-C', SOURCE_DIR, 'fetch', '--quiet', '--tags', '--force', 'origin'], {
    timeout: 60_000,
  })
  // Release-train: HERMESOFFICE_TARGET_REF pins the build to a release tag
  // (deterministic version); default stays on origin/main for the tagless
  // fallback.
  const target = process.env.HERMESOFFICE_TARGET_REF
  run(
    'git',
    ['-C', SOURCE_DIR, 'reset', '--hard', target && target !== 'main' ? target : 'origin/main'],
    { timeout: 60_000 },
  )
  progress(25, 'npm ci')
  // npm's shebang is `#!/usr/bin/env node` — in a minimal PATH the resolved
  // npm is useless without its sibling node. Prepend npm's dir so both
  // resolve (covers the LaunchServices case end to end).
  const npm = npmBin()
  run(npm, ['ci', '--no-audit', '--no-fund'], {
    cwd: SOURCE_DIR,
    timeout: 600_000,
    env: { ...process.env, PATH: toolchainPath(`${dirname(npm)}:${process.env.PATH || ''}`) },
  })
  progress(35, 'deps ready')
}

function cmdBuild() {
  progress(40, 'building app (dist:mac)')
  // Retry-once, modeled on the Hermes Desktop updater (update-rebuild.ts): the
  // first rebuild can fail on a still-settling tree or a network-blocked
  // Electron fetch that heals mid-run; a second attempt builds clean off the
  // healed dist. Without the retry the update bails before the swap+relaunch
  // and the user sees "download failed, check your network" for a transient
  // build hiccup.
  let buildError = null
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) progress(40, 'retrying build (attempt 2)')
    try {
      run('npm', ['run', 'dist:mac'], {
        cwd: SOURCE_DIR,
        timeout: 900_000,
        env: { ...process.env, PATH: toolchainPath() },
      })
      buildError = null
      break
    } catch (err) {
      buildError = err
    }
  }
  if (buildError) throw buildError
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

/** PIDs of the packaged app GUI. The helper itself runs through the packaged
 * HermesOffice binary (ELECTRON_RUN_AS_NODE), so a bare `pgrep -x HermesOffice`
 * matches its own process — filter self out, or the wait never terminates and
 * the termination pass below kills the helper mid-install. */
function appPids() {
  const p = spawnSync('pgrep', ['-x', 'HermesOffice'], { encoding: 'utf8' })
  if (p.status !== 0) return []
  return p.stdout
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(Number)
    .filter((pid) => pid !== process.pid)
}

function appRunning() {
  return appPids().length > 0
}

function waitAppGone(ms) {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (!appRunning()) return true
    spawnSync('sleep', ['1'])
  }
  return !appRunning()
}

function killApp(force) {
  const pids = appPids()
  if (pids.length > 0) spawnSync('kill', [force ? '-9' : '-TERM', ...pids.map(String)])
}

function cmdInstall() {
  // The swap must NEVER happen with the app alive: a surviving process holds
  // the Electron single-instance lock, the relaunch `open -n` then no-ops
  // silently, and the old main process keeps running against the new asar —
  // a mixed-version state that renders the UI broken (raw CSS as text).
  // Grace period first (the shell quits itself), then TERM, then KILL, and
  // hard-abort if something still survives.
  progress(97, 'waiting for app to quit')
  if (!waitAppGone(30_000)) {
    console.error('app still running after 30s — sending SIGTERM')
    killApp(false)
    if (!waitAppGone(10_000)) {
      console.error('app ignored SIGTERM — sending SIGKILL')
      killApp(true)
      if (!waitAppGone(5_000)) {
        throw new Error('HermesOffice is still running; refusing to swap a live bundle')
      }
    }
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

  // A previous update can leave a partial backup behind (a recursive delete that
  // died mid-way — e.g. LaunchServices touching the bundle). Clear it first: the
  // rename below then has somewhere to go. Best-effort, because a residue we
  // cannot delete (permissions) must not abort an install.
  removeQuietly(backup)
  let parked = backup
  try {
    renameSync(APP_PATH, parked)
  } catch (err) {
    // Occupied (ENOTEMPTY) or permission-blocked (EACCES) backup: park the
    // outgoing bundle under a unique name instead of failing the update.
    if (err.code !== 'ENOTEMPTY' && err.code !== 'EACCES') throw err
    parked = `${backup}.${Date.now()}`
    renameSync(APP_PATH, parked)
  }
  try {
    renameSync(fresh, APP_PATH)
  } catch (err) {
    // restore the previous bundle rather than leaving no app at all
    renameSync(parked, APP_PATH)
    throw err
  }
  // The swap is DONE: from here on nothing may abort, or the app stays closed
  // with the new bundle in place (the user sees an error and no app).
  removeQuietly(parked)

  progress(100, 'relaunching')
  // This helper itself runs through the packaged Electron binary with
  // ELECTRON_RUN_AS_NODE=1. Never leak that flag into LaunchServices: the
  // relaunched GUI would start in Node mode instead of normal Electron mode.
  const relaunchEnv = { ...process.env }
  delete relaunchEnv.ELECTRON_RUN_AS_NODE
  // `open -n` can no-op silently (e.g. LaunchServices confusion right after a
  // bundle swap) — verify the process actually appeared and retry once.
  spawnSync('open', ['-n', APP_PATH], { stdio: 'ignore', env: relaunchEnv })
  let relaunched = false
  for (let i = 0; i < 10 && !relaunched; i++) {
    spawnSync('sleep', ['1'])
    relaunched = appRunning()
  }
  if (!relaunched) {
    console.error('relaunch did not surface a HermesOffice process — retrying open -n')
    spawnSync('open', ['-n', APP_PATH], { stdio: 'ignore', env: relaunchEnv })
    for (let i = 0; i < 10 && !relaunched; i++) {
      spawnSync('sleep', ['1'])
      relaunched = appRunning()
    }
  }
  console.log(
    `RESULT ${JSON.stringify({ installed: APP_PATH, commit: builtCommit(APP_PATH), relaunched })}`,
  )
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
