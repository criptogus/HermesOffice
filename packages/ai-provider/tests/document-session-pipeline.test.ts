import { afterEach, describe, expect, it, vi } from 'vitest'
import { createIpcTransport, type IpcStreamChunk } from '@hermesoffice/agent-core'
import { streamForProvider } from '../src/stream'
import { okResponse, sseStream } from './test-utils'

afterEach(() => vi.unstubAllGlobals())

function documentTransport() {
  const listeners = new Set<(chunk: IpcStreamChunk) => void>()
  return createIpcTransport({
    onStream(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getSettings: () => ({ provider: 'hermes' }),
    unknownErrorText: () => 'stream failed',
    cancel: () => {},
    async start(request) {
      const send = (chunk: IpcStreamChunk) => {
        for (const listener of listeners) listener(chunk)
      }
      await streamForProvider(
        'hermes',
        { apiKey: 'test-key', model: 'hermes-agent' },
        request.system,
        request.messages,
        request.tools,
        1024,
        {
          sessionId: request.sessionId,
          signal: new AbortController().signal,
          onDelta: (text) => send({ requestId: request.requestId, type: 'delta', text }),
          onToolCall: () => {},
        },
      )
      send({ requestId: request.requestId, type: 'done' })
    },
  })
}

async function question(transport: ReturnType<typeof documentTransport>, sessionId?: string) {
  await new Promise<void>((resolve, reject) => {
    transport.stream(
      { system: 'system', messages: [{ role: 'user', text: 'hello' }], tools: [], sessionId },
      {
        onDelta: () => {},
        onToolCall: () => {},
        onDone: resolve,
        onError: (e) => reject(new Error(e)),
      },
    )
  })
}

function captureRequests() {
  const fetchMock = vi
    .fn()
    .mockImplementation(async () =>
      okResponse(sseStream(['data: {"choices":[{"delta":{"content":"ok"}}]}', 'data: [DONE]'])),
    )
  vi.stubGlobal('fetch', fetchMock)
  return () =>
    fetchMock.mock.calls.map(
      (call) => (call[1].headers as Record<string, string>)['X-Hermes-Session-Id'],
    )
}

describe('document sessions through renderer IPC and provider HTTP', () => {
  it('retains a document SHA across follow-ups and panel recreation', async () => {
    const ids = captureRequests()
    const documentId = 'a'.repeat(64)
    const firstPanel = documentTransport()
    await question(firstPanel, documentId)
    await question(firstPanel, documentId)
    await question(documentTransport(), documentId)
    expect(ids()).toEqual([documentId, documentId, documentId])
  })

  it('keeps different documents isolated even when using the same transport', async () => {
    const ids = captureRequests()
    const panel = documentTransport()
    await question(panel, 'a'.repeat(64))
    await question(panel, 'b'.repeat(64))
    expect(ids()).toEqual(['a'.repeat(64), 'b'.repeat(64)])
  })

  it('keeps a stable native-provider fallback when no document ID is available', async () => {
    const ids = captureRequests()
    const panel = documentTransport()
    await question(panel)
    await question(panel)
    expect(ids()[0]).toMatch(/^[a-f0-9-]{36}$/)
    expect(ids()[0]).toBe(ids()[1])
  })
})
