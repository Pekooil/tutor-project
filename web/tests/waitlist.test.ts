import { beforeEach, describe, expect, it, vi } from 'vitest'

// Sprint 20 Task 10: POST /api/waitlist (Task 2), tested at the module
// boundary. The route's collaborators — the service-role client from
// @/lib/supabase/admin and sendInvite from @/lib/email/invite — are mocked,
// which (a) keeps this suite pure-logic with no dev server or hosted-Supabase
// round-trip, and (b) sidesteps admin.ts's `server-only` guard, which would
// throw if the real module ever loaded outside Next.
//
// Darcy's call (2026-07-15): a genuinely new signup is now invited +
// emailed immediately (reverses ADR-045's manual-curation gate for THIS
// path only — POST /api/admin/invite is unchanged). The idempotency
// contract under test is structural: the route tells "new insert" from
// "duplicate" via whether `.select().maybeSingle()` returns a row —
// ignoreDuplicates suppresses the row (not just the error) on a conflict.

// The route now imports @/lib/rate-limit/limiter, which carries
// `import 'server-only'`; neutralize it for the node test env (predict.test.ts
// convention). The limiter itself runs for real against the mocked admin
// client's `rpc` below.
vi.mock('server-only', () => ({}))

const { upsert, update, eq, maybeSingle, rpc, sendInvite } = vi.hoisted(() => ({
  upsert: vi.fn<(values: unknown, options: unknown) => unknown>(),
  update: vi.fn<(values: unknown) => unknown>(),
  eq: vi.fn<(col: string, value: unknown) => Promise<{ error: unknown }>>(),
  maybeSingle: vi.fn<() => Promise<{ data: { id: string } | null; error: unknown }>>(),
  rpc: vi.fn<(fn: string, params: unknown) => Promise<{ data: unknown; error: unknown }>>(),
  sendInvite: vi.fn<(email: string, code: string, storeLink: string | null) => Promise<{ sent: boolean }>>(),
}))

vi.mock('@/lib/email/invite', () => ({ sendInvite }))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table !== 'waitlist') throw new Error(`unexpected table: ${table}`)
      return {
        upsert: (values: unknown, options: unknown) => {
          upsert(values, options)
          return { select: () => ({ maybeSingle }) }
        },
        update: (values: unknown) => {
          update(values)
          return { eq }
        },
      }
    },
    rpc,
  }),
}))

import * as route from '../app/api/waitlist/route'

