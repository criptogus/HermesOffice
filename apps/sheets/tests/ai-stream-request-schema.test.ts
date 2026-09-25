/**
 * Regression test for #17. Every renderer→main ai:stream request is parsed
 * through the strict aiStreamRequestSchema. Commit 70374e0 added an optional
 * `sessionId` (the per-workbook project-store chatId, forwarded to the Hermes
 * gateway as X-Hermes-Session-Id); the upstream sync in #58 dropped it, so a
 * renderer sending the id was rejected by the main process before the request
 * ever reached the provider. Pin both shapes: with the id (must pass through
 * verbatim) and without it (legacy / non-Hermes callers).
 */
import { describe, expect, it } from 'vitest'
import { aiStreamRequestSchema } from '../src/shared/desktop-api'

function streamRequest(extra: Record<string, unknown> = {}) {
  return {
    requestId: 'req-1',
    settings: {
      provider: 'hermes',
      providers: { hermes: { apiKey: 'k', model: 'hermes-agent' } },
    },
    system: 'sys',
    messages: [{ role: 'user', text: 'hi' }],
    ...extra,
  }
}

describe('aiStreamRequestSchema', () => {
  it('accepts a request carrying the per-document sessionId (#17)', () => {
    const sessionId = 'a'.repeat(64) // project-store chatId: sha256 hex of the file path
    const request = streamRequest({ sessionId })
    expect(() => aiStreamRequestSchema.parse(request)).not.toThrow()
    expect(aiStreamRequestSchema.parse(request).sessionId).toBe(sessionId)
  })

  it('still accepts a request without a sessionId', () => {
    const request = streamRequest()
    expect(() => aiStreamRequestSchema.parse(request)).not.toThrow()
    expect('sessionId' in aiStreamRequestSchema.parse(request)).toBe(false)
  })

  it('rejects an empty sessionId', () => {
    expect(() => aiStreamRequestSchema.parse(streamRequest({ sessionId: '' }))).toThrow()
  })
})
