/**
 * Shared types for the HermesOffice → Hermes share bridge.
 *
 * The bridge shells out to the Hermes CLI (`hermes send`) which already knows
 * how to deliver text + native media attachments to every messaging platform
 * the gateway is configured for (Telegram, WhatsApp, email, Signal, Discord,
 * Slack, …). This package owns the CLI discovery, the channel listing and the
 * send itself; the Electron window/IPC wrappers live in ipc.ts /
 * share-window.ts and are intentionally thin.
 */

/** one deliverable channel as reported by `hermes send --list --json` */
export interface ShareChannel {
  /** platform id, e.g. 'telegram', 'whatsapp', 'email' */
  platform: string
  /** platform-native target id (chat id, JID, email address, …) */
  id?: string
  /** human-friendly name for the picker */
  name: string
  /** directory entry kind: 'dm' | 'group' | 'channel' | … */
  type?: string
  /** thread/topic id for platforms that support it (Telegram topics, …) */
  threadId?: string | number | null
  /** ready-to-use `--to` value (platform[:id[:thread]]), precomputed by the main */
  target?: string
}

export interface ShareTargets {
  /** flattened, sorted-by-platform channel list for the picker */
  channels: ShareChannel[]
  /** every configured platform, even ones with no discovered channels yet */
  platforms: string[]
}

export interface ShareSendRequest {
  /** absolute path of the file to attach (must exist on disk) */
  filePath: string
  /** delivery target: 'telegram', 'telegram:1088196041', 'discord:#ops', … */
  target: string
  /** optional caption / body message riding on the media bubble */
  message?: string
}

export interface ShareSendResult {
  ok: boolean
  /** human-readable error when ok === false */
  error?: string
  /** CLI note on success (e.g. 'sent to Gustavo') */
  note?: string
}

/** localized strings the share window renderer displays */
export interface ShareStrings {
  title: string
  fileLabel: string
  targetLabel: string
  messageLabel: string
  optional: string
  send: string
  cancel: string
  sending: string
  sent: string
  failed: string
  noHermes: string
  noTargets: string
  noFile: string
  close: string
}

/** immutable snapshot the share window renders on open */
export interface ShareWindowState {
  /** absolute path of the document being shared; absent when the tab has no file yet */
  filePath?: string
  fileName?: string
  /** true when a usable `hermes` CLI was discovered on this machine */
  hermesAvailable: boolean
  /** BCP-47 tag for documentElement.lang (drives CJK font selection) */
  lang: string
  strings: ShareStrings
}

/** the file the share window sends; target is resolved by the picker */
export interface ShareWindowSendRequest {
  target: string
  message?: string
}
