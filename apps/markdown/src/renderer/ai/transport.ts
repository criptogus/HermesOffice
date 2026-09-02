import { createIpcTransport, type AgentTransport } from '@hermesoffice/agent-core'
import type { AiSettings } from '@hermesoffice/ai-provider'
import { t } from '../i18n/locale'

/** The shared IPC transport wired to the markdown preload bridge (window.markdownApi). */
export function createElectronTransport(getSettings: () => AiSettings): AgentTransport {
  return createIpcTransport<AiSettings>({
    onStream: (listener) => window.markdownApi.onAiStream(listener),
    start: (request) => window.markdownApi.aiStream(request),
    cancel: (requestId) => void window.markdownApi.aiStreamCancel(requestId),
    getSettings,
    unknownErrorText: () => t('aiUnknownError'),
    timeoutErrorText: () => t('aiTimeoutError'),
    creditsErrorText: () => t('aiCreditsExhausted'),
    networkErrorText: () => t('aiNetworkError'),
    overloadedErrorText: () => t('aiOverloadedError'),
  })
}
