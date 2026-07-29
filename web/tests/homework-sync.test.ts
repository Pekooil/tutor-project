// The homework sync route's validation (ADR-057). This parses a body an
// EXTENSION sent, so the contract that matters is: reject anything malformed
// rather than coerce it, and never let one bad entry cost the rest of a batch.
import { describe, expect, it } from 'vitest'
import { MAX_SESSIONS_PER_SYNC, parseSyncBody, parseSyncedSession, toRow } from '../lib/homework/sync-shape'

const ID = '11111111-2222-4333-8444-555555555555'
const OTHER_ID = '66666666-7777-4888-8999-aaaaaaaaaaaa'

function valid(overrides: Record<string, unknown> = {}) {
  return {
    id: ID,
    tutoringSessionId: null,
    locationHash: 'abc123',
    title: 'Factoring practice',
    concept: 'Factoring quadratics',
    denominator: 3,
    graded: true,
    status: 'complete',
    problems: [
      { index: 0, label: '1', outcome: 'ok', seconds: 60 },
      { index: 1, label: '2', outcome: 'shaky', seconds: 120, pageGrade: 'correct' },
      { index: 2, label: '3', outcome: 'tutored', seconds: 300 },
    ],
    totalSeconds: 480,
    longestUnaidedRun: 2,
    startedAt: '2026-07-21T18:00:00.000Z',
    endedAt: '2026-07-21T18:08:00.000Z',
    ...overrides,
  }
}

describe('parseSyncedSession — accepts a well-formed set', () => {
  it('round-trips every field', () => {
    const parsed = parseSyncedSession(valid())
    expect(parsed).not.toBeNull()
    expect(parsed!.id).toBe(ID)
    expect(parsed!.problems).toHaveLength(3)
    expect(parsed!.problems[1].pageGrade).toBe('correct')
    expect(parsed!.startedAt).toBe('2026-07-21T18:00:00.000Z')
  })

  it('maps onto the DB row without a user_id (the route supplies that)', () => {
    const row = toRow(parseSyncedSession(valid())!)
    expect(row).not.toHaveProperty('user_id')
    expect(row.location_hash).toBe('abc123')
    expect(row.longest_unaided_run).toBe(2)
  })
})

describe('parseSyncedSession — rejects rather than coerces', () => {
  it('requires a uuid id, because the id IS the upsert key', () => {
    expect(parseSyncedSession(valid({ id: 'not-a-uuid' }))).toBeNull()
    expect(parseSyncedSession(valid({ id: undefined }))).toBeNull()
  })

  it('requires a sane denominator', () => {
    expect(parseSyncedSession(valid({ denominator: 0 }))).toBeNull()
    expect(parseSyncedSession(valid({ denominator: 999 }))).toBeNull()
    expect(parseSyncedSession(valid({ denominator: 2.5 }))).toBeNull()
  })

  it('requires a known status and a location hash', () => {
    expect(parseSyncedSession(valid({ status: 'finished' }))).toBeNull()
    expect(parseSyncedSession(valid({ locationHash: '' }))).toBeNull()
  })

  it('requires a parseable startedAt', () => {
    expect(parseSyncedSession(valid({ startedAt: 'yesterday' }))).toBeNull()
  })

  it('rejects an unknown outcome', () => {
    const bad = valid({ problems: [{ index: 0, label: '1', outcome: 'skipped', seconds: 10 }], denominator: 1, status: 'complete' })
    expect(parseSyncedSession(bad)).toBeNull()
  })

  it('rejects more problems than the denominator allows', () => {
    const bad = valid({
      denominator: 1,
      status: 'paused',
      problems: [
        { index: 0, label: '1', outcome: 'ok', seconds: 10 },
        { index: 1, label: '2', outcome: 'ok', seconds: 10 },
      ],
    })
    expect(parseSyncedSession(bad)).toBeNull()
  })

  it('rejects a "complete" set that is not actually complete', () => {
    // Otherwise the dashboard would fire a celebration summary for a set the
    // student abandoned (spec §8: partial sets get no celebration).
    const bad = valid({ status: 'complete', denominator: 8 })
    expect(parseSyncedSession(bad)).toBeNull()
  })

  it('drops a malformed pageGrade instead of storing it', () => {
    const parsed = parseSyncedSession(
      valid({
        denominator: 1,
        status: 'complete',
        problems: [{ index: 0, label: '1', outcome: 'ok', seconds: 10, pageGrade: 'maybe' }],
      }),
    )
    expect(parsed!.problems[0]).not.toHaveProperty('pageGrade')
  })

  it('falls back to the position when a label is missing', () => {
    const parsed = parseSyncedSession(
      valid({ denominator: 1, status: 'complete', problems: [{ index: 0, outcome: 'ok', seconds: 10 }] }),
    )
    expect(parsed!.problems[0].label).toBe('1')
  })
})

describe('parseSyncBody — one bad entry never costs the batch', () => {
  it('keeps the good sessions and drops the bad', () => {
    const parsed = parseSyncBody({
      sessions: [valid(), { id: 'garbage' }, valid({ id: OTHER_ID })],
    })
    expect(parsed.map((s) => s.id)).toEqual([ID, OTHER_ID])
  })

  it('caps the batch', () => {
    const many = Array.from({ length: MAX_SESSIONS_PER_SYNC + 8 }, () => valid())
    expect(parseSyncBody({ sessions: many }).length).toBeLessThanOrEqual(MAX_SESSIONS_PER_SYNC)
  })

  it('treats a missing or junk body as nothing to do, not an error', () => {
    expect(parseSyncBody(null)).toEqual([])
    expect(parseSyncBody({})).toEqual([])
    expect(parseSyncBody({ sessions: 'nope' })).toEqual([])
  })
})
