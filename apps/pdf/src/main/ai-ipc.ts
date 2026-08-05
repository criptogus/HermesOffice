/**
 * AI IPC for the standalone pdf main process. In shell aggregate mode the
 * generic ai:* channels are registered once by docs-main.registerAiIpc and
 * this module is never called; standalone (`npm run dev -w @hermesoffice/pdf`)
 * previously registered nothing, leaving the AI panel dead. Mirrors the
 * slides ai-ipc: settings persistence, the streaming proxy (networking in the
 * main process to avoid renderer CORS), and web search.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, ipcMain } from 'electron'
import {
  defaultAiSettings,
  resolveAiSettings,
  streamForProvider,
  type AiSettings,
  type AiStreamChunk,
  type AiStreamRequest,
  type LegacyAiSettings,
} from '@hermesoffice/ai-provider'
import { webSearch } from '@hermesoffice/ai-search'

const AI_SETTINGS_PATH = () => join(app.getPath('userData'), 'ai-settings.json')

function readJson<T>(path: string, fallback: T): T {
  try {
    if (existsSync(path)) return JSON.parse(readFileSync(path, 'utf-8')) as T
  } catch {
    /* Corrupted state file: fall back to defaults */
  }
  return fallback
}

const activeAiStreams = new Map<string, AbortController>()

export function registerPdfAiIpc(): void {
  ipcMain.handle('ai:get-settings', (): AiSettings => {
    const stored = readJson<Partial<AiSettings> & LegacyAiSettings>(AI_SETTINGS_PATH(), {})
    const settings = resolveAiSettings(stored, defaultAiSettings())
    // AI features all go through Hermes; stored settings that chose another provider are normalized back
    settings.provider = 'hermes'
    return settings
  })

  ipcMain.handle('ai:set-settings', (_event, settings: AiSettings) => {
    mkdirSync(join(AI_SETTINGS_PATH(), '..'), { recursive: true })
    writeFileSync(AI_SETTINGS_PATH(), JSON.stringify(settings, null, 2))
  })

  ipcMain.handle('ai:stream', async (event, request: AiStreamRequest) => {
    const { requestId, settings, system, messages } = request
    const tools = request.tools ?? []
    const maxTokens = request.maxTokens ?? 8192
    const provider = settings.provider
    const config = settings.providers?.[provider]
    const send = (chunk: AiStreamChunk) => {
      if (!event.sender.isDestroyed()) event.sender.send('ai:stream-chunk', chunk)
    }
    if (!config?.apiKey) {
      send({ requestId, type: 'error', error: `No API key configured for provider ${provider}` })
      return
    }
    if (!config.model) {
      send({ requestId, type: 'error', error: 'No model configured' })
      return
    }
    const controller = new AbortController()
    activeAiStreams.set(requestId, controller)
    try {
      await streamForProvider(
        provider,
        config,
        system,
        messages,
        tools,
        maxTokens,
        {
          signal: controller.signal,
          onDelta: (text) => send({ requestId, type: 'delta', text }),
          onToolCall: (toolCall) => send({ requestId, type: 'tool-call', toolCall }),
        },
        request.sessionId,
      )
      send({ requestId, type: 'done' })
    } catch (err) {
      if (controller.signal.aborted) {
        send({ requestId, type: 'done' })
      } else {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`[ai-stream] ${requestId} (${provider}/${config.model}) failed:`, msg)
        send({ requestId, type: 'error', error: msg })
      }
    } finally {
      activeAiStreams.delete(requestId)
    }
  })

  ipcMain.handle('ai:stream-cancel', (_event, requestId: string) => {
    activeAiStreams.get(requestId)?.abort()
  })

  ipcMain.handle('ai:web-search', async (_event, query: string, maxResults?: number) => {
    try {
      return await webSearch(String(query), typeof maxResults === 'number' ? maxResults : 6)
    } catch (err) {
      return { results: [], method: 'error', error: String(err) }
    }
  })
}
