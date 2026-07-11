import { describe, expect, it, vi } from 'vitest'

// limiter.ts carries `import 'server-only'`; neutralize it for the node env.
vi.mock('server-only', () => ({}))

import { checkRateLimit, clientBucket, RATE_LIMITS } from '../lib/rate-limit/limiter'
import type { SupabaseClient } from '@supabase/supabase-js'

function fakeAdmin(rpc: (fn: string, params: unknown) => Promise<{ data: unknown; error: unknown }>) {
  return { rpc: vi.fn(rpc) } as unknown as SupabaseClient
}

describe('checkRateLimit', () => {
  it('allows when the returned count is at or under the limit', async () => {
    const admin = fakeAdmin(async () => ({ data: RATE_LIMITS.waitlist.limit, error: null }))
    const result = await checkRateLimit(admin, 'waitlist', 'waitlist:1.2.3.4')
    expect(result.allowed).toBe(true)
    expect(result.count).toBe(RATE_LIMITS.waitlist.limit)
  })

  it('denies when the returned count exceeds the limit, with a Retry-After budget', async () => {
    const admin = fakeAdmin(async () => ({ data: RATE_LIMITS.waitlist.limit + 1, error: null }))
    const result = await checkRateLimit(admin, 'waitlist', 'waitlist:1.2.3.4')
    expect(result.allowed).toBe(false)
    expect(result.retryAfterSeconds).toBe(RATE_LIMITS.waitlist.windowSeconds)
  })

  it('fails OPEN on an RPC error (a limiter fault never blocks the request)', async () => {
    const admin = fakeAdmin(async () => ({ data: null, error: { message: 'boom' } }))
    const result = await checkRateLimit(admin, 'errors', 'errors:1.2.3.4')
    expect(result.allowed).toBe(true)
  })

  it('fails OPEN when the RPC returns a non-numeric shape', async () => {
    const admin = fakeAdmin(async () => ({ data: 'nope', error: null }))
    const result = await checkRateLimit(admin, 'errors', 'errors:1.2.3.4')
    expect(result.allowed).toBe(true)
  })

  it('passes the route window to the RPC with the given bucket', async () => {
    const admin = fakeAdmin(async () => ({ data: 1, error: null }))
    await checkRateLimit(admin, 'errors', 'errors:9.9.9.9')
    expect(admin.rpc).toHaveBeenCalledWith('check_rate_limit', {
      p_bucket: 'errors:9.9.9.9',
      p_window_seconds: RATE_LIMITS.errors.windowSeconds,
    })
  })
})

describe('clientBucket', () => {
  it('uses the first x-forwarded-for entry, prefixed by route', () => {
    const req = new Request('http://x/', { headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' } })
    expect(clientBucket(req, 'errors')).toBe('errors:1.2.3.4')
  })

  it('falls back to x-real-ip, then to a shared "unknown" bucket', () => {
    const withReal = new Request('http://x/', { headers: { 'x-real-ip': '9.9.9.9' } })
    expect(clientBucket(withReal, 'waitlist')).toBe('waitlist:9.9.9.9')
    expect(clientBucket(new Request('http://x/'), 'waitlist')).toBe('waitlist:unknown')
  })
})
