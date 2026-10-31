import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createExternalWatchRegistry,
  EXTERNAL_WATCH_QUIET_MS,
  probeExternalChange,
  type ExternalWatchHooks,
  type WatchFileProbe,
} from '../src/main/external-watch'
import type { DiskFileState } from '../src/main/external-change'

const baseline: DiskFileState = { mtimeMs: 1000, size: 42, hash: 'aaa' }

describe('probeExternalChange', () => {
  const probe = (over: Partial<Parameters<typeof probeExternalChange>[0]> = {}) =>
    probeExternalChange({
      baseline,
      current: { mtimeMs: 2000, size: 43 },
      hash: 'bbb',
      armedHash: 'bbb',
      reportedHash: null,
      ...over,
    })

  it('notifies when a new document has been stable for two ticks', () => {
    expect(probe()).toEqual({ notify: true, armedHash: 'bbb' })
  })

  it('arms on the first sighting instead of delivering a half-written file', () => {
    expect(probe({ armedHash: null })).toEqual({ notify: false, armedHash: 'bbb' })
  })

  it('does not re-deliver content it already announced', () => {
    expect(probe({ reportedHash: 'bbb' })).toEqual({ notify: false, armedHash: 'bbb' })
  })

  it('is false without a baseline (path never tracked)', () => {
    expect(probe({ baseline: undefined })).toEqual({ notify: false, armedHash: null })
  })

  it('is false when the file was deleted (a save recreates it)', () => {
    expect(probe({ current: null })).toEqual({ notify: false, armedHash: null })
  })

  it('is false when mtime and size still match, without reading the file', () => {
    expect(probe({ current: { mtimeMs: 1000, size: 42 }, hash: 'bbb' })).toEqual({
      notify: false,
      armedHash: null,
    })
  })

  it('is false when the stamp moved but the bytes are identical (touch)', () => {
    expect(probe({ hash: 'aaa' })).toEqual({ notify: false, armedHash: null })
  })

  it('is false when the changed file cannot be read back for hashing', () => {
    expect(probe({ hash: null })).toEqual({ notify: false, armedHash: null })
  })

  it('restarts the two-tick count when the writer keeps changing the bytes', () => {
    // mid-write: the hash moved on from what the previous tick saw
    expect(probe({ armedHash: 'bbb0', hash: 'bbb1' })).toEqual({
      notify: false,
      armedHash: 'bbb1',
    })
  })
})

describe('ExternalWatchRegistry', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  /** a fake file whose bytes the test rewrites at will */
  function harness() {
    let stamp = { mtimeMs: 1000, size: 42 }
    let hash = 'aaa'
    const states = new Map<number, DiskFileState>()
    const notifications: Array<string> = []
    const hooks: ExternalWatchHooks = {
      probeFile: async (): Promise<WatchFileProbe> =>
        stamp ? { current: stamp, hash } : { current: null, hash: null },
      baseline: (wcId) => states.get(wcId),
      notify: (wcId, path) => notifications.push(`${wcId}:${path}`),
    }
    const watch = createExternalWatchRegistry(hooks)
    return {
      watch,
      notifications,
      /** point the registry at the file and record its current bytes as the baseline */
      open(wcId: number, path: string, now: number) {
        watch.track(wcId, path, now)
        states.set(wcId, { mtimeMs: stamp.mtimeMs, size: stamp.size, hash })
      },
      /** another program rewrites the file */
      externalWrite(nextHash: string, mtimeMs = 2000, size = 43) {
        hash = nextHash
        stamp = { mtimeMs, size }
      },
      /** our own save: bytes land on disk and the baseline follows them */
      ownSave(wcId: number, nextHash: string) {
        hash = nextHash
        stamp = { mtimeMs: 3000, size: 44 }
        states.set(wcId, { ...stamp, hash: nextHash })
        watch.noteBaselineWritten(wcId)
      },
    }
  }

  it('delivers a clean external write after the quiet window and two ticks', async () => {
    const h = harness()
    h.open(1, '/tmp/a.docx', 0)
    h.externalWrite('bbb')
    await h.watch.tick(10_000) // quiet window elapsed; first sighting arms
    expect(h.notifications).toEqual([])
    await h.watch.tick(10_000 + 1500)
    expect(h.notifications).toEqual(['1:/tmp/a.docx'])
  })

  it('stays silent during the quiet window that follows an open', async () => {
    const h = harness()
    h.open(1, '/tmp/a.docx', 0)
    h.externalWrite('bbb')
    await h.watch.tick(EXTERNAL_WATCH_QUIET_MS - 1)
    await h.watch.tick(EXTERNAL_WATCH_QUIET_MS - 1)
    expect(h.notifications).toEqual([])
  })

  it('never reports the app its own save', async () => {
    const h = harness()
    h.open(1, '/tmp/a.docx', 0)
    h.ownSave(1, 'self')
    await h.watch.tick(10_000)
    await h.watch.tick(11_500)
    expect(h.notifications).toEqual([])
  })

  it('reports again once a second external write changes the bytes', async () => {
    const h = harness()
    h.open(1, '/tmp/a.docx', 0)
    h.externalWrite('bbb')
    await h.watch.tick(10_000)
    await h.watch.tick(11_500)
    h.externalWrite('ccc')
    await h.watch.tick(13_000)
    await h.watch.tick(14_500)
    expect(h.notifications).toEqual(['1:/tmp/a.docx', '1:/tmp/a.docx'])
  })

  it('stops watching a renderer after untrack', async () => {
    const h = harness()
    h.open(1, '/tmp/a.docx', 0)
    h.externalWrite('bbb')
    h.watch.untrack(1)
    await h.watch.tick(10_000)
    await h.watch.tick(11_500)
    expect(h.notifications).toEqual([])
  })

  it('keeps a single watched path per renderer', () => {
    const h = harness()
    h.open(1, '/tmp/a.docx', 0)
    h.watch.track(1, '/tmp/b.docx', 0)
    expect(h.watch.watchedPath(1)).toBe('/tmp/b.docx')
  })

  it('never reports content read for a path superseded while the stat was pending', async () => {
    const notifications: string[] = []
    let registry!: ReturnType<typeof createExternalWatchRegistry>
    const probeFile = vi.fn(async () => {
      // the tab navigates to another file while the stat is in flight
      registry.track(1, '/tmp/b.docx', 10_000)
      return { current: { mtimeMs: 2000, size: 43 }, hash: 'bbb' }
    })
    registry = createExternalWatchRegistry({
      probeFile,
      baseline: () => baseline,
      notify: (_wcId, path) => notifications.push(path),
    })
    registry.track(1, '/tmp/a.docx', 0)
    await registry.tick(10_000)
    await registry.tick(11_500)
    await registry.tick(13_000)
    // the guard may let the *new* path through, but never the superseded one
    expect(notifications).not.toContain('/tmp/a.docx')
  })
})