function post(body: unknown) {
  return route.POST(
    new Request('http://localhost/api/waitlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    })
  )
}

beforeEach(() => {
  upsert.mockReset()
  update.mockReset()
  eq.mockReset()
  maybeSingle.mockReset()
  rpc.mockReset()
  sendInvite.mockReset()

  // Default: a genuine new insert (a row comes back) — the common case.
  maybeSingle.mockResolvedValue({ data: { id: 'row-1' }, error: null })
  eq.mockResolvedValue({ error: null })
  sendInvite.mockResolvedValue({ sent: true })
  // Default: the rate-limit RPC reports this is the 1st hit in the window
  // (well under the limit), so every existing test proceeds as before.
  rpc.mockResolvedValue({ data: 1, error: null })
})

describe('POST /api/waitlist', () => {
  it('inserts a valid email via the service-role client and returns 200', async () => {
    const response = await post({ email: 'darcy@gmail.com', source: 'hero' })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
    expect(upsert).toHaveBeenCalledOnce()
    expect(upsert).toHaveBeenCalledWith(
      { email: 'darcy@gmail.com', source: 'hero' },
      { onConflict: 'email', ignoreDuplicates: true }
    )
  })

  it('normalizes the email (trim + lowercase) before inserting', async () => {
    const response = await post({ email: '  Darcy@GMAIL.com  ', source: 'footer' })

    expect(response.status).toBe(200)
    expect(upsert).toHaveBeenCalledWith(
      { email: 'darcy@gmail.com', source: 'footer' },
      { onConflict: 'email', ignoreDuplicates: true }
    )
  })

  it('a genuinely new signup is invited immediately: mints a code, marks invited_at, sends the email', async () => {
    const response = await post({ email: 'darcy@gmail.com', source: 'hero' })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
    expect(update).toHaveBeenCalledOnce()
    const [updateArg] = update.mock.calls[0] as [{ invited_at: string; invite_code: string }]
    expect(typeof updateArg.invited_at).toBe('string')
    expect(typeof updateArg.invite_code).toBe('string')
    expect(updateArg.invite_code.length).toBeGreaterThan(0)
    expect(eq).toHaveBeenCalledWith('id', 'row-1')
    expect(sendInvite).toHaveBeenCalledOnce()
    expect(sendInvite).toHaveBeenCalledWith('darcy@gmail.com', updateArg.invite_code, null)
  })

  it('a duplicate signup is a true no-op: no new code, no re-invite, no email', async () => {
    // ignoreDuplicates suppresses the returned row (not just the error) on
    // a conflict — this is the route's only signal that nothing was inserted.
    maybeSingle.mockResolvedValue({ data: null, error: null })

    const first = await post({ email: 'darcy@gmail.com', source: 'hero' })
    const second = await post({ email: 'darcy@gmail.com', source: 'footer' })

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(await first.json()).toEqual(await second.json())
    expect(update).not.toHaveBeenCalled()
    expect(sendInvite).not.toHaveBeenCalled()
    // The mechanism that makes this idempotent at the table, not just here:
    for (const call of upsert.mock.calls) {
      expect(call[1]).toEqual({ onConflict: 'email', ignoreDuplicates: true })
    }
  })

  it('a failed send does not fail the signup response (best-effort)', async () => {
    sendInvite.mockResolvedValue({ sent: false })

    const response = await post({ email: 'darcy@gmail.com', source: 'hero' })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
    expect(sendInvite).toHaveBeenCalledOnce()
  })

  it('does not send an email if marking the row invited fails', async () => {
    eq.mockResolvedValue({ error: { message: 'update failed' } })

    const response = await post({ email: 'darcy@gmail.com', source: 'hero' })

    expect(response.status).toBe(200)
    expect(sendInvite).not.toHaveBeenCalled()
  })

  it('rejects a malformed email with 400 and never touches the table', async () => {
    for (const email of ['not-an-email', 'missing@tld', 'two words@x.y', '', undefined]) {
      const response = await post({ email, source: 'hero' })
      expect(response.status).toBe(400)
    }
    expect(upsert).not.toHaveBeenCalled()
  })

  it('rejects a non-JSON body with 400', async () => {
    const response = await post('this is not json')
    expect(response.status).toBe(400)
    expect(upsert).not.toHaveBeenCalled()
  })

  it('returns a silent success for a filled honeypot, with no insert and no invite', async () => {
    const response = await post({ email: 'bot@spam.example', source: 'hero', company: 'Bot Corp' })

    expect(response.status).toBe(200)
    // Same body shape as real success — a bot never learns the check exists.
    expect(await response.json()).toEqual({ ok: true })
    expect(upsert).not.toHaveBeenCalled()
    expect(sendInvite).not.toHaveBeenCalled()
  })

  it('stores an unknown source as null rather than trusting the client string', async () => {
    await post({ email: 'darcy@gmail.com', source: 'totally-invented' })
    expect(upsert).toHaveBeenCalledWith(
      { email: 'darcy@gmail.com', source: null },
      { onConflict: 'email', ignoreDuplicates: true }
    )
  })

  it('surfaces a database failure as a 500 without leaking details, and never invites', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: { message: 'connection refused' } })
    const response = await post({ email: 'darcy@gmail.com', source: 'hero' })

    expect(response.status).toBe(500)
    const body = await response.json()
    expect(JSON.stringify(body)).not.toContain('connection refused')
    expect(sendInvite).not.toHaveBeenCalled()
  })

  it('returns 429 when the per-IP rate limit is exceeded, without touching the table', async () => {
    rpc.mockResolvedValue({ data: 999, error: null }) // count past the limit
    const response = await post({ email: 'darcy@gmail.com', source: 'hero' })

    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBeTruthy()
    expect(upsert).not.toHaveBeenCalled()
    expect(sendInvite).not.toHaveBeenCalled()
  })

  it('fails OPEN (still inserts) when the rate-limit RPC errors', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'rpc down' } })
    const response = await post({ email: 'darcy@gmail.com', source: 'hero' })

    expect(response.status).toBe(200)
    expect(upsert).toHaveBeenCalledOnce()
  })

  it('exposes no GET handler (the table is never readable through this route)', () => {
    expect('GET' in route).toBe(false)
  })
})
