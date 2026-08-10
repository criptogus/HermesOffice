import { basename, dirname } from 'node:path'
import { watch, type FSWatcher } from 'node:fs'
import { CLOUD_UPLOAD_TIMEOUT_MS, uploadFileToCloud } from './upload'
import type { CloudConfig, CloudFileState, CloudProvider } from './types'

const DEBOUNCE_MS = 2_000

export interface CloudSyncDeps {
  /** resolved Hermes CLI binary (kept for parity with the share bridge) */
  bin: string | null
  /** current settings; read fresh on every scheduling decision */
  config: () => CloudConfig
  /** where the Google OAuth token is persisted (userData/google-token.json) */
  tokenPath: string
  /** fired after every recorded upload state (used to broadcast to the UI) */
  onStatesChanged?: (states: CloudFileState[]) => void
}

/**
 * Watches the documents currently open in the shell and uploads each one to
 * the configured cloud provider whenever it changes on disk (debounced).
 *
 * Uploads run strictly one at a time — each goes through the Hermes agent,
 * which is expensive — and changes that arrive while an upload is in flight
 * are coalesced into a trailing re-upload.
 */
export class CloudSyncManager {
  private readonly watchers = new Map<string, FSWatcher>()
  private readonly timers = new Map<string, NodeJS.Timeout>()
  private readonly states = new Map<string, CloudFileState>()
  private readonly pending = new Set<string>()
  private running = false
  private disposed = false

  constructor(private readonly deps: CloudSyncDeps) {}

  /** surface per-file status (used by the shell to broadcast to the UI) */
  getFileStates(): CloudFileState[] {
    return [...this.states.values()]
  }

  /** re-sync watchers so they cover exactly the given open file paths */
  syncWith(filePaths: string[]): void {
    const wanted = new Set(filePaths)
    for (const [filePath, watcher] of this.watchers) {
      if (!wanted.has(filePath)) {
        watcher.close()
        this.watchers.delete(filePath)
        const timer = this.timers.get(filePath)
        if (timer) {
          clearTimeout(timer)
          this.timers.delete(filePath)
        }
        this.pending.delete(filePath)
        this.states.delete(filePath)
      }
    }
    for (const filePath of wanted) {
      if (!this.watchers.has(filePath)) this.watchFile(filePath)
    }
  }

  /** immediate upload (e.g. "test connection" from the UI); bypasses debounce */
  async uploadNow(filePath: string): Promise<CloudFileState> {
    const config = this.deps.config()
    if (!this.deps.bin || !config.provider) {
      return this.record(filePath, {
        filePath,
        error: 'No cloud provider configured',
      })
    }
    // join the shared serial queue so a manual upload never collides with an
    // in-flight watcher upload (two `hermes -z` runs at once can wedge)
    this.pending.add(filePath)
    const deadline = Date.now() + CLOUD_UPLOAD_TIMEOUT_MS + 10_000
    while (this.pending.has(filePath) && Date.now() < deadline && !this.disposed) {
      void this.drain(config.provider, config.folder)
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    return this.states.get(filePath) ?? { filePath, error: 'Upload did not complete' }
  }

  dispose(): void {
    this.disposed = true
    for (const watcher of this.watchers.values()) watcher.close()
    this.watchers.clear()
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
    this.pending.clear()
  }

  private watchFile(filePath: string): void {
    const directory = dirname(filePath)
    const fileName = basename(filePath)
    // watch the parent directory: saves that replace the file (write-then-rename)
    // can be missed by a per-file watcher, and the dir watcher survives them
    const watcher = watch(directory, (_event, changedName) => {
      if (this.disposed) return
      if (changedName !== fileName) return
      const config = this.deps.config()
      if (!config.autoSync || !config.provider) return
      this.schedule(filePath, config.provider, config.folder)
    })
    this.watchers.set(filePath, watcher)
  }

  private schedule(filePath: string, provider: CloudProvider, folder: string): void {
    const existing = this.timers.get(filePath)
    if (existing) clearTimeout(existing)
    this.timers.set(
      filePath,
      setTimeout(() => {
        this.timers.delete(filePath)
        this.pending.add(filePath)
        void this.drain(provider, folder)
      }, DEBOUNCE_MS),
    )
  }

  /** process the pending queue one upload at a time */
  private async drain(provider: CloudProvider, folder: string): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      while (this.pending.size > 0 && !this.disposed) {
        const filePath = this.pending.values().next().value as string
        this.pending.delete(filePath)
        await this.doUpload(filePath, provider, folder)
      }
    } finally {
      this.running = false
    }
  }

  private async doUpload(
    filePath: string,
    provider: CloudProvider,
    folder: string,
  ): Promise<CloudFileState> {
    const bin = this.deps.bin
    if (!bin) {
      return this.record(filePath, { filePath, error: 'Hermes CLI not found' })
    }
    const result = await uploadFileToCloud(bin, provider, filePath, {
      folder,
      tokenPath: this.deps.tokenPath,
    })
    const state: CloudFileState = result.ok
      ? { filePath, link: result.link, lastAttemptAt: Date.now() }
      : { filePath, error: result.error, lastAttemptAt: Date.now() }
    return this.record(filePath, state)
  }

  private record(filePath: string, state: CloudFileState): CloudFileState {
    this.states.set(filePath, state)
    this.deps.onStatesChanged?.(this.getFileStates())
    return state
  }
}
