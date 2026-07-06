import { beforeEach, describe, expect, it, vi } from 'vitest'

// Sprint 20 Task 10: POST /api/waitlist (Task 2), tested at the module
// boundary. The route's only collaborator — the service-role client from
// @/lib/supabase/admin — is mocked, which (a) matches the plan ("service-role
// client mocked"), (b) keeps this suite pure-logic with no dev server or
// hosted-Supabase round-trip, and (c) sidesteps admin.ts's `server-only`
// guard, which would throw if the real module ever loaded outside Next.
//
// The idempotency contract under test is structural: the route delegates
// duplicate-handling to upsert({ onConflict: 'email', ignoreDuplicates:
// true }), which reports NO error on a duplicate — so the duplicate test
// asserts both that repeated posts return identical success bodies and that
// the ignoreDuplicates option (the mechanism) is actually passed.

const { upsert } = vi.hoisted(() => ({
  upsert: vi.fn<(values: unknown, options: unknown) => Promise<{ error: unknown }>>(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table !== 'waitlist') throw new Error(`unexpected table: ${table}`)
      return { upsert }
    },
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
  upsert.mockResolvedValue({ error: null })
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

  it('treats a duplicate email as an idempotent 200, indistinguishable from success', async () => {
    const first = await post({ email: 'darcy@gmail.com', source: 'hero' })
    // ignoreDuplicates makes the second upsert a no-op with NO error — the
    // mock keeps resolving { error: null }, exactly like the real client.
    const second = await post({ email: 'darcy@gmail.com', source: 'footer' })

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(await first.json()).toEqual(await second.json())
    // The mechanism that makes this idempotent at the table, not just here:
    for (const call of upsert.mock.calls) {
      expect(call[1]).toEqual({ onConflict: 'email', ignoreDuplicates: true })
    }
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

  it('returns a silent success for a filled honeypot, with no insert', async () => {
    const response = await post({ email: 'bot@spam.example', source: 'hero', company: 'Bot Corp' })

    expect(response.status).toBe(200)
    // Same body shape as real success — a bot never learns the check exists.
    expect(await response.json()).toEqual({ ok: true })
    expect(upsert).not.toHaveBeenCalled()
  })

  it('stores an unknown source as null rather than trusting the client string', async () => {
    await post({ email: 'darcy@gmail.com', source: 'totally-invented' })
    expect(upsert).toHaveBeenCalledWith(
      { email: 'darcy@gmail.com', source: null },
      { onConflict: 'email', ignoreDuplicates: true }
    )
  })

  it('surfaces a database failure as a 500 without leaking details', async () => {
    upsert.mockResolvedValue({ error: { message: 'connection refused' } })
    const response = await post({ email: 'darcy@gmail.com', source: 'hero' })

    expect(response.status).toBe(500)
    const body = await response.json()
    expect(JSON.stringify(body)).not.toContain('connection refused')
  })

  it('exposes no GET handler (the table is never readable through this route)', () => {
    expect('GET' in route).toBe(false)
  })
})
