import test from 'node:test'
import assert from 'node:assert/strict'
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const TOOLS_DIR = dirname(fileURLToPath(import.meta.url))
const HELPER = join(TOOLS_DIR, 'hermesoffice-update.mjs')

function executable(path, body) {
  writeFileSync(path, `#!/bin/sh\n${body}\n`)
  chmodSync(path, 0o755)
}

/** minimal bundle that passes verifyBundle (existence checks only) */
function makeMinimalBundle(appDir) {
  mkdirSync(join(appDir, 'Contents', 'Resources'), { recursive: true })
  mkdirSync(join(appDir, 'Contents', 'MacOS'), { recursive: true })
  writeFileSync(join(appDir, 'Contents', 'Info.plist'), '<?xml version="1.0"?>')
  writeFileSync(join(appDir, 'Contents', 'MacOS', 'HermesOffice'), '#!/bin/sh\n')
  writeFileSync(join(appDir, 'Contents', 'Resources', 'app.asar'), '')
  writeFileSync(
    join(appDir, 'Contents', 'Resources', 'build-info.json'),
    JSON.stringify({ commit: 'test-commit' }),
  )
}

test('install relaunch does not inherit ELECTRON_RUN_AS_NODE', () => {
  const temp = mkdtempSync(join(tmpdir(), 'hermesoffice-update-test-'))
  try {
    const bin = join(temp, 'bin')
    const stage = join(temp, 'stage')
    const stagedApp = join(stage, 'HermesOffice.app')
    const appPath = join(temp, 'Applications', 'HermesOffice.app')
    const capture = join(temp, 'open-env.txt')

    // staged (new) bundle + an already-installed (old) bundle that the atomic
    // swap renames aside before copying the new one in
    makeMinimalBundle(stagedApp)
    makeMinimalBundle(appPath)
    mkdirSync(bin, { recursive: true })
    executable(join(bin, 'pgrep'), 'exit 1')
    executable(join(bin, 'sleep'), 'exit 0')
    executable(join(bin, 'codesign'), 'exit 0')
    executable(join(bin, 'open'), `printf '%s' "\${ELECTRON_RUN_AS_NODE-unset}" > "${capture}"`)

    const result = spawnSync(process.execPath, [HELPER, 'install'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${bin}:/usr/bin:/bin`,
        ELECTRON_RUN_AS_NODE: '1',
        HERMESOFFICE_STAGE_DIR: stage,
        HERMESOFFICE_APP_PATH: appPath,
      },
    })

    assert.equal(result.status, 0, result.stderr || result.stdout)
    assert.equal(readFileSync(capture, 'utf8'), 'unset')
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
})

test('check reports semantic versions (current + latest ho-v tag)', () => {
  const temp = mkdtempSync(join(tmpdir(), 'hermesoffice-update-test-'))
  try {
    const bin = join(temp, 'bin')
    const appPath = join(temp, 'Applications', 'HermesOffice.app')
    mkdirSync(bin, { recursive: true })
    makeMinimalBundle(appPath)
    writeFileSync(
      join(appPath, 'Contents', 'Resources', 'build-info.json'),
      JSON.stringify({ commit: 'test-commit', version: '0.4.0' }),
    )
    executable(
      join(bin, 'git'),
      `if [ "$1" = "ls-remote" ]; then
  if echo "$*" | grep -q "refs/heads/main"; then
    printf '%s\trefs/heads/main\n' 4444444444444444444444444444444444444444
  else
    printf '%s\trefs/tags/ho-v0.4.0\n' 1111111111111111111111111111111111111111
    printf '%s\trefs/tags/ho-v0.5.0\n' 2222222222222222222222222222222222222222
    printf '%s\trefs/tags/ho-v0.5.0^{}\n' 2222222222222222222222222222222222222222
    printf '%s\trefs/tags/v0.5.83\n' 3333333333333333333333333333333333333333
  fi
  exit 0
fi
exit 1`,
    )
    const result = spawnSync(process.execPath, [HELPER, 'check'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${bin}:/usr/bin:/bin`,
        HERMESOFFICE_APP_PATH: appPath,
        HERMESOFFICE_REPO: 'https://example.invalid/repo.git',
      },
    })
    assert.equal(result.status, 0, result.stderr || result.stdout)
    const out = JSON.parse(result.stdout)
    assert.equal(out.currentVersion, '0.4.0')
    assert.equal(out.latestVersion, '0.5.0')
    assert.equal(out.latestCommit, '2222222222222222222222222222222222222222')
    assert.equal(out.main, '4444444444444444444444444444444444444444')
    assert.equal(out.behind, true)
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
})

