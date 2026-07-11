import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// lib/monitoring/init.ts carries `import 'server-only'` as a defensive
// marker; mocked here exactly as predict.test.ts does for predict.ts -- the
// standard way in this workspace to unit-test server-side logic that has no
// actual Next-request dependency (scrubForMonitoring/captureError are pure +
// a fetch call, nothing route/request-scoped) without spawning a dev server.
vi.mock('server-only', () => ({}))

import { captureError, scrubForMonitoring, type MonitoringContext } from '../lib/monitoring/init'

describe('scrubForMonitoring — the structural allow-list (Sprint 17 Task 5/8, ADR-043)', () => {
  it('keeps the message and stack, plus a timestamp', () => {
    const event = scrubForMonitoring(new Error('boom'))
    expect(event.message).toBe('boom')
    expect(event.stack).toContain('Error: boom')
    expect(event.timestamp).toEqual(expect.any(String))
  })

  it('caps an overlong message/stack rather than sending it unbounded', () => {
    const err = new Error('x'.repeat(1000))
    err.stack = 'y'.repeat(5000)
    const event = scrubForMonitoring(err)
    expect(event.message).toHaveLength(500)
    expect(event.stack).toHaveLength(4000)
  })

  it('keeps only route/routeType/userId from context, silently dropping a planted transcript/URL/message-shaped field', () => {
    // The allow-list is structural, not type-level: even a value shaped like
    // it carries extra fields (as a spread from elsewhere might) gets them
    // dropped, not just fields TypeScript would reject.
    const planted = {
      route: '/api/ai/turn',
      routeType: 'route',
      userId: 'user-123',
      transcript: 'x = 4, then x = 8',
      pageUrl: 'https://khanacademy.org/exercise/42',
      note: 'a planted free-text field',
    } as MonitoringContext & Record<string, string>

    const event = scrubForMonitoring(new Error('route failed'), planted)

    expect(event.route).toBe('/api/ai/turn')
    expect(event.routeType).toBe('route')
    expect(event.userId).toBe('user-123')
    expect(event.message).toBe('route failed')
    expect(Object.keys(event).sort()).toEqual(
      ['message', 'route', 'routeType', 'stack', 'timestamp', 'userId'].sort()
    )
    expect(JSON.stringify(event)).not.toContain('x = 4')
    expect(JSON.stringify(event)).not.toContain('khanacademy.org')
    expect(JSON.stringify(event)).not.toContain('planted free-text field')
  })

  it('omits route/routeType/userId entirely when absent, rather than sending empty strings', () => {
    const event = scrubForMonitoring(new Error('boom'))
    expect('route' in event).toBe(false)
    expect('routeType' in event).toBe(false)
    expect('userId' in event).toBe(false)
  })

  it('handles a non-Error thrown value (no stack to keep)', () => {
    const event = scrubForMonitoring('a plain string throw')
    expect(event.message).toBe('a plain string throw')
    expect(event.stack).toBeUndefined()
  })
})

describe('captureError — DSN-absent is a no-op; DSN-present POSTs the scrubbed event (Sprint 17 Task 5/8)', () => {
  const originalDsn = process.env.MONITORING_DSN

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    if (originalDsn === undefined) delete process.env.MONITORING_DSN
    else process.env.MONITORING_DSN = originalDsn
  })

  it('never calls fetch when MONITORING_DSN is unset -- a true no-op, not a throw', () => {
    delete process.env.MONITORING_DSN
    expect(() => captureError(new Error('boom'))).not.toThrow()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('POSTs the scrubbed event to the DSN when configured', () => {
    process.env.MONITORING_DSN = 'https://sink.example/ingest'
    captureError(new Error('boom'), { route: '/api/ai/turn' })

    expect(fetch).toHaveBeenCalledTimes(1)
    const [calledUrl, init] = vi.mocked(fetch).mock.calls[0]
    expect(calledUrl).toBe('https://sink.example/ingest')
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body.message).toBe('boom')
    expect(body.route).toBe('/api/ai/turn')
  })

  it('never throws even if the fetch itself rejects -- fire-and-forget', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))
    process.env.MONITORING_DSN = 'https://sink.example/ingest'
    expect(() => captureError(new Error('boom'))).not.toThrow()
    // Let the fire-and-forget rejection settle so it never leaks as an
    // unhandled rejection into a later test.
    await new Promise((r) => setTimeout(r, 0))
  })
})
