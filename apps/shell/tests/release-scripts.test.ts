import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Ordering inside the release scripts (root package.json).
 *
 * `npm run notices` requires apps/shell/electron-builder.cjs, and that config
 * throws on require when apps/shell/build/build-info.json is missing — a file
 * the same chain only generates later. In an old clone the file survives from a
 * previous build and hides the bug; in a fresh worktree or checkout the
 * installer build dies at step one. Every dist:* must generate it first.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const scripts = (
  JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>
  }
).scripts

describe('release scripts', () => {
  for (const name of ['dist:mac', 'dist:win', 'dist:linux']) {
    it(`${name} writes build-info.json before notices`, () => {
      const script = scripts[name]
      expect(script).toBeTruthy()
      const buildInfo = script.indexOf('write-build-info.mjs')
      const notices = script.indexOf('npm run notices')
      expect(buildInfo).toBeGreaterThanOrEqual(0)
      expect(notices).toBeGreaterThanOrEqual(0)
      expect(buildInfo).toBeLessThan(notices)
    })
  }
})