test('prepare resolves npm outside the minimal PATH (fake sh reports it)', () => {
  const temp = mkdtempSync(join(tmpdir(), 'hermesoffice-update-test-'))
  try {
    const bin = join(temp, 'bin')
    const src = join(temp, 'src')
    const marker = join(temp, 'npm-called.txt')
    mkdirSync(bin, { recursive: true })
    mkdirSync(join(src, '.git'), { recursive: true })
    // fake sh: `command -v npm` prints the fake npm (a login shell would do
    // the same on a real machine); real npm is deliberately NOT on this PATH
    executable(join(bin, 'sh'), `printf '%s\n' "${bin}/npm"`)
    executable(join(bin, 'npm'), `printf 'called' > "${marker}"`)
    executable(join(bin, 'git'), 'exit 0')
    const result = spawnSync(process.execPath, [HELPER, 'prepare'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${bin}:/usr/bin:/bin`,
        HERMESOFFICE_SOURCE_DIR: src,
      },
    })
    assert.equal(result.status, 0, result.stderr || result.stdout)
    assert.equal(readFileSync(marker, 'utf8'), 'called')
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
})

test('build hands the rust toolchain to npm (cargo lives in ~/.cargo/bin)', () => {
  const temp = mkdtempSync(join(tmpdir(), 'hermesoffice-update-test-'))
  try {
    const bin = join(temp, 'bin')
    const src = join(temp, 'src')
    const stage = join(temp, 'stage')
    const seenPath = join(temp, 'npm-path.txt')
    const app = join(src, 'apps', 'shell', 'release', 'mac-arm64', 'HermesOffice.app')
    mkdirSync(bin, { recursive: true })
    mkdirSync(join(src, '.git'), { recursive: true })
    makeMinimalBundle(app)
    // fake npm: records the PATH it was spawned with, then reports success.
    // `cargo` is deliberately not reachable through this PATH — dist:mac
    // compiles the sheets sidecar with cargo, which lives in ~/.cargo/bin.
    executable(join(bin, 'npm'), `printf '%s' "$PATH" > "${seenPath}"`)
    const result = spawnSync(process.execPath, [HELPER, 'build'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${bin}:/usr/bin:/bin:/usr/sbin:/sbin`, // LaunchServices' minimal PATH + the fake npm
        HERMESOFFICE_SOURCE_DIR: src,
        HERMESOFFICE_STAGE_DIR: stage,
      },
    })
    assert.equal(result.status, 0, result.stderr || result.stdout)
    const childPath = readFileSync(seenPath, 'utf8').split(':')
    assert.ok(
      childPath.includes(join(homedir(), '.cargo', 'bin')),
      `cargo dir missing: ${childPath.join(':')}`,
    )
    assert.equal(childPath[0], bin, `caller PATH must win: ${childPath.join(':')}`)
    assert.ok(childPath.includes('/usr/bin'), `system PATH dropped: ${childPath.join(':')}`)
    assert.ok(
      existsSync(join(stage, 'HermesOffice.app', 'Contents', 'Resources', 'build-info.json')),
    )
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
})

test('prepare clones with a full working tree (no --no-checkout)', () => {
  // Regression: the clone used --no-checkout, so the helper script itself
  // (spawned from inside the checkout) did not exist and every first download
  // died with a bogus "check your network" error. prepare must clone a real
  // working tree.
  const temp = mkdtempSync(join(tmpdir(), 'hermesoffice-update-test-'))
  try {
    const bin = join(temp, 'bin')
    const src = join(temp, 'src')
    const gitLog = join(temp, 'git-args.txt')
    mkdirSync(bin, { recursive: true })
    // fake git: log every invocation (clone must appear without --no-checkout)
    // and create the destination dir so the later `npm ci` (cwd=SOURCE_DIR) runs
    executable(
      join(bin, 'git'),
      `printf '%s\\n' "$*" >> "${gitLog}"; [ "$1" = "clone" ] && mkdir -p "$4"; exit 0`,
    )
    // npm resolution: fake sh reports the fake npm, which must succeed
    executable(join(bin, 'sh'), `printf '%s\\n' "${bin}/npm"`)
    executable(join(bin, 'npm'), 'exit 0')

    const result = spawnSync(process.execPath, [HELPER, 'prepare'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${bin}:/usr/bin:/bin`,
        HERMESOFFICE_SOURCE_DIR: src,
      },
    })
    assert.equal(result.status, 0, result.stderr || result.stdout)

    const cloneLine = readFileSync(gitLog, 'utf8')
      .split('\n')
      .find((line) => line.includes('clone'))
    assert.ok(cloneLine, 'prepare must run a git clone: ' + readFileSync(gitLog, 'utf8'))
    assert.ok(
      !cloneLine.includes('--no-checkout'),
      `clone must not use --no-checkout: ${cloneLine}`,
    )
    assert.ok(
      cloneLine.includes('--filter=blob:none'),
      `clone keeps blob:none filter: ${cloneLine}`,
    )
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
})

test('prepare fetches tags with --force and resets to origin/main (stale local tag cannot wedge the update)', () => {
  // Regression: a local ho-v* tag that diverges from the remote (e.g. the
  // remote force-moved it) makes a plain `git fetch --tags` exit 1 with
  // "would clobber existing tag" — the app then reports a bogus "download
  // failed, check your network". prepare must force-adopt remote tags and
  // reset against origin/main so a stale tag can never block the update.
  const temp = mkdtempSync(join(tmpdir(), 'hermesoffice-update-test-'))
  try {
    const bin = join(temp, 'bin')
    const src = join(temp, 'src')
    const gitLog = join(temp, 'git-args.txt')
    mkdirSync(bin, { recursive: true })
    mkdirSync(join(src, '.git'), { recursive: true }) // existing checkout → no clone
    executable(join(bin, 'git'), `printf '%s\\n' "$*" >> "${gitLog}"; exit 0`)
    executable(join(bin, 'sh'), `printf '%s\\n' "${bin}/npm"`)
    executable(join(bin, 'npm'), 'exit 0')

    const result = spawnSync(process.execPath, [HELPER, 'prepare'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${bin}:/usr/bin:/bin`,
        HERMESOFFICE_SOURCE_DIR: src,
      },
    })
    assert.equal(result.status, 0, result.stderr || result.stdout)

    const lines = readFileSync(gitLog, 'utf8').split('\n').filter(Boolean)
    const tagsFetch = lines.find((l) => l.includes('fetch') && l.includes('--tags'))
    assert.ok(tagsFetch, 'prepare must fetch tags: ' + lines.join(' | '))
    assert.ok(tagsFetch.includes('--force'), `tags fetch must use --force: ${tagsFetch}`)
    const reset = lines.find((l) => l.includes('reset'))
    assert.ok(reset && reset.includes('origin/main'), `reset must target origin/main: ${reset}`)
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
})

