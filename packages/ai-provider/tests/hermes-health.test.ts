import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  HERMES_HEALTH_CACHE_MS,
  HermesGatewayOfflineError,
  ensureHermesGatewayHealthy,
  hermesHealthUrl,
  resetHermesHealthCache,
} from '../src/hermes-health'
import { jsonResponse } from './test-utils'

afterEach(() => {
  resetHermesHealthCache()
  vi.restoreAllMocks()
})

describe('hermesHealthUrl', () => {
  it('strips /v1 from the base URL', () => {
    expect(hermesHealthUrl('http://127.0.0.1:8642/v1')).toBe('http://127.0.0.1:8642/health')
  })

  it('handles trailing slashes', () => {
    expect(hermesHealthUrl('http://127.0.0.1:8642/v1/')).toBe('http://127.0.0.1:8642/health')
  })

  it('falls back to the default gateway URL when empty', () => {
    expect(hermesHealthUrl('')).toBe('http://127.0.0.1:8642/health')
  })

  it('leaves non-/v1 base URLs intact', () => {
    expect(hermesHealthUrl('http://myhost:9000')).toBe('http://myhost:9000/health')
  })
})

describe('ensureHermesGatewayHealthy', () => {
  it('resolves when /health answers 200', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ status: 'ok' }))
    await expect(
      ensureHermesGatewayHealthy('http://127.0.0.1:8642/v1', { fetchImpl }),
    ).resolves.toBeUndefined()
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:8642/health',
      expect.objectContaining({ signal: expect.anything() }),
    )
  })

  it('throws a friendly error when the gateway is unreachable', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNREFUSED')
    })
    const err = await ensureHermesGatewayHealthy('http://127.0.0.1:8642/v1', { fetchImpl }).catch(
      (e: unknown) => e,
    )
    expect(err).toBeInstanceOf(HermesGatewayOfflineError)
    expect((err as Error).message).toContain('not reachable at http://127.0.0.1:8642/v1')
    expect((err as Error).message).toContain('hermes gateway restart')
  })

  it('throws on a non-2xx /health response', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, 503))
    await expect(
      ensureHermesGatewayHealthy('http://127.0.0.1:8642/v1', { fetchImpl }),
    ).rejects.toBeInstanceOf(HermesGatewayOfflineError)
  })

  it('caches a healthy probe within the cache window', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ status: 'ok' }))
    let t = 1000
    const now = () => t
    await ensureHermesGatewayHealthy('http://127.0.0.1:8642/v1', { fetchImpl, now })
    t += HERMES_HEALTH_CACHE_MS - 1
    await ensureHermesGatewayHealthy('http://127.0.0.1:8642/v1', { fetchImpl, now })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    t += 2
    await ensureHermesGatewayHealthy('http://127.0.0.1:8642/v1', { fetchImpl, now })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('does not reuse the cache for a different base URL', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ status: 'ok' }))
    const now = () => 1000
    await ensureHermesGatewayHealthy('http://127.0.0.1:8642/v1', { fetchImpl, now })
    await ensureHermesGatewayHealthy('http://other:9000/v1', { fetchImpl, now })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('invalidates the cache after a failure', async () => {
    let healthy = true
    let t = 1000
    const now = () => t
    const fetchImpl = vi.fn(async () => {
      if (!healthy) throw new Error('down')
      return jsonResponse({ status: 'ok' })
    })
    await ensureHermesGatewayHealthy('http://127.0.0.1:8642/v1', { fetchImpl, now })
    // cache expires, gateway goes down
    t += HERMES_HEALTH_CACHE_MS + 1
    healthy = false
    await expect(
      ensureHermesGatewayHealthy('http://127.0.0.1:8642/v1', { fetchImpl, now }),
    ).rejects.toBeInstanceOf(HermesGatewayOfflineError)
    // back up: must re-probe, not serve a stale healthy result
    healthy = true
    await ensureHermesGatewayHealthy('http://127.0.0.1:8642/v1', { fetchImpl, now })
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })
})
