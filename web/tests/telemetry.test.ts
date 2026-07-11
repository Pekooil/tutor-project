import { beforeEach, describe, expect, it, vi } from 'vitest'
import { validateEvent, type TelemetryEvent } from '../lib/telemetry/events'

// Sprint 17 Task 8. Two halves:
//   1. validateEvent (pure, no server-only marker) -- the structural
//      no-free-text guarantee ADR-043 requires: this fails the moment a
//      string field is added to the union without a matching FieldSpec, and
//      rejects any event carrying a field outside its kind's exact shape.
//   2. POST /api/telemetry at the module boundary, mocked the same way
//      waitlist.test.ts mocks its service-role client -- @/lib/auth/bearer's
//      clientFromBearerOrCookie is the route's only collaborator besides
//      validateEvent itself.
//
// These mocked-module route tests prove the route's contract (user_id from
// the session, never the body; a malformed event dropped, not fatal) without
// a live table. Migration 0017 (which creates telemetry_event) was applied to
// the live "calyxa" project in Task 9; the live side of the table is covered
// where it matters -- the scoped service-role export read + FK-cascade erasure
// are asserted in tests/account.test.ts. telemetry_event has no client SELECT
// policy by design (ADR-043), so there is no client-read path to test here.

describe('validateEvent — the no-free-text guarantee (Sprint 17 Task 4/8, ADR-043)', () => {
  const validSamples: TelemetryEvent[] = [
    { kind: 'onboarding_completed', itemCount: 10, ms: 42000 },
    { kind: 'session_started', mode: 'voice' },
    { kind: 'turn_latency', sttMs: 100, aiMs: 200, ttsMs: 300, networkMs: 50, totalMs: 650 },
    { kind: 'annotation_rendered', count: 2, fallback: false },
    { kind: 'voice_used' },
    { kind: 'degraded_hit', cap: 'soft', source: 'claude_turn' },
  ]

  it.each(validSamples)('accepts a well-formed event of every kind: %j', (event) => {
    expect(validateEvent(event)).toBe(true)
  })

  it('rejects an unknown kind', () => {
    expect(validateEvent({ kind: 'nonsense' })).toBe(false)
  })

  it('rejects a non-object value', () => {
    expect(validateEvent('session_started')).toBe(false)
    expect(validateEvent(null)).toBe(false)
    expect(validateEvent(42)).toBe(false)
    expect(validateEvent(['session_started'])).toBe(false)
  })

  it('rejects an event carrying an unexpected string field -- a smuggled transcript/note is structurally impossible, not just undocumented', () => {
    expect(validateEvent({ kind: 'session_started', mode: 'voice', note: 'the student said x = 4' })).toBe(false)
    expect(validateEvent({ kind: 'voice_used', transcript: 'hello there' })).toBe(false)
    expect(validateEvent({ kind: 'annotation_rendered', count: 1, fallback: false, url: 'https://x.example' })).toBe(
      false
    )
  })

  it('rejects a missing required field', () => {
    expect(validateEvent({ kind: 'annotation_rendered', count: 2 })).toBe(false)
    expect(validateEvent({ kind: 'session_started' })).toBe(false)
  })

  it('rejects a wrong-typed or out-of-enum field', () => {
    expect(validateEvent({ kind: 'annotation_rendered', count: '2', fallback: false })).toBe(false)
    expect(validateEvent({ kind: 'session_started', mode: 'text-and-voice' })).toBe(false)
    expect(validateEvent({ kind: 'turn_latency', sttMs: Infinity, aiMs: 1, ttsMs: 1, networkMs: 1, totalMs: 1 })).toBe(
      false
    )
  })

  it('rejects `voice_used` (zero-field kind) carrying ANY field at all', () => {
    expect(validateEvent({ kind: 'voice_used', extra: true })).toBe(false)
  })
})

const { clientFromBearerOrCookie } = vi.hoisted(() => ({
  clientFromBearerOrCookie: vi.fn(),
}))

vi.mock('@/lib/auth/bearer', () => ({ clientFromBearerOrCookie }))

import * as route from '../app/api/telemetry/route'

const FAKE_USER_ID = 'user-telemetry-test-1'

function post(body: unknown) {
  return route.POST(
    new Request('http://localhost/api/telemetry', {
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
        if (table !== 'telemetry_event') throw new Error(`unexpected table: ${table}`)
        return { insert }
      },
    },
    user: { id: FAKE_USER_ID },
  })
})

describe('POST /api/telemetry', () => {
  it('inserts valid events with user_id from the AUTHENTICATED session, never the body', async () => {
    const response = await post({
      events: [{ kind: 'voice_used' }, { kind: 'session_started', mode: 'text' }],
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ inserted: 2, rejected: 0 })
    expect(insert).toHaveBeenCalledWith([
      { user_id: FAKE_USER_ID, kind: 'voice_used', payload: {} },
      { user_id: FAKE_USER_ID, kind: 'session_started', payload: { mode: 'text' } },
    ])
  })

  it('drops an individual malformed event rather than failing the whole batch', async () => {
    const response = await post({
      events: [{ kind: 'voice_used' }, { kind: 'voice_used', note: 'smuggled text' }],
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ inserted: 1, rejected: 1 })
    expect(insert).toHaveBeenCalledWith([{ user_id: FAKE_USER_ID, kind: 'voice_used', payload: {} }])
  })

  it('an all-invalid batch inserts nothing and never touches the table', async () => {
    const response = await post({ events: [{ kind: 'nonsense' }] })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ inserted: 0, rejected: 1 })
    expect(insert).not.toHaveBeenCalled()
  })

  it('400s on a structurally malformed request (no events array) and never touches the table', async () => {
    const response = await post({ notEvents: [] })
    expect(response.status).toBe(400)
    expect(insert).not.toHaveBeenCalled()
  })

  it('400s on a non-JSON body', async () => {
    const response = await post('not json')
    expect(response.status).toBe(400)
    expect(insert).not.toHaveBeenCalled()
  })

  it('401s when not signed in', async () => {
    clientFromBearerOrCookie.mockResolvedValue({ error: 401 })
    const response = await post({ events: [{ kind: 'voice_used' }] })
    expect(response.status).toBe(401)
    expect(insert).not.toHaveBeenCalled()
  })

  it('surfaces a database failure as 502 without leaking details', async () => {
    insert.mockResolvedValue({ error: { message: 'connection refused' } })
    const response = await post({ events: [{ kind: 'voice_used' }] })
    expect(response.status).toBe(502)
    expect(JSON.stringify(await response.json())).not.toContain('connection refused')
  })

  it('exposes no GET handler -- reads are service-role only by design (ADR-043)', () => {
    expect('GET' in route).toBe(false)
  })
})