test('prepare pins the build to HERMESOFFICE_TARGET_REF (release-train)', () => {
  const temp = mkdtempSync(join(tmpdir(), 'hermesoffice-update-test-'))
  try {
    const bin = join(temp, 'bin')
    const src = join(temp, 'src')
    const gitLog = join(temp, 'git-calls.txt')
    mkdirSync(bin, { recursive: true })
    mkdirSync(join(src, '.git'), { recursive: true })
    executable(join(bin, 'git'), `printf '%s\\n' "$*" >> "${gitLog}"; exit 0`)
    executable(join(bin, 'npm'), 'exit 0')
    const result = spawnSync(process.execPath, [HELPER, 'prepare'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${bin}:/usr/bin:/bin`,
        HERMESOFFICE_SOURCE_DIR: src,
        HERMESOFFICE_NPM: join(bin, 'npm'),
        HERMESOFFICE_TARGET_REF: 'ho-v0.9.9',
      },
    })
    assert.equal(result.status, 0, result.stderr || result.stdout)
    const calls = readFileSync(gitLog, 'utf8')
    assert.match(calls, /reset --hard ho-v0\.9\.9/)
    assert.doesNotMatch(calls, /reset --hard FETCH_HEAD|reset --hard origin\/main/)
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
})

test('install does not wait out the poll window on its own process (pgrep self-match)', () => {
  // Regression: the helper runs through the packaged HermesOffice binary
  // (ELECTRON_RUN_AS_NODE), so `pgrep -x HermesOffice` matches the helper
  // itself. Before the fix the wait loop always burned the full 30s poll —
  // and, worse, masked whether the real app had actually quit before the
  // bundle swap. The fake pgrep reports the helper's own parent PID; with the
  // self-filter the install must proceed immediately (well under 30s).
  const temp = mkdtempSync(join(tmpdir(), 'hermesoffice-update-test-'))
  try {
    const bin = join(temp, 'bin')
    const stage = join(temp, 'stage')
    const stagedApp = join(stage, 'HermesOffice.app')
    const appPath = join(temp, 'Applications', 'HermesOffice.app')

    makeMinimalBundle(stagedApp)
    makeMinimalBundle(appPath)
    mkdirSync(bin, { recursive: true })
    // report the helper's PID ($$ is the pgrep shell; its parent is the helper)
    executable(join(bin, 'pgrep'), 'ps -o ppid= -p $$')
    executable(join(bin, 'sleep'), 'exit 0')
    executable(join(bin, 'codesign'), 'exit 0')
    executable(join(bin, 'open'), 'exit 0')

    const start = Date.now()
    const result = spawnSync(process.execPath, [HELPER, 'install'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${bin}:/usr/bin:/bin`,
        ELECTRON_RUN_AS_NODE: '1',
        HERMESOFFICE_STAGE_DIR: stage,
        HERMESOFFICE_APP_PATH: appPath,
      },
    })
    const elapsed = Date.now() - start

    assert.equal(result.status, 0, result.stderr || result.stdout)
    assert.ok(elapsed < 10_000, `install took ${elapsed}ms — poll window not skipped`)
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
})
