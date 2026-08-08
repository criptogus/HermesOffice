/**
 * Channel discovery: run `hermes send --list --json` and normalize the
 * channel directory into a flat picker list.
 */

import { execFile } from 'node:child_process'
import type { ShareChannel, ShareTargets } from './types'

export const SEND_LIST_TIMEOUT_MS = 10_000

/** one entry of the directory's per-platform array */
interface DirectoryEntry {
  id?: string
  name?: string
  type?: string
  thread_id?: string | number | null
}

interface SendListPayload {
  platforms?: Record<string, DirectoryEntry[]>
}

/** parse the `hermes send --list --json` output (tolerant: bad JSON → empty) */
export function parseSendList(stdout: string): ShareTargets {
  let payload: SendListPayload
  try {
    payload = JSON.parse(stdout) as SendListPayload
  } catch {
    return { channels: [], platforms: [] }
  }
  const platforms = Object.keys(payload.platforms ?? {})
    .filter((p) => p && p !== 'local' && p !== 'api_server')
    .sort()

  const channels: ShareChannel[] = []
  for (const platform of platforms) {
    for (const entry of payload.platforms?.[platform] ?? []) {
      channels.push({
        platform,
        id: entry.id || undefined,
        name: entry.name || platform,
        type: entry.type,
        threadId: entry.thread_id ?? null,
      })
    }
  }
  return { channels, platforms }
}

/** run the list command; rejects on non-zero exit */
export function execSendList(
  bin: string,
  timeoutMs: number = SEND_LIST_TIMEOUT_MS,
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(bin, ['send', '--list', '--json'], { timeout: timeoutMs }, (error, stdout) => {
      if (error) reject(new Error(`hermes send --list failed: ${error.message}`))
      else resolve(stdout)
    })
  })
}

/** full discovery: locate CLI → list → normalize */
export async function listShareTargets(bin: string): Promise<ShareTargets> {
  const stdout = await execSendList(bin)
  return parseSendList(stdout)
}

/**
 * Append a synthetic home-channel entry for every configured platform that has
 * no discovered channels (e.g. a WhatsApp bridge in self-chat mode never
 * discovers chats). Delivery then resolves through `<PLATFORM>_HOME_CHANNEL` —
 * the same configured-but-undiscovered fallback `hermes send --list` exposes.
 */
export function withHomeChannelFallbacks(targets: ShareTargets): ShareTargets {
  const covered = new Set(targets.channels.map((c) => c.platform))
  const fallbacks = targets.platforms
    .filter((platform) => !covered.has(platform))
    .map((platform) => ({ platform, name: `${platform} (home)`, target: platform }))
  return { ...targets, channels: [...targets.channels, ...fallbacks] }
}
