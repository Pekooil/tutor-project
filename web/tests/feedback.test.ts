import { beforeEach, describe, expect, it, vi } from 'vitest'

// Sprint 17 Task 8: POST /api/feedback at the module boundary -- the SAME
// mocked-Supabase-client pattern as waitlist.test.ts/telemetry.test.ts.
// @/lib/auth/bearer's clientFromBearerOrCookie is the route's only
// collaborator.
//
// These mocked-module tests prove the route's OWN contract (user_id from the
// session, never the body; strict validation) without a live table. The LIVE
// assertions the plan also names now live where they belong:
//   - export includes feedback rows + the erasure sweep removes them via FK
//     cascade -> tests/account.test.ts (Task 9: migration 0017 was applied to
//     the live "calyxa" project and the export route wired for both tables).
//   - the one still-open live gap is feedback RLS isolation (a second user
//     can't read another's feedback message) -- rls.test.ts is its natural
//     home; not added here (Task 8 was scoped mocked, Task 9 didn't require
//     it), flagged as an optional follow-up.

const { clientFromBearerOrCookie } = vi.hoisted(() => ({
  clientFromBearerOrCookie: vi.fn(),
}))

vi.mock('@/lib/auth/bearer', () => ({ clientFromBearerOrCookie }))

import * as route from '../app/api/feedback/route'

const FAKE_USER_ID = 'user-feedback-test-1'

function post(body: unknown) {
  return route.POST(
    new Request('http://localhost/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    })
  )
}

let insert: ReturnType<typeof vi.fn>

beforeEach(() => {
  insert = vi.fn().mockResolvedValue({ error: null })
  clientFromBearerOrCookie.mockReset()
  clientFromBearerOrCookie.mockResolvedValue({
    supabase: {
      from: (table: string) => {
        if (table !== 'feedback') throw new Error(`unexpected table: ${table}`)
        return { insert }
      },
    },
    user: { id: FAKE_USER_ID },
  })
})

describe('POST /api/feedback', () => {
  it('inserts with user_id from the AUTHENTICATED session, never the body', async () => {
    const response = await post({ kind: 'bug', message: 'the mic broke', userId: 'someone-else' })

    expect(response.status).toBe(200)
    expect(insert).toHaveBeenCalledWith({
      user_id: FAKE_USER_ID,
      session_id: null,
      kind: 'bug',
      rating: null,
      message: 'the mic broke',
    })
  })

  it('accepts rating + sessionId when both are present', async () => {
    const response = await post({ kind: 'rating', rating: 4, sessionId: 'sess-1' })

    expect(response.status).toBe(200)
    expect(insert).toHaveBeenCalledWith({
      user_id: FAKE_USER_ID,
      session_id: 'sess-1',
      kind: 'rating',
      rating: 4,
      message: null,
    })
  })

  it('rejects a missing or invalid kind with 400, never touching the table', async () => {
    for (const kind of [undefined, 'nonsense', 123]) {
      const response = await post({ kind })
      expect(response.status).toBe(400)
    }
    expect(insert).not.toHaveBeenCalled()
  })

  it('rejects a non-integer rating with 400', async () => {
    const response = await post({ kind: 'rating', rating: 4.5 })
    expect(response.status).toBe(400)
    expect(insert).not.toHaveBeenCalled()
  })

  it('rejects a non-string message with 400', async () => {
    const response = await post({ kind: 'bug', message: 12345 })
    expect(response.status).toBe(400)
    expect(insert).not.toHaveBeenCalled()
  })

  it('rejects a non-string sessionId with 400', async () => {
    const response = await post({ kind: 'bug', sessionId: 12345 })
    expect(response.status).toBe(400)
    expect(insert).not.toHaveBeenCalled()
  })

  it('rejects a non-JSON body with 400', async () => {
    const response = await post('not json')
    expect(response.status).toBe(400)
    expect(insert).not.toHaveBeenCalled()
  })

  it('401s when not signed in', async () => {
    clientFromBearerOrCookie.mockResolvedValue({ error: 401 })
    const response = await post({ kind: 'bug' })
    expect(response.status).toBe(401)
    expect(insert).not.toHaveBeenCalled()
  })

  it('surfaces a database failure as 502 without leaking details', async () => {
    insert.mockResolvedValue({ error: { message: 'connection refused' } })
    const response = await post({ kind: 'idea' })
    expect(response.status).toBe(502)
    expect(JSON.stringify(await response.json())).not.toContain('connection refused')
  })

  it('exposes no GET handler -- capture is write-then-manually-triaged, no client read surface (ADR-039)', () => {
    expect('GET' in route).toBe(false)
  })
})
