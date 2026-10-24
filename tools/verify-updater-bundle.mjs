#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { extractFile, listPackage } from '@electron/asar'

const [appPath, expectedVersion, expectedCommit] = process.argv.slice(2)
if (!appPath || !expectedVersion || !/^[a-f0-9]{40}$/.test(expectedCommit ?? '')) {
  console.error('Usage: node tools/verify-updater-bundle.mjs <app-path> <version> <40-char-commit>')
  process.exit(2)
}
try {
  const resources = join(resolve(appPath), 'Contents', 'Resources')
  const info = JSON.parse(readFileSync(join(resources, 'build-info.json'), 'utf8'))
  const archive = join(resources, 'app.asar')
  const main = listPackage(archive)
    .filter((path) => /^\/out\/main\/.+\.js$/.test(path))
    .map((path) => extractFile(archive, path.slice(1)).toString())
    .join('\n')
  const checks = {
    version: info.version === expectedVersion,
    commit: info.commit === expectedCommit,
    startup: /initAppUpdater\(\(\) => shellWindow, currentUpdateChannel\(\)\)/.test(main),
    sourceTransport: main.includes('HERMESOFFICE_ENABLE_SOURCE_UPDATE'),
    serverTransport: main.includes('app-update.yml'),
    modules: ['docs', 'sheets', 'slides', 'pdf', 'markdown'].every((name) =>
      existsSync(join(resources, 'modules', name, 'renderer', 'index.html')),
    ),
    native: existsSync(join(resources, 'native', 'xlsx-sidecar')),
  }
  console.log(JSON.stringify({ appPath, info, checks, ok: Object.values(checks).every(Boolean) }))
  process.exitCode = Object.values(checks).every(Boolean) ? 0 : 1
} catch (error) {
  console.error(`Bundle verification failed: ${error.message}`)
  process.exitCode = 1
}
