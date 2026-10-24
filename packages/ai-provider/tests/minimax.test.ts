import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentToolCall } from '@hermesoffice/agent-core'
import { chatForProvider } from '../src/chat'
import { activeProvider, defaultAiSettings, resolveAiSettings } from '../src/providers'
import { streamForProvider } from '../src/stream'
import { jsonResponse, okResponse, sseStream } from './test-utils'

afterEach(() => {
  vi.unstubAllGlobals()
})

const endpoints = ['https://api.minimax.io/v1', 'https://api.minimaxi.com/v1']

function savedSettings(model: string, baseUrl?: string) {
  const stored = defaultAiSettings()
  stored.provider = 'minimax'
  stored.providers.minimax = { apiKey: 'test-key', model, baseUrl }
  return resolveAiSettings(stored, defaultAiSettings())
}

describe('MiniMax request boundary', () => {
  it('sends Flash for a fresh MiniMax configuration with API-default thinking and effort', async () => {
    const settings = defaultAiSettings({ minimax: 'test-key' })
    settings.provider = 'minimax'
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ choices: [{ message: { content: 'ready' } }] }))
    vi.stubGlobal('fetch', fetchMock)

    expect(
      await chatForProvider(activeProvider(settings), settings.providers.minimax, 'system', 'hi'),
    ).toEqual({ ok: true, content: 'ready' })
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://api.minimax.io/v1/chat/completions')
    expect(init?.method).toBe('POST')
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer test-key' })
    // No disabled thinking, effort=none, service_tier, or reasoning_split=false.
    expect(JSON.parse(init?.body as string)).toEqual({
      model: 'MiniMax-M3.1-Flash',
      messages: [
        { role: 'system', content: 'system' },
        { role: 'user', content: 'hi' },
      ],
      temperature: 0.3,
    })
  })

  describe.each(endpoints)('%s', (baseUrl) => {
    it.each(['MiniMax-M3.1-Flash', 'MiniMax-M3', 'MiniMax-M2.7', 'my-saved-model'])(
      'preserves saved %s and the regional endpoint through settings resolution',
      async (model) => {
        const settings = savedSettings(model, baseUrl)
        const fetchMock = vi
          .fn<typeof fetch>()
          .mockResolvedValue(jsonResponse({ choices: [{ message: { content: 'ok' } }] }))
        vi.stubGlobal('fetch', fetchMock)
        await chatForProvider(activeProvider(settings), settings.providers.minimax, 'system', 'hi')
        const [url, init] = fetchMock.mock.calls[0]!
        expect(url).toBe(`${baseUrl}/chat/completions`)
        expect(JSON.parse(init?.body as string)).toEqual({
          model,
          messages: [
            { role: 'system', content: 'system' },
            { role: 'user', content: 'hi' },
          ],
          temperature: 0.3,
        })
      },
    )

    it.each(['MiniMax-M3.1-Flash', 'MiniMax-M3'])(
      'round-trips %s reasoning and tool history without losing image input',
      async (model) => {
        const fetchMock = vi
          .fn<typeof fetch>()
          .mockResolvedValueOnce(
            okResponse(
              sseStream([
                'data: {"choices":[{"delta":{"reasoning_content":"inspect first"}}]}',
                'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","function":{"name":"inspect","arguments":"{}"}}]},"finish_reason":"tool_calls"}]}',
                'data: [DONE]',
              ]),
            ),
          )
        vi.stubGlobal('fetch', fetchMock)
        const reasoning: string[] = []
        const toolCalls: AgentToolCall[] = []
        const config = savedSettings(model, baseUrl).providers.minimax
        const tools = [
          { name: 'inspect', description: 'Inspect the document', inputSchema: { type: 'object' } },
        ]
        const cb = {
          signal: new AbortController().signal,
          onDelta: vi.fn(),
          onReasoningDelta: (text: string) => reasoning.push(text),
          onToolCall: (call: AgentToolCall) => toolCalls.push(call),
        }
        await streamForProvider('minimax', config, 'system', [], tools, 8192, cb)
        expect(reasoning.join('')).toBe('inspect first')
        expect(toolCalls).toMatchObject([{ id: 'call-1', name: 'inspect', input: {} }])

        fetchMock.mockResolvedValueOnce(
          okResponse(
            sseStream(['data: {"choices":[{"delta":{"content":"done"},"finish_reason":"stop"}]}']),
          ),
        )
        await streamForProvider(
          'minimax',
          config,
          'system',
          [
            { role: 'user', text: 'Inspect', images: [{ mime: 'image/png', base64: 'aW1hZ2U=' }] },
            { role: 'assistant', text: '', reasoning: reasoning.join(''), toolCalls },
            {
              role: 'tool',
              results: [{ id: 'call-1', name: 'inspect', output: 'document contents' }],
            },
          ],
          tools,
          8192,
          cb,
        )
        const [url, init] = fetchMock.mock.calls[1]!
        expect(url).toBe(`${baseUrl}/chat/completions`)
        expect(JSON.parse(init?.body as string)).toEqual({
          model,
          max_tokens: 8192,
          messages: [
            { role: 'system', content: 'system' },
            {
              role: 'user',
              content: [
                { type: 'text', text: 'Inspect' },
                { type: 'image_url', image_url: { url: 'data:image/png;base64,aW1hZ2U=' } },
              ],
            },
            {
              role: 'assistant',
              content: null,
              reasoning_content: 'inspect first',
              tool_calls: [
                { id: 'call-1', type: 'function', function: { name: 'inspect', arguments: '{}' } },
              ],
            },
            { role: 'tool', tool_call_id: 'call-1', content: 'document contents' },
          ],
          tools: [
            {
              type: 'function',
              function: {
                name: 'inspect',
                description: 'Inspect the document',
                parameters: { type: 'object' },
              },
            },
          ],
          temperature: 0.3,
          stream: true,
        })
        expect(cb.onDelta).toHaveBeenCalledWith('done')
      },
    )
  })

  it('preserves a legacy custom endpoint and model in the outgoing request', async () => {
    const settings = resolveAiSettings(
      { apiKey: 'test-key', model: 'MiniMax-M2.7', baseUrl: 'https://custom.example/v1' },
      defaultAiSettings(),
    )
    settings.provider = 'custom'
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ choices: [{ message: { content: 'ok' } }] }))
    vi.stubGlobal('fetch', fetchMock)
    await chatForProvider(activeProvider(settings), settings.providers.custom, 'system', 'hi')
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://custom.example/v1/chat/completions')
    expect(JSON.parse(init?.body as string).model).toBe('MiniMax-M2.7')
  })
})
