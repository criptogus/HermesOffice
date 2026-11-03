/**
 * Live reload: watch the file of every open document and tell its renderer as
 * soon as another program (agent/MCP, script, sync, another editor) writes it.
 *
 * `external-change.ts` covers the save side — never clobber an external write.
 * This module covers the read side: the editor must *show* the new content in
 * real time instead of only learning about it on the next save.
 *
 * Design notes:
 * - Polling, not `fs.watch`. Documents are written atomically (temp file +
 *   rename), which replaces the inode; a watch bound to the old inode goes deaf
 *   exactly on the writes we care about. One stat per open tab per tick is
 *   cheap and has no platform-specific edge cases.
 * - The baseline is the snapshot `rememberDiskState` already records at every
 *   read and every save — no second source of truth for "what we last saw".
 * - Only the decision half touches the filesystem, so it is unit-testable
 *   without Electron.
 */
import type { DiskFileState } from './external-change'

export type { DiskFileState }

/** cheap identification of a file version; a moved stamp triggers the hash */
export interface WatchStamp {
  mtimeMs: number
  size: number
}

/** everything the decision needs, gathered once per tick */
export interface WatchProbe {
  /** snapshot recorded by the last read/write; undefined = path never tracked */
  baseline: DiskFileState | undefined
  /** stat right now, null when the file is gone */
  current: WatchStamp | null
  /** hash right now, null when unreadable */
  hash: string | null
  /** hash seen on the previous tick (half-written guard) */
  armedHash: string | null
  /** hash already announced to the renderer */
  reportedHash: string | null
}

export interface WatchVerdict {
  /** the content on disk is a new document and is safe to show */
  notify: boolean
  /** hash to remember as "seen on the previous tick" */
  armedHash: string | null
}

const IDLE: WatchVerdict = { notify: false, armedHash: null }

/**
 * Decide whether the bytes on disk are a fully written, not-yet-announced
 * document that differs from our baseline.
 *
 * A change is only announced after the same hash shows up on two consecutive
 * ticks: reading a file while its writer is mid-flight yields partial bytes,
 * and replacing the editor with those would be worse than being one tick late.
 */
export function probeExternalChange(probe: WatchProbe): WatchVerdict {
  const { baseline, current, hash } = probe
  // never tracked (or the grant was reclaimed): nothing to compare against
  if (!baseline) return IDLE
  // deleted externally: there is no content to show; the editor keeps what it
  // has and a save recreates the file — the same rule the save side follows
  if (!current) return IDLE
  // stamp untouched: no write happened, so skip reading the file at all
  if (current.mtimeMs === baseline.mtimeMs && current.size === baseline.size) return IDLE
  // unreadable (or gone mid-tick): try again on the next tick
  if (hash === null) return IDLE
  // stamp moved but the bytes are identical (touch, metadata-only rewrite)
  if (hash === baseline.hash) return IDLE
  // this exact content was already handed to the renderer
  if (hash === probe.reportedHash) return { notify: false, armedHash: hash }
  // first sighting: arm, do not deliver yet
  if (hash !== probe.armedHash) return { notify: false, armedHash: hash }
  return { notify: true, armedHash: hash }
}

export interface WatchFileProbe {
  current: WatchStamp | null
  hash: string | null
}

export interface ExternalWatchHooks {
  /**
   * stat the path, and hash it only when the stamp moved away from `baseline`
   * (the caller passes the same snapshot it will hand to `probeExternalChange`)
   */
  probeFile(path: string, baseline: DiskFileState | undefined): Promise<WatchFileProbe>
  /** snapshot docs:save consults for the same (wcId, path) pair */
  baseline(wcId: number, path: string): DiskFileState | undefined
  /** the file on disk is a new document — push it to the renderer */
  notify(wcId: number, path: string): void
}

/** ~1.5s: fast enough to feel live, cheap enough to run for every open tab */
export const EXTERNAL_WATCH_INTERVAL_MS = 1500

/**
 * Ticks ignored after we ourselves wrote (or opened) the file. The baseline is
 * recorded *after* the write, so a tick landing in between would compare the
 * new bytes against the old baseline and read our own save as someone else's.
 */
export const EXTERNAL_WATCH_QUIET_MS = 1000

/**
 * One watched path per renderer: a docs tab shows a single document, so
 * `track` replaces the previous path instead of accumulating.
 */
export class ExternalWatchRegistry {
  private readonly watchedPaths = new Map<number, string>()
  private readonly armedHashes = new Map<number, string | null>()
  private readonly reportedHashes = new Map<number, string | null>()
  private readonly quietUntil = new Map<number, number>()
  private timer: ReturnType<typeof setInterval> | null = null
  private ticking = false

  constructor(private readonly hooks: ExternalWatchHooks) {}

  /** begin watching `filePath` for the renderer; replaces its previous path */
  track(wcId: number, filePath: string, now = Date.now()): void {
    if (this.watchedPaths.get(wcId) === filePath) return
    this.watchedPaths.set(wcId, filePath)
    this.armedHashes.set(wcId, null)
    this.reportedHashes.set(wcId, null)
    this.quietUntil.set(wcId, now + EXTERNAL_WATCH_QUIET_MS)
  }

  /** our own read/write just moved the baseline: no change to report */
  noteBaselineWritten(wcId: number, now = Date.now()): void {
    if (!this.watchedPaths.has(wcId)) return
    this.armedHashes.set(wcId, null)
    this.reportedHashes.set(wcId, null)
    this.quietUntil.set(wcId, now + EXTERNAL_WATCH_QUIET_MS)
  }

  /** tab closed / navigated away: stop looking at the disk for it */
  untrack(wcId: number): void {
    this.watchedPaths.delete(wcId)
    this.armedHashes.delete(wcId)
    this.reportedHashes.delete(wcId)
    this.quietUntil.delete(wcId)
  }

  /** the path currently watched for a renderer, or null */
  watchedPath(wcId: number): string | null {
    return this.watchedPaths.get(wcId) ?? null
  }

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => void this.tick(), EXTERNAL_WATCH_INTERVAL_MS)
    // a backgrounded window must not hold the app open or be kept awake
    this.timer.unref?.()
  }

  stop(): void {
    if (!this.timer) return
    clearInterval(this.timer)
    this.timer = null
  }

  /** one pass over every watched path; re-entrancy is a no-op */
  async tick(now = Date.now()): Promise<void> {
    if (this.ticking) return
    this.ticking = true
    try {
      for (const [wcId, filePath] of [...this.watchedPaths]) {
        if ((this.quietUntil.get(wcId) ?? 0) > now) continue
        const baseline = this.hooks.baseline(wcId, filePath)
        const { current, hash } = await this.hooks.probeFile(filePath, baseline)
        // the path may have been replaced (tab navigated / grant revoked) while
        // the stat was pending — never report content read for the old file
        if (this.watchedPaths.get(wcId) !== filePath) continue
        const verdict = probeExternalChange({
          baseline,
          current,
          hash,
          armedHash: this.armedHashes.get(wcId) ?? null,
          reportedHash: this.reportedHashes.get(wcId) ?? null,
        })
        this.armedHashes.set(wcId, verdict.armedHash)
        if (!verdict.notify) continue
        this.reportedHashes.set(wcId, verdict.armedHash)
        this.hooks.notify(wcId, filePath)
      }
    } finally {
      this.ticking = false
    }
  }
}

export function createExternalWatchRegistry(hooks: ExternalWatchHooks): ExternalWatchRegistry {
  return new ExternalWatchRegistry(hooks)
}
