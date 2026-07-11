import { beforeEach, describe, expect, it, vi } from 'vitest'

// POST /api/errors at the module boundary (waitlist.test.ts's mocked-collaborator
// pattern). The route's collaborators — the service-role client (rate-limit
// RPC), captureError, and the bearer/cookie auth — are all mocked, so this is
// pure route logic with no dev server or hosted-Supabase round trip. `server-
// only` is neutralized for the node env (the limiter + monitoring carry it).
vi.mock('server-only', () => ({}))

const { rpc, captureError, clientFromBearerOrCookie } = vi.hoisted(() => ({
  rpc: vi.fn<(fn: string, params: unknown) => Promise<{ data: unknown; error: unknown }>>(),
  captureError: vi.fn(),
  clientFromBearerOrCookie: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ rpc }) }))
vi.mock('@/lib/monitoring/init', () => ({ captureError }))
vi.mock('@/lib/auth/bearer', () => ({ clientFromBearerOrCookie }))

import * as route from '../app/api/errors/route'

function post(body: unknown) {
  return route.POST(
    new Request('http://localhost/api/errors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    })
  )
}

beforeEach(() => {
  rpc.mockReset()
  rpc.mockResolvedValue({ data: 1, error: null }) // under limit
  captureError.mockReset()
  clientFromBearerOrCookie.mockReset()
  clientFromBearerOrCookie.mockResolvedValue({ error: 401 }) // anonymous by default
})

describe('POST /api/errors', () => {
  it('relays a valid scrubbed event and returns 200', async () => {
    const response = await post({ message: 'boom', stack: 'at x (y:1:1)', context: 'content' })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
    expect(captureError).toHaveBeenCalledOnce()
  })

  it('rejects a malformed event (unknown key) with 400 and never relays', async () => {
    const response = await post({ message: 'boom', notAllowed: 'x' })

    expect(response.status).toBe(400)
    expect(captureError).not.toHaveBeenCalled()
  })

  it('rejects a non-JSON body with 400', async () => {
    const response = await post('this is not json')
    expect(response.status).toBe(400)
    expect(captureError).not.toHaveBeenCalled()
  })

  it('returns 429 when over the per-IP rate limit, without relaying', async () => {
    rpc.mockResolvedValue({ data: 999, error: null })
    const response = await post({ message: 'boom' })

    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBeTruthy()
    expect(captureError).not.toHaveBeenCalled()
  })

  it('fails OPEN (still relays) when the rate-limit RPC errors', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'rpc down' } })
    const response = await post({ message: 'boom' })

    expect(response.status).toBe(200)
    expect(captureError).toHaveBeenCalledOnce()
  })

  it('attaches the authenticated user id to the captured context when a session is present', async () => {
    clientFromBearerOrCookie.mockResolvedValue({ user: { id: 'user-1' }, supabase: {} })
    await post({ message: 'boom' })

    expect(captureError).toHaveBeenCalledOnce()
    const context = captureError.mock.calls[0][1] as { userId?: string }
    expect(context.userId).toBe('user-1')
  })
})
