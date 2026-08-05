/**
 * HermesOffice fork layer: health probe for the local Hermes gateway.
 *
 * The gateway serves GET /health at its root (the OpenAI-compatible API
 * lives under /v1), so the probe strips a trailing /v1 from the configured
 * base URL. A passing probe is cached briefly so we don't hit /health on
 * every message; any failure invalidates the cache immediately.
 */
import { HERMES_LLM_BASE_URL } from './providers'

export const HERMES_HEALTH_TIMEOUT_MS = 2000
export const HERMES_HEALTH_CACHE_MS = 30_000

export class HermesGatewayOfflineError extends Error {
  constructor(baseUrl: string) {
    super(
      `Hermes gateway is not reachable at ${baseUrl}. ` +
        `Start it on the host (enable gateway.platforms.api_server in config.yaml, ` +
        `then run \`hermes gateway restart\`) and try again. ` +
        `See docs/hermes-integration.md for setup.`,
    )
    this.name = 'HermesGatewayOfflineError'
  }
}

export function hermesHealthUrl(baseUrl: string): string {
  const trimmed = (baseUrl || HERMES_LLM_BASE_URL).replace(/\/+$/, '')
  return `${trimmed.replace(/\/v1$/, '')}/health`
}

let lastHealthyAt = 0
let lastHealthyUrl = ''

/** Test hook: forget the cached healthy probe. */
export function resetHermesHealthCache(): void {
  lastHealthyAt = 0
  lastHealthyUrl = ''
}

/**
 * Throw HermesGatewayOfflineError unless the gateway answers /health.
 * A recent successful probe of the same URL short-circuits.
 */
export async function ensureHermesGatewayHealthy(
  baseUrl: string,
  opts?: { timeoutMs?: number; now?: () => number; fetchImpl?: typeof fetch },
): Promise<void> {
  const now = opts?.now ?? Date.now
  const url = hermesHealthUrl(baseUrl)
  if (lastHealthyUrl === url && now() - lastHealthyAt < HERMES_HEALTH_CACHE_MS) return
  const fetchImpl = opts?.fetchImpl ?? fetch
  try {
    const response = await fetchImpl(url, {
      signal: AbortSignal.timeout(opts?.timeoutMs ?? HERMES_HEALTH_TIMEOUT_MS),
    })
    if (!response.ok) throw new Error(`health returned ${response.status}`)
  } catch {
    resetHermesHealthCache()
    throw new HermesGatewayOfflineError(baseUrl || HERMES_LLM_BASE_URL)
  }
  lastHealthyUrl = url
  lastHealthyAt = now()
}
