// Sprint 17 Task 8: pure tests for the background's telemetry batching
// (background/index.ts, Task 6) -- the flush-decision reducer and the
// swallow-on-failure discipline. background/index.ts uses WXT's `#imports`
// virtual module (defineBackground) at its top, same as content/index.ts
// (lifecycle.test.ts's precedent) -- resolved via the SAME
// extension/vitest.config.ts WxtVitest() plugin, no extra setup needed here.
// `defineBackground`'s callback is never invoked merely by importing the
// module (proven by lifecycle.test.ts's own isPlausibleProblem import from
// content/index.ts's analogous defineContentScript), so this file never
// touches chrome.* at all -- both functions under test are called directly.
import { describe, expect, it, vi } from 'vitest';
import type { TelemetryEvent } from '../src/types/messages';

vi.mock('../src/lib/api', () => ({
  sendTelemetry: vi.fn(),
  // toErrorMessage's `error instanceof api.SignedOutError` check needs SOME
  // class here even though this suite never exercises that branch -- an
  // `instanceof` check against `undefined` throws a TypeError.
  SignedOutError: class SignedOutError extends Error {},
}));

import {
  EMPTY_TELEMETRY_BATCH,
  TELEMETRY_BATCH_MAX,
  TELEMETRY_BATCH_MAX_AGE_MS,
  flushTelemetry,
  reduceTelemetryBatch,
} from '../src/background/index';
import * as api from '../src/lib/api';

const ev = (): TelemetryEvent => ({ kind: 'voice_used' });

describe('reduceTelemetryBatch — the flush-on-N-or-age reducer (Sprint 17 Task 6/8)', () => {
  it('buffers a lone event without flushing', () => {
    const { next, flush } = reduceTelemetryBatch(EMPTY_TELEMETRY_BATCH, [ev()], 1_000);
    expect(flush).toHaveLength(0);
    expect(next.events).toHaveLength(1);
    expect(next.oldestAt).toBe(1_000);
  });

  it('flushes on reaching the size cap', () => {
    const incoming = Array.from({ length: TELEMETRY_BATCH_MAX }, ev);
    const { next, flush } = reduceTelemetryBatch(EMPTY_TELEMETRY_BATCH, incoming, 1_000);
    expect(flush).toHaveLength(TELEMETRY_BATCH_MAX);
    expect(next).toEqual(EMPTY_TELEMETRY_BATCH);
  });

  it('does NOT flush one event short of the cap', () => {
    const incoming = Array.from({ length: TELEMETRY_BATCH_MAX - 1 }, ev);
    const { next, flush } = reduceTelemetryBatch(EMPTY_TELEMETRY_BATCH, incoming, 1_000);
    expect(flush).toHaveLength(0);
    expect(next.events).toHaveLength(TELEMETRY_BATCH_MAX - 1);
  });

  it('flushes once the oldest buffered event ages past the interval, even with no new events (the timer re-check)', () => {
    const state = { events: [ev()], oldestAt: 1_000 };
    const { flush } = reduceTelemetryBatch(state, [], 1_000 + TELEMETRY_BATCH_MAX_AGE_MS);
    expect(flush).toHaveLength(1);
  });

  it('does not flush before the age interval elapses', () => {
    const state = { events: [ev()], oldestAt: 1_000 };
    const { flush } = reduceTelemetryBatch(state, [], 1_000 + TELEMETRY_BATCH_MAX_AGE_MS - 1);
    expect(flush).toHaveLength(0);
  });

  it('keeps the ORIGINAL age clock across appends -- does not reset on each new event', () => {
    const state = { events: [ev()], oldestAt: 1_000 };
    const { next, flush } = reduceTelemetryBatch(state, [ev()], 2_000);
    expect(flush).toHaveLength(0);
    expect(next.oldestAt).toBe(1_000);
    expect(next.events).toHaveLength(2);
  });

  it('never flushes an empty buffer, regardless of elapsed time', () => {
    const { flush, next } = reduceTelemetryBatch(EMPTY_TELEMETRY_BATCH, [], 9_999_999);
    expect(flush).toHaveLength(0);
    expect(next).toEqual(EMPTY_TELEMETRY_BATCH);
  });
});

describe('flushTelemetry — a failed POST is swallowed (Sprint 17 Task 6/8, ADR-043)', () => {
  it('resolves normally even when api.sendTelemetry rejects -- no user-visible effect', async () => {
    vi.mocked(api.sendTelemetry).mockRejectedValueOnce(new Error('network down'));
    await expect(flushTelemetry([ev()])).resolves.toBeUndefined();
  });

  it('calls api.sendTelemetry with the flushed batch', async () => {
    vi.mocked(api.sendTelemetry).mockResolvedValueOnce(undefined);
    const events: TelemetryEvent[] = [ev(), { kind: 'session_started', mode: 'text' }];
    await flushTelemetry(events);
    expect(api.sendTelemetry).toHaveBeenCalledWith(events);
  });
});
