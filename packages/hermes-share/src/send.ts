/**
 * Send a document as a native media attachment through `hermes send`.
 *
 * The message body is built as `MEDIA:"<path>" <caption>` — the exact syntax
 * the Hermes send pipeline parses (`MEDIA_TAG_CLEANUP_RE` accepts quoted
 * paths, so filenames with spaces and other characters are safe).
 */

import { execFile } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import type { ShareSendRequest, ShareSendResult } from './types'

/** Telegram's Bot API caps documents at 50 MB; other platforms are similar or looser */
export const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024

export const SEND_TIMEOUT_MS = 120_000

/**
 * Quote a MEDIA path with a delimiter that cannot collide with the path's own
 * characters. The Hermes parser accepts double-quoted, backticked and
 * single-quoted paths, in that preference order.
 */
export function quoteMediaPath(filePath: string): string {
  if (!filePath.includes('"')) return `"${filePath}"`
  if (!filePath.includes('`')) return `\`${filePath}\``
  return `'${filePath}'`
}

/** `MEDIA:"/path/file.docx" caption` — caption optional */
export function buildSendMessage(filePath: string, message?: string): string {
  const media = `MEDIA:${quoteMediaPath(filePath)}`
  const text = (message ?? '').trim()
  return text ? `${media} ${text}` : media
}

/** format `platform` / `platform:id` / `platform:id:thread` for `--to` */
export function buildTarget(channel: {
  platform: string
  id?: string
  threadId?: string | number | null
}): string {
  const base = channel.id ? `${channel.platform}:${channel.id}` : channel.platform
  return channel.threadId != null && String(channel.threadId) !== ''
    ? `${base}:${channel.threadId}`
    : base
}

/** pre-flight checks; returns a user-facing error string or null when OK */
export function validateSendRequest(request: ShareSendRequest): string | null {
  if (!request?.filePath) return 'No file to share'
  if (!request.target) return 'No delivery target selected'
  if (!existsSync(request.filePath)) return `File not found: ${request.filePath}`
  let size: number
  try {
    size = statSync(request.filePath).size
  } catch {
    return `Cannot read file: ${request.filePath}`
  }
  if (size > MAX_ATTACHMENT_BYTES) {
    const mb = Math.round(size / 1024 / 1024)
    return `File is ${mb} MB — messaging platforms cap attachments at 50 MB`
  }
  return null
}

/** raw CLI invocation; resolves {stdout, stderr} on exit 0, rejects otherwise */
export function execSend(
  bin: string,
  target: string,
  message: string,
  timeoutMs: number = SEND_TIMEOUT_MS,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      bin,
      ['send', '--to', target, message],
      { timeout: timeoutMs },
      (error, stdout, stderr) => {
        if (error) reject(new Error(stderr?.trim() || error.message))
        else resolve({ stdout, stderr })
      },
    )
  })
}

/** validate + send; never throws */
export async function sendFileToTarget(
  bin: string,
  request: ShareSendRequest,
): Promise<ShareSendResult> {
  const validationError = validateSendRequest(request)
  if (validationError) return { ok: false, error: validationError }
  try {
    const { stdout } = await execSend(
      bin,
      request.target,
      buildSendMessage(request.filePath, request.message),
    )
    return { ok: true, note: stdout?.trim() || 'sent' }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}
